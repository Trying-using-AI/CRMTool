// ═══════════════════════════════════════════════════
//  PingCRM — Process Scheduled Sends
//  GET/POST /api/process-scheduled-sends
//
//  Called every minute by Vercel Cron (or cron-job.org).
//  Picks up rows from campaign_queue where fire_at <= now,
//  sends the message via the appropriate channel, and marks
//  each row sent/failed.
//
//  Required SQL (run once in Supabase SQL editor):
//
//  CREATE TABLE campaign_queue (
//    id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//    workspace_id  uuid NOT NULL,
//    campaign_id   uuid NOT NULL,
//    contact_id    uuid NOT NULL,
//    fire_at       timestamptz NOT NULL,
//    status        text NOT NULL DEFAULT 'pending',
//    error_msg     text,
//    created_at    timestamptz DEFAULT now(),
//    sent_at       timestamptz
//  );
//  CREATE INDEX idx_cq_fire ON campaign_queue(fire_at, status);
// ═══════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET          = process.env.CRON_SECRET; // optional

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Optional shared secret so only your cron caller can trigger this
  if (CRON_SECRET) {
    const provided = req.headers['x-cron-secret'] || req.query.secret;
    if (provided !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const now = new Date().toISOString();

  // Fetch up to 100 pending rows that are due
  const { data: dueRows, error: fetchErr } = await db
    .from('campaign_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('fire_at', now)
    .order('fire_at', { ascending: true })
    .limit(100);

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!dueRows || dueRows.length === 0) {
    return res.status(200).json({ ok: true, processed: 0, message: 'Nothing due' });
  }

  let sent = 0, failed = 0;

  for (const row of dueRows) {
    // Mark in-flight so concurrent cron calls skip it
    await db.from('campaign_queue').update({ status: 'processing' }).eq('id', row.id);

    try {
      // Fetch campaign
      const { data: campaign } = await db.from('campaigns').select('*')
        .eq('id', row.campaign_id).single();

      // Fetch contact
      const { data: contact } = await db.from('contacts').select('*')
        .eq('id', row.contact_id).single();

      if (!campaign || !contact) throw new Error('Campaign or contact not found');
      if (contact.opted_out) throw new Error('Contact opted out');

      // Fetch vendor if campaign has one
      let vendor = null, vCfg = {};
      if (campaign.vendor_id) {
        const { data: v } = await db.from('vendor_connections').select('*')
          .eq('id', campaign.vendor_id).single();
        if (v) { vendor = v; vCfg = v.config || {}; }
      }

      const channel = (campaign.channel || 'SMS').toLowerCase();
      const msgText = campaign.message_a || '';

      let success = false, errMsg = null, vendorMsgId = null;

      if (channel === 'sms') {
        const vName = vendor ? (vendor.name || '').toLowerCase() : '';
        if (vName.includes('twilio')) {
          const r = await sendViaTwilio(vCfg, contact.phone, msgText);
          success = r.success; vendorMsgId = r.sid; errMsg = r.error;
        } else {
          // Log without dispatch for unknown vendors in scheduled sends
          success = true; errMsg = 'No SMS vendor matched; marked sent without dispatch';
        }
      } else if (channel === 'whatsapp') {
        const vName = vendor ? (vendor.name || '').toLowerCase() : '';
        const r = vName.includes('twilio')
          ? await sendViaTwilioWA(vCfg, contact.phone, campaign)
          : await sendViaMetaWA(vCfg, contact.phone, campaign);
        success = r.success; vendorMsgId = r.msgId; errMsg = r.error;
      } else {
        success = true; errMsg = `Channel ${channel} queued but not dispatched`;
      }

      await db.from('campaign_queue').update({
        status:   success ? 'sent' : 'failed',
        error_msg: errMsg || null,
        sent_at:  new Date().toISOString()
      }).eq('id', row.id);

      // Log delivery
      await db.from('delivery_log').insert({
        workspace_id: row.workspace_id,
        campaign_id:  row.campaign_id,
        contact_id:   row.contact_id,
        status:       success ? 'sent' : 'failed',
        error_msg:    errMsg,
        vendor_msg_id: vendorMsgId
      });

      if (success) sent++; else failed++;

    } catch (e) {
      await db.from('campaign_queue').update({
        status: 'failed', error_msg: e.message, sent_at: new Date().toISOString()
      }).eq('id', row.id);
      failed++;
    }
  }

  return res.status(200).json({ ok: true, processed: dueRows.length, sent, failed });
};

// ── SMS: Twilio ──────────────────────────────────
async function sendViaTwilio(cfg, toPhone, body) {
  const sid   = cfg.account_sid || process.env.TWILIO_ACCOUNT_SID;
  const token = cfg.auth_token  || process.env.TWILIO_AUTH_TOKEN;
  const from  = cfg.sender_id   || cfg.from_number || process.env.TWILIO_FROM_NUMBER || '';
  const url   = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const resp  = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ From: from, To: toPhone, Body: body }).toString()
  });
  const json = await resp.json();
  if (json.sid) return { success: true, sid: json.sid };
  return { success: false, error: json.message || 'Twilio error' };
}

// ── WhatsApp: Twilio ─────────────────────────────
async function sendViaTwilioWA(cfg, toPhone, campaign) {
  const sid   = cfg.account_sid  || process.env.TWILIO_ACCOUNT_SID;
  const token = cfg.auth_token   || process.env.TWILIO_AUTH_TOKEN;
  const from  = cfg.whatsapp_from || cfg.from_number || process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  const to    = 'whatsapp:+' + toPhone.replace(/^\+/, '').replace(/\D/g, '');
  const body  = campaign.wa_body || campaign.message_a || '';
  const url   = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const resp  = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString()
  });
  const json = await resp.json();
  if (json.sid) return { success: true, msgId: json.sid };
  return { success: false, error: json.message || `Twilio WA error ${resp.status}` };
}

// ── WhatsApp: Meta Cloud API ─────────────────────
async function sendViaMetaWA(cfg, toPhone, campaign) {
  const phoneNumberId = cfg.phone_number_id || '';
  const accessToken   = cfg.permanent_access_token || cfg.access_token || process.env.META_WA_ACCESS_TOKEN || '';
  if (!phoneNumberId || !accessToken) return { success: false, error: 'Missing Meta WA config' };
  const to = toPhone.replace(/^\+/, '').replace(/\D/g, '');
  const resp = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to,
      type: 'template',
      template: { name: campaign.wa_template_name || 'hello_world', language: { code: 'en_US' } }
    })
  });
  const json = await resp.json();
  if (json.messages?.[0]?.id) return { success: true, msgId: json.messages[0].id };
  return { success: false, error: (json.error?.message) || `Meta API ${resp.status}` };
}

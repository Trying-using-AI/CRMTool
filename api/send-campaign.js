// ═══════════════════════════════════════════════════
//  PingCRM — Send Campaign API
//  POST /api/send-campaign
//  Body: { campaign_id, workspace_id }
//
//  Reads campaign + segment from Supabase,
//  sends SMS via Twilio or MSG91, logs delivery rows.
// ═══════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service role — never exposed to browser
const TWILIO_SID          = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN        = process.env.TWILIO_AUTH_TOKEN;
const MSG91_KEY           = process.env.MSG91_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { campaign_id, workspace_id } = req.body;
  if (!campaign_id || !workspace_id) return res.status(400).json({ error: 'campaign_id and workspace_id required' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Fetch campaign
  const { data: campaign, error: campErr } = await db
    .from('campaigns')
    .select('*, vendor_connections(*), segments(*)')
    .eq('id', campaign_id)
    .eq('workspace_id', workspace_id)
    .single();

  if (campErr || !campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status === 'completed') return res.status(400).json({ error: 'Campaign already sent' });

  // 2. Fetch contacts in segment
  const { data: contacts } = await db
    .from('contacts')
    .select('id, phone, first_name, attributes')
    .eq('workspace_id', workspace_id)
    .eq('opted_out', false)
    .not('phone', 'is', null);

  if (!contacts || contacts.length === 0) {
    return res.status(400).json({ error: 'No eligible contacts' });
  }

  // 3. Mark campaign as sending
  await db.from('campaigns').update({ status: 'sending', sent_at: new Date().toISOString() }).eq('id', campaign_id);

  // 4. Send messages
  const vendor = campaign.vendor_connections;
  const results = { sent: 0, failed: 0, errors: [] };

  for (const contact of contacts) {
    const messageText = personalise(campaign.message_a, contact);
    let success = false;
    let vendorMsgId = null;
    let errorMsg = null;

    try {
      if (vendor.name === 'Twilio') {
        const result = await sendViaTwilio(vendor.sender_id, contact.phone, messageText);
        success = result.success;
        vendorMsgId = result.sid;
        errorMsg = result.error;
      } else if (vendor.name === 'MSG91') {
        const result = await sendViaMSG91(vendor.sender_id, contact.phone, messageText, campaign.dlt_template_id_a);
        success = result.success;
        errorMsg = result.error;
      }
    } catch (e) {
      errorMsg = e.message;
    }

    // Log delivery row
    await db.from('campaign_deliveries').insert({
      campaign_id,
      contact_id: contact.id,
      variant: 'a',
      status: success ? 'sent' : 'failed',
      vendor_msg_id: vendorMsgId,
      error_msg: errorMsg
    });

    if (success) results.sent++; else { results.failed++; results.errors.push(errorMsg); }
  }

  // 5. Update campaign metrics
  await db.from('campaigns').update({
    status: 'completed',
    sent: results.sent,
    failed: results.failed
  }).eq('id', campaign_id);

  // 6. Update vendor used_in count
  await db.from('vendor_connections')
    .update({ used_in: (vendor.used_in || 0) + 1 })
    .eq('id', vendor.id);

  return res.status(200).json({ ok: true, sent: results.sent, failed: results.failed });
};

// ── Personalise message ──────────────────────────
function personalise(template, contact) {
  return (template || '')
    .replace(/\{\{first_name\}\}/g, contact.first_name || 'there')
    .replace(/\{\{coupon_code\}\}/g, (contact.attributes || {}).coupon_code || 'SAVE10')
    .replace(/\{\{expiry_date\}\}/g, new Date(Date.now() + 3 * 86400000).toLocaleDateString('en-IN'));
}

// ── Twilio sender ────────────────────────────────
async function sendViaTwilio(senderId, toPhone, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const params = new URLSearchParams({ From: senderId, To: toPhone, Body: body });
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  const json = await resp.json();
  if (json.sid) return { success: true, sid: json.sid };
  return { success: false, error: json.message || 'Unknown Twilio error' };
}

// ── MSG91 sender ─────────────────────────────────
async function sendViaMSG91(senderId, toPhone, body, dltId) {
  const resp = await fetch('https://api.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: { 'authkey': MSG91_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: senderId,
      route: '4',
      country: '91',
      sms: [{ message: body, to: [toPhone.replace(/\D/g, '')] }],
      DLT_TE_ID: dltId
    })
  });
  const json = await resp.json();
  if (json.type === 'success') return { success: true };
  return { success: false, error: json.message || 'Unknown MSG91 error' };
}

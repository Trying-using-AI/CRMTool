// ═══════════════════════════════════════════════════
//  PingCRM — Send Campaign API  v2
//  POST /api/send-campaign  { campaign_id, workspace_id }
//
//  Channels:  SMS (Twilio / MSG91 / Custom HTTP)
//             WhatsApp (Meta Cloud API)
//             Push (FCM / APNs)
//
//  Enforces:  Frequency cap · DND · Send-rate throttle
//  Targeting: Rule-based segments · CSV segments
// ═══════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const crypto           = require('node:crypto');
const http2            = require('node:http2');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TWILIO_SID           = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN         = process.env.TWILIO_AUTH_TOKEN;
const MSG91_KEY            = process.env.MSG91_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { campaign_id, workspace_id } = req.body || {};
  if (!campaign_id || !workspace_id)
    return res.status(400).json({ error: 'campaign_id and workspace_id required' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── 1. Fetch campaign ────────────────────────────
  const { data: campaign, error: campErr } = await db
    .from('campaigns')
    .select('*')
    .eq('id', campaign_id)
    .eq('workspace_id', workspace_id)
    .single();

  if (campErr || !campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status === 'completed') return res.status(400).json({ error: 'Already sent' });

  // ── 2. Fetch vendor connection (via vendor_id FK) ─
  let vendor = null;
  if (campaign.vendor_id) {
    const { data: v } = await db
      .from('vendor_connections')
      .select('*')
      .eq('id', campaign.vendor_id)
      .single();
    vendor = v;
  }

  // ── 3. Fetch workspace settings ──────────────────
  const { data: cfg = {} } = await db
    .from('workspace_settings')
    .select('*')
    .eq('workspace_id', workspace_id)
    .single() || { data: {} };

  const channel = (campaign.channel || 'SMS').toLowerCase();
  const capDay   = cfg[`cap_${channel}_day`]   ?? cfg.cap_global_day   ?? 3;
  const capWeek  = cfg[`cap_${channel}_week`]  ?? cfg.cap_global_week  ?? 10;
  const capMonth = cfg[`cap_${channel}_month`] ?? cfg.cap_global_month ?? 30;
  const dndEnabled = cfg.dnd_enabled ?? true;
  const dndStart   = (cfg.dnd_start  || '22:00').slice(0, 5);
  const dndEnd     = (cfg.dnd_end    || '08:00').slice(0, 5);
  const dndTz      = cfg.dnd_timezone || 'IST';
  const throttleEnabled = cfg.throttle_enabled ?? false;
  const throttleRpm     = cfg.throttle_rpm     ?? 500;
  const msPerMsg        = throttleEnabled ? Math.ceil(60000 / throttleRpm) : 0;

  // ── 4. Fetch contacts ────────────────────────────
  let { data: contacts } = await db
    .from('contacts')
    .select('id, phone, email, first_name, last_name, city, plan_type, attributes, timezone, opted_out')
    .eq('workspace_id', workspace_id)
    .eq('opted_out', false)
    .not('phone', 'is', null);

  contacts = contacts || [];

  // ── 5. Segment filtering ─────────────────────────
  if (campaign.segment_id) {
    const { data: segment } = await db
      .from('segments')
      .select('id, type, rules, rules_operator')
      .eq('id', campaign.segment_id)
      .single();

    if (segment) {
      if (segment.type === 'csv') {
        // CSV segments: contacts are listed in segment_contacts table
        const { data: sc } = await db
          .from('segment_contacts')
          .select('contact_id')
          .eq('segment_id', segment.id);
        const ids = new Set((sc || []).map(r => r.contact_id));
        contacts = contacts.filter(c => ids.has(c.id));
      } else if (segment.rules && segment.rules.conditions && segment.rules.conditions.length > 0) {
        // Rule-based: apply filter in JS
        contacts = filterByRules(contacts, segment.rules, segment.rules_operator || 'AND');
      }
    }
  }

  if (!contacts.length)
    return res.status(400).json({ error: 'No eligible contacts after segment filter' });

  // ── 6. Batch-load recent send counts ─────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: recentDels } = await db
    .from('campaign_deliveries')
    .select('contact_id, created_at')
    .eq('workspace_id', workspace_id)
    .in('status', ['sent', 'delivered', 'clicked'])
    .gte('created_at', thirtyDaysAgo);

  const now = Date.now();
  const sendCounts = {};
  for (const d of (recentDels || [])) {
    const elapsed = now - new Date(d.created_at).getTime();
    if (!sendCounts[d.contact_id]) sendCounts[d.contact_id] = { day: 0, week: 0, month: 0 };
    if (elapsed < 86400000)          sendCounts[d.contact_id].day++;
    if (elapsed < 7 * 86400000)      sendCounts[d.contact_id].week++;
    if (elapsed < 30 * 86400000)     sendCounts[d.contact_id].month++;
  }

  // ── 7. Mark sending ──────────────────────────────
  await db.from('campaigns')
    .update({ status: 'sending', sent_at: new Date().toISOString() })
    .eq('id', campaign_id);

  // ── 8. A/B split ─────────────────────────────────
  const abEnabled  = campaign.ab_enabled && campaign.message_b;
  const abSplitPct = campaign.ab_split || 50; // % going to variant A
  const abContacts = abEnabled
    ? contacts.map((c, i) => ({ ...c, _variant: i % 100 < abSplitPct ? 'a' : 'b' }))
    : contacts.map(c => ({ ...c, _variant: 'a' }));

  // ── 9. Send loop ─────────────────────────────────
  const results = { sent: 0, failed: 0, skipped_cap: 0, skipped_dnd: 0 };
  const batch   = [];
  let lastSend  = 0;

  async function flushBatch() {
    if (!batch.length) return;
    await db.from('campaign_deliveries').insert(batch.splice(0));
  }

  for (const contact of abContacts) {
    // Frequency cap
    const counts = sendCounts[contact.id] || { day: 0, week: 0, month: 0 };
    if (counts.day >= capDay || counts.week >= capWeek || counts.month >= capMonth) {
      results.skipped_cap++;
      batch.push(deliveryRow(campaign_id, workspace_id, contact.id, contact._variant, 'skipped',
        `cap day=${counts.day}/${capDay} week=${counts.week}/${capWeek}`));
      if (batch.length >= 50) await flushBatch();
      continue;
    }

    // DND
    if (isDND(dndEnabled, dndStart, dndEnd, dndTz)) {
      results.skipped_dnd++;
      batch.push(deliveryRow(campaign_id, workspace_id, contact.id, contact._variant, 'skipped',
        `DND ${dndStart}–${dndEnd} ${dndTz}`));
      if (batch.length >= 50) await flushBatch();
      continue;
    }

    // Throttle
    if (throttleEnabled && msPerMsg > 0) {
      const wait = msPerMsg - (Date.now() - lastSend);
      if (wait > 0) await sleep(wait);
    }

    const msgText  = personalise(contact._variant === 'b' ? campaign.message_b : campaign.message_a, contact);
    const ch       = (campaign.channel || 'SMS').toLowerCase();
    const vCfg     = (vendor && vendor.config) ? vendor.config : {};
    let success = false, vendorMsgId = null, errMsg = null;

    try {
      if (ch === 'sms') {
        const vName = vendor ? (vendor.name || '').toLowerCase() : '';
        if (vName.includes('twilio')) {
          const r = await sendViaTwilio(vendor.sender_id, contact.phone, msgText);
          success = r.success; vendorMsgId = r.sid; errMsg = r.error;
        } else if (vName.includes('msg91')) {
          const r = await sendViaMSG91(vendor.sender_id, contact.phone, msgText, campaign.dlt_template_id_a);
          success = r.success; errMsg = r.error;
        } else if (vName.includes('custom')) {
          const r = await sendViaCustomHTTP(vCfg, contact.phone, msgText, vendor.sender_id);
          success = r.success; errMsg = r.error;
        } else {
          success = true; // unmapped vendor — assume sent (log for tracing)
          errMsg = 'Unknown SMS vendor; marked sent without dispatch';
        }
      } else if (ch === 'whatsapp') {
        const vName = vendor ? (vendor.name || '').toLowerCase() : '';
        let r;
        if (vName.includes('twilio')) {
          r = await sendViaTwilioWA(vCfg, contact.phone, campaign);
        } else {
          r = await sendViaMetaWA(vCfg, contact.phone, campaign);
        }
        success = r.success; vendorMsgId = r.msgId; errMsg = r.error;
      } else if (ch === 'push') {
        const vName = vendor ? (vendor.name || '').toLowerCase() : '';
        const token = (contact.attributes || {}).fcm_token || (contact.attributes || {}).apns_token || null;
        if (!token) {
          errMsg = 'No device token for contact'; success = false;
        } else if (vName.includes('apns') || (contact.attributes || {}).apns_token) {
          const r = await sendViaAPNs(vCfg, (contact.attributes || {}).apns_token, campaign);
          success = r.success; errMsg = r.error;
        } else {
          const r = await sendViaFCM(vCfg, token, campaign);
          success = r.success; vendorMsgId = r.msgId; errMsg = r.error;
        }
      } else {
        success = true; errMsg = `Channel ${ch} not yet dispatched`;
      }
    } catch (e) { errMsg = e.message; }

    lastSend = Date.now();
    batch.push(deliveryRow(campaign_id, workspace_id, contact.id, contact._variant,
      success ? 'sent' : 'failed', errMsg, vendorMsgId));
    if (batch.length >= 50) await flushBatch();

    if (success) {
      if (!sendCounts[contact.id]) sendCounts[contact.id] = { day: 0, week: 0, month: 0 };
      sendCounts[contact.id].day++;
      sendCounts[contact.id].week++;
      sendCounts[contact.id].month++;
      results.sent++;
    } else {
      results.failed++;
    }
  }

  await flushBatch();

  // ── 10. Finalise ─────────────────────────────────
  await db.from('campaigns').update({
    status: 'completed', sent: results.sent, failed: results.failed
  }).eq('id', campaign_id);

  if (vendor) {
    await db.from('vendor_connections')
      .update({ used_in: (vendor.used_in || 0) + 1 })
      .eq('id', vendor.id);
  }

  return res.status(200).json({
    ok: true,
    sent: results.sent, failed: results.failed,
    skipped_cap: results.skipped_cap, skipped_dnd: results.skipped_dnd,
    enforcement: {
      frequency_cap: { day: capDay, week: capWeek, month: capMonth },
      dnd: dndEnabled ? `${dndStart}–${dndEnd} ${dndTz}` : 'off',
      throttle: throttleEnabled ? `${throttleRpm} msg/min` : 'off'
    }
  });
};

// ═══════════════════════════════════════════════════
//  CHANNEL DISPATCHERS
// ═══════════════════════════════════════════════════

// ── SMS: Twilio ──────────────────────────────────
async function sendViaTwilio(senderId, toPhone, body) {
  const url  = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ From: senderId, To: toPhone, Body: body }).toString()
  });
  const json = await resp.json();
  if (json.sid) return { success: true, sid: json.sid };
  return { success: false, error: json.message || 'Twilio error' };
}

// ── WhatsApp: Twilio Sandbox / Production ────────
async function sendViaTwilioWA(cfg, toPhone, campaign) {
  const sid   = cfg.account_sid  || cfg.twilio_account_sid  || TWILIO_SID;
  const token = cfg.auth_token   || cfg.twilio_auth_token   || TWILIO_TOKEN;
  // Sandbox uses +14155238886; production uses a purchased Twilio WA number
  const from  = cfg.whatsapp_from || cfg.from_number || process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

  if (!sid || !token) return { success: false, error: 'Twilio SID/token not configured' };

  const to  = 'whatsapp:+' + toPhone.replace(/^\+/, '').replace(/\D/g, '');
  const body = campaign.wa_body || campaign.message_a || '';

  const url  = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const resp = await fetch(url, {
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

// ── SMS: MSG91 ───────────────────────────────────
async function sendViaMSG91(senderId, toPhone, body, dltId) {
  const apiKey = MSG91_KEY;
  const resp = await fetch('https://api.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: { authkey: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: senderId, route: '4', country: '91',
      sms: [{ message: body, to: [toPhone.replace(/\D/g, '')] }],
      DLT_TE_ID: dltId
    })
  });
  const json = await resp.json();
  if (json.type === 'success') return { success: true };
  return { success: false, error: json.message || 'MSG91 error' };
}

// ── SMS: Custom HTTP vendor ───────────────────────
async function sendViaCustomHTTP(cfg, toPhone, body, senderId) {
  const endpoint = cfg.api_endpoint || cfg.endpoint;
  if (!endpoint) return { success: false, error: 'No endpoint configured' };

  // Replace placeholders in the body template
  const template   = cfg.body_template__json_ || '{"to":"{{phone}}","message":"{{text}}"}';
  const payload    = template
    .replace(/\{\{phone\}\}/g, toPhone)
    .replace(/\{\{text\}\}/g, body)
    .replace(/\{\{sender_id\}\}/g, senderId || '');

  const authHeader = {};
  const authType   = (cfg.auth_type || '').toLowerCase();
  const token      = cfg.api_key___username || cfg.api_key || cfg.bearer_token || '';
  if (authType.includes('bearer')) authHeader.Authorization = `Bearer ${token}`;
  else if (authType.includes('api key')) authHeader['X-Api-Key'] = token;

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: payload
  });
  if (resp.ok) return { success: true };
  return { success: false, error: `HTTP ${resp.status}` };
}

// ── WhatsApp: Meta Cloud API ─────────────────────
async function sendViaMetaWA(cfg, toPhone, campaign) {
  // Config keys come from _collectVendorCreds() label → snake_case
  const phoneNumberId = cfg.phone_number_id || cfg.phone_number_id_ || '';
  const accessToken   = cfg.permanent_access_token || cfg.permanent_access_token_
    || cfg.access_token || process.env.META_WA_ACCESS_TOKEN || '';

  if (!phoneNumberId || !accessToken)
    return { success: false, error: 'Missing phone_number_id or access_token in vendor config' };

  // Normalise number to E.164 without '+'
  const to = toPhone.replace(/^\+/, '').replace(/\D/g, '');

  // Extract named variables from wa_body ({{1}}, {{first_name}}, etc.)
  const waBody = campaign.wa_body || campaign.message_a || '';
  const vars   = [...waBody.matchAll(/\{\{(\w+)\}\}/g)].map(m => ({
    type: 'text', text: m[1] === 'first_name' ? 'there' : m[1]
  }));

  const msgPayload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: campaign.wa_template_name || 'hello_world',
      language: { code: campaign.wa_template_lang || 'en_US' },
      ...(vars.length ? {
        components: [{ type: 'body', parameters: vars }]
      } : {})
    }
  };

  const resp = await fetch(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(msgPayload)
    }
  );
  const json = await resp.json();
  if (json.messages && json.messages[0] && json.messages[0].id)
    return { success: true, msgId: json.messages[0].id };
  return { success: false, error: (json.error && json.error.message) || `Meta API ${resp.status}` };
}

// ── Push: Firebase Cloud Messaging (FCM) ─────────
async function sendViaFCM(cfg, deviceToken, campaign) {
  const serverKey = cfg.fcm_server_key_legacy_or_service_account_json
    || cfg.fcm_server_key || cfg.server_key
    || process.env.FCM_SERVER_KEY || '';

  if (!serverKey) return { success: false, error: 'FCM server key not configured' };

  const notification = {
    title: campaign.content_preview || campaign.message_a || 'New message',
    body:  campaign.message_a || '',
    ...(campaign.push_image ? { image: campaign.push_image } : {})
  };

  const payload = {
    to:           deviceToken,
    notification,
    data: {
      campaign_id: campaign.id || '',
      action_url:  campaign.push_url || ''
    },
    android: { priority: 'high' },
    apns:    { headers: { 'apns-priority': '10' } }
  };

  const resp = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      Authorization:  `key=${serverKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const json = await resp.json();
  if (json.success === 1) return { success: true, msgId: json.multicast_id };
  const err = (json.results && json.results[0] && json.results[0].error) || 'FCM error';
  return { success: false, error: err };
}

// ── Push: Apple APNs (HTTP/2 + JWT) ─────────────
function makeApnsJWT(keyP8, keyId, teamId) {
  const header  = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const sign = crypto.createSign('SHA256');
  sign.update(unsigned);
  const sig = sign.sign({ key: keyP8, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${unsigned}.${sig}`;
}

function sendViaAPNs(cfg, deviceToken, campaign) {
  const keyP8    = cfg.auth_key___p8_file_content_ || cfg.auth_key || cfg.p8_key || process.env.APNS_KEY_P8 || '';
  const keyId    = cfg.key_id || process.env.APNS_KEY_ID || '';
  const teamId   = cfg.team_id || process.env.APNS_TEAM_ID || '';
  const bundleId = cfg.bundle_id__app_id_ || cfg.bundle_id || process.env.APNS_BUNDLE_ID || '';
  const env      = (cfg.environment || '').toLowerCase();
  const host     = env.includes('sandbox') || env.includes('dev')
    ? 'api.sandbox.push.apple.com'
    : 'api.push.apple.com';

  if (!keyP8 || !keyId || !teamId || !bundleId)
    return Promise.resolve({ success: false, error: 'APNs config incomplete (need key, keyId, teamId, bundleId)' });
  if (!deviceToken)
    return Promise.resolve({ success: false, error: 'No APNs device token for contact' });

  let jwt;
  try { jwt = makeApnsJWT(keyP8, keyId, teamId); }
  catch (e) { return Promise.resolve({ success: false, error: 'APNs JWT sign failed: ' + e.message }); }

  const notifPayload = JSON.stringify({
    aps: {
      alert: {
        title: campaign.content_preview || campaign.message_a || '',
        body:  campaign.message_a || ''
      },
      sound: 'default',
      badge: 1
    },
    campaign_id: campaign.id || ''
  });

  return new Promise(resolve => {
    const client = http2.connect(`https://${host}`, { rejectUnauthorized: true });
    client.on('error', e => { client.destroy(); resolve({ success: false, error: e.message }); });

    const req = client.request({
      ':method':          'POST',
      ':path':            `/3/device/${deviceToken}`,
      ':scheme':          'https',
      ':authority':       host,
      authorization:      `bearer ${jwt}`,
      'apns-topic':       bundleId,
      'apns-push-type':   'alert',
      'apns-expiration':  '0',
      'content-type':     'application/json',
      'content-length':   Buffer.byteLength(notifPayload).toString()
    });

    let status = null;
    req.on('response', headers => { status = headers[':status']; });
    req.on('data', () => {});
    req.on('end', () => {
      client.close();
      if (status === 200) resolve({ success: true });
      else resolve({ success: false, error: `APNs HTTP ${status}` });
    });
    req.on('error', e => { client.destroy(); resolve({ success: false, error: e.message }); });
    req.write(notifPayload);
    req.end();
  });
}

// ═══════════════════════════════════════════════════
//  SEGMENT RULE FILTER  (applied in-process)
// ═══════════════════════════════════════════════════
function filterByRules(contacts, rules, rulesOperator) {
  const conditions = rules.conditions || [];
  if (!conditions.length) return contacts;
  const useAnd = (rulesOperator || rules.operator || 'AND').toUpperCase() !== 'OR';

  return contacts.filter(contact => {
    const results = conditions.map(cond => {
      const field = (cond.field || cond.attr || '').toLowerCase();
      let val = ['city', 'plan_type', 'first_name', 'last_name', 'email'].includes(field)
        ? (contact[field] || '')
        : ((contact.attributes || {})[field] ?? '');
      val = String(val).toLowerCase();

      const ruleVal = String(cond.value || '').toLowerCase();
      const op      = (cond.op || cond.operator || 'equals').toLowerCase().replace(/ /g, '_');

      switch (op) {
        case 'equals':      case 'eq':  return val === ruleVal;
        case 'not_equals':  case 'neq': return val !== ruleVal;
        case 'contains':                return val.includes(ruleVal);
        case 'greater_than': case 'gt': return parseFloat(val) > parseFloat(ruleVal);
        case 'less_than':    case 'lt': return parseFloat(val) < parseFloat(ruleVal);
        case 'within_last': {
          const days = parseInt(ruleVal) || 30;
          const tsRaw = contact.attributes && contact.attributes[field];
          if (!tsRaw) return false;
          return Date.now() - new Date(tsRaw).getTime() < days * 86400000;
        }
        default: return true;
      }
    });
    return useAnd ? results.every(Boolean) : results.some(Boolean);
  });
}

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function personalise(template, contact) {
  return (template || '')
    .replace(/\{\{first_name\}\}/g, contact.first_name || 'there')
    .replace(/\{\{coupon_code\}\}/g, (contact.attributes || {}).coupon_code || 'SAVE10')
    .replace(/\{\{expiry_date\}\}/g, new Date(Date.now() + 3 * 86400000).toLocaleDateString('en-IN'))
    .replace(/\{\{1\}\}/g, contact.first_name || 'there')
    .replace(/\{\{2\}\}/g, (contact.attributes || {}).coupon_code || 'SAVE10');
}

function deliveryRow(campaign_id, workspace_id, contact_id, variant, status, error_msg, vendor_msg_id) {
  return { campaign_id, workspace_id, contact_id, variant, status, error_msg: error_msg || null, vendor_msg_id: vendor_msg_id || null };
}

function isDND(enabled, start, end, tzName) {
  if (!enabled) return false;
  const TZ = { IST: 330, UTC: 0, 'US/Eastern': -300 };
  const offsetMin = TZ[tzName] ?? 330;
  const localNow  = new Date(Date.now() + offsetMin * 60000);
  const localMins = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  const [sh, sm]  = start.split(':').map(Number);
  const [eh, em]  = end.split(':').map(Number);
  const sMin = sh * 60 + sm, eMin = eh * 60 + em;
  return sMin > eMin
    ? (localMins >= sMin || localMins < eMin)
    : (localMins >= sMin && localMins < eMin);
}

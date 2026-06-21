// POST /api/send-test
// Sends a single real test message via the workspace's configured vendor.
// Used by the "Send Test" button in the campaign composer.
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { workspace_id, vendor_id, channel, phone, message } = req.body || {};
  if (!workspace_id || !vendor_id || !phone || !message) {
    return res.status(400).json({ error: 'workspace_id, vendor_id, phone, message required' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Fetch vendor config
  const { data: vendor, error: vErr } = await db
    .from('vendor_connections')
    .select('*')
    .eq('id', vendor_id)
    .eq('workspace_id', workspace_id)
    .single();

  if (vErr || !vendor) return res.status(404).json({ error: 'Vendor not found' });

  const cfg = vendor.config || {};
  const ch  = (channel || vendor.channel || 'SMS').toLowerCase();

  if (ch === 'whatsapp') {
    const vendorName = (vendor.name || '').toLowerCase();
    if (!vendorName.includes('twilio')) {
      return res.status(200).json({
        success: false,
        error: `Test sends via "${vendor.name}" are not supported yet. Go back to Step 1 and select your Twilio WhatsApp Sandbox vendor, then retry.`
      });
    }
    const result = await sendViaTwilioWA(cfg, phone, message);
    return res.status(200).json(result);
  } else {
    const result = await sendViaTwilioSMS(cfg, phone, message);
    return res.status(200).json(result);
  }
};

async function sendViaTwilioWA(cfg, toPhone, body) {
  const sid   = cfg.account_sid || process.env.TWILIO_ACCOUNT_SID;
  const token = cfg.auth_token  || process.env.TWILIO_AUTH_TOKEN;
  const from  = cfg.whatsapp_from || process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

  if (!sid || !token) return { success: false, error: 'Account SID / Auth Token not configured in vendor settings' };

  const to = 'whatsapp:+' + toPhone.replace(/^\+/, '').replace(/\D/g, '');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString()
  });
  const json = await resp.json();
  if (json.sid) return { success: true, sid: json.sid, to, from };
  return { success: false, error: json.message || `Twilio error ${resp.status}`, detail: json };
}

async function sendViaTwilioSMS(cfg, toPhone, body) {
  const sid   = cfg.account_sid || process.env.TWILIO_ACCOUNT_SID;
  const token = cfg.auth_token  || process.env.TWILIO_AUTH_TOKEN;
  const from  = cfg.sender_id   || cfg.from_number || process.env.TWILIO_FROM_NUMBER || '';

  if (!sid || !token) return { success: false, error: 'Account SID / Auth Token not configured in vendor settings' };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ From: from, To: toPhone, Body: body }).toString()
  });
  const json = await resp.json();
  if (json.sid) return { success: true, sid: json.sid };
  return { success: false, error: json.message || `Twilio error ${resp.status}` };
}

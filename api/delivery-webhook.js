// ═══════════════════════════════════════════════════
//  PingCRM — Delivery Status Webhook
//  POST /api/delivery-webhook?vendor=twilio  (or msg91)
//
//  Twilio and MSG91 call this URL automatically when
//  a message is delivered, clicked, or fails.
//  Configure this URL in your Twilio/MSG91 dashboard.
// ═══════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const vendor = req.query.vendor || 'twilio';

  let msgId, status, errorCode, errorMsg;

  if (vendor === 'twilio') {
    // Twilio sends form-encoded body
    msgId     = req.body.MessageSid;
    const raw = req.body.MessageStatus; // 'delivered' | 'undelivered' | 'failed' | 'sent'
    status    = mapTwilioStatus(raw);
    errorCode = req.body.ErrorCode;
    errorMsg  = req.body.ErrorMessage;
  } else if (vendor === 'msg91') {
    // MSG91 sends JSON
    msgId  = req.body.requestId || req.body.msgId;
    status = mapMSG91Status(req.body.status);
  }

  if (!msgId) return res.status(400).json({ error: 'No message ID in webhook' });

  // Find the delivery row by vendor_msg_id
  const { data: delivery } = await db
    .from('campaign_deliveries')
    .select('id, campaign_id, status')
    .eq('vendor_msg_id', msgId)
    .single();

  if (!delivery) return res.status(200).end(); // Unknown message, ignore

  // Only upgrade status (sent → delivered → clicked, never downgrade)
  const statusRank = { sent: 1, delivered: 2, clicked: 3, failed: 0 };
  if ((statusRank[status] || 0) <= (statusRank[delivery.status] || 0)) {
    return res.status(200).end();
  }

  // Update delivery row
  const updateData = { status, error_code: errorCode, error_msg: errorMsg };
  if (status === 'delivered') updateData.delivered_at = new Date().toISOString();
  if (status === 'clicked')   updateData.clicked_at   = new Date().toISOString();

  await db.from('campaign_deliveries').update(updateData).eq('id', delivery.id);

  // Re-aggregate campaign metrics from delivery rows
  const { data: agg } = await db
    .from('campaign_deliveries')
    .select('status')
    .eq('campaign_id', delivery.campaign_id);

  if (agg) {
    const counts = { sent: 0, delivered: 0, clicked: 0, failed: 0 };
    agg.forEach(function(d){ if (counts[d.status] !== undefined) counts[d.status]++; });
    await db.from('campaigns').update({
      sent:      counts.sent + counts.delivered + counts.clicked,
      delivered: counts.delivered + counts.clicked,
      clicked:   counts.clicked,
      failed:    counts.failed
    }).eq('id', delivery.campaign_id);
  }

  return res.status(200).end();
};

function mapTwilioStatus(s) {
  const m = { delivered: 'delivered', undelivered: 'failed', failed: 'failed', sent: 'sent', clicked: 'clicked' };
  return m[s] || 'sent';
}

function mapMSG91Status(s) {
  const m = { '1': 'delivered', '2': 'sent', '3': 'failed', '9': 'failed', '25': 'delivered' };
  return m[String(s)] || 'sent';
}

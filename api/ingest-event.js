// ═══════════════════════════════════════════════════
//  PingCRM — Event Ingestion API
//  POST /api/ingest-event
//  Body: { workspace_id, user_id, event, properties }
//
//  Called by your app/SDK when a user does something.
//  Applies attribute_rules to update the contact record.
//
//  Example:
//    POST /api/ingest-event
//    { workspace_id:"...", user_id:"...", event:"order_placed", properties:{amount:1200} }
// ═══════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const INGEST_SECRET        = process.env.INGEST_SECRET; // Optional auth header

module.exports = async function handler(req, res) {
  // CORS — allow cross-origin from any frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Optional API key check
  if (INGEST_SECRET && req.headers['x-api-key'] !== INGEST_SECRET) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const { workspace_id, user_id, event: eventName, properties = {} } = req.body;
  if (!workspace_id || !user_id || !eventName) {
    return res.status(400).json({ error: 'workspace_id, user_id, and event are required' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Upsert contact (create if first time seen)
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .upsert({
      workspace_id,
      phone: properties.phone || user_id,
      first_name: properties.first_name,
      email: properties.email,
      city: properties.city,
      updated_at: new Date().toISOString()
    }, { onConflict: 'workspace_id,phone', ignoreDuplicates: false })
    .select()
    .single();

  if (contactErr || !contact) {
    // Try a plain lookup if upsert failed
    const { data: existing } = await db.from('contacts')
      .select('*').eq('workspace_id', workspace_id).eq('phone', properties.phone || user_id).single();
    if (!existing) return res.status(500).json({ error: 'Could not find or create contact' });
  }

  const contactId = (contact || {}).id;

  // 2. Log the raw event
  await db.from('events').insert({
    workspace_id,
    contact_id: contactId,
    event_name: eventName,
    properties,
    source: 'api'
  });

  // 3. Fetch matching attribute rules for this event
  const { data: rules } = await db
    .from('attribute_rules')
    .select('*')
    .eq('workspace_id', workspace_id)
    .eq('event_name', eventName);

  if (rules && rules.length && contactId) {
    // Build attribute updates
    const { data: existing } = await db.from('contacts').select('attributes').eq('id', contactId).single();
    const attrs = (existing || {}).attributes || {};

    for (const rule of rules) {
      const key = rule.attribute_key;
      const expr = rule.value_expr;

      if (expr === 'increment +1') {
        attrs[key] = (parseInt(attrs[key] || 0) + 1);
      } else if (expr === 'event.timestamp') {
        attrs[key] = new Date().toISOString();
      } else if (expr.startsWith('event.')) {
        const propKey = expr.replace('event.', '');
        attrs[key] = properties[propKey] ?? null;
      } else {
        attrs[key] = expr; // literal value e.g. '1', 'true'
      }
    }

    await db.from('contacts')
      .update({ attributes: attrs, updated_at: new Date().toISOString() })
      .eq('id', contactId);
  }

  return res.status(200).json({ ok: true, contact_id: contactId, event: eventName, rules_applied: (rules || []).length });
};

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
//    { workspace_id:"...", user_id:"9876543210", event:"order_placed", properties:{amount:1200} }
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

  // 1. Resolve contact — try INSERT, fall back to SELECT on conflict
  const phone = properties.phone || user_id;
  let contactId = null;

  // First try to find an existing contact
  const { data: existing } = await db.from('contacts')
    .select('id')
    .eq('workspace_id', workspace_id)
    .eq('phone', phone)
    .maybeSingle();

  if (existing) {
    contactId = existing.id;
    // Update known fields
    const updates = { updated_at: new Date().toISOString() };
    if (properties.first_name) updates.first_name = properties.first_name;
    if (properties.email)      updates.email      = properties.email;
    if (properties.city)       updates.city       = properties.city;
    await db.from('contacts').update(updates).eq('id', contactId);
  } else {
    // Insert new contact
    const { data: created, error: insertErr } = await db.from('contacts').insert({
      workspace_id,
      phone,
      first_name: properties.first_name || null,
      email:      properties.email      || null,
      city:       properties.city       || null,
      opted_out:  false,
      updated_at: new Date().toISOString()
    }).select('id').single();

    if (!insertErr && created) {
      contactId = created.id;
    } else {
      // Race condition: another request inserted the same contact — try lookup again
      const { data: retry } = await db.from('contacts')
        .select('id').eq('workspace_id', workspace_id).eq('phone', phone).maybeSingle();
      if (retry) contactId = retry.id;
      // If still null, log event without contact (orphan event — visible in log)
    }
  }

  // 2. Log the raw event (contact_id may be null for unknown phones)
  const { data: evtRow } = await db.from('events').insert({
    workspace_id,
    contact_id:  contactId,
    event_name:  eventName,
    properties,
    source:      req.headers['x-source'] || 'api'
  }).select('id').single();

  // 3. Apply matching attribute rules
  const { data: rules } = await db
    .from('attribute_rules')
    .select('*')
    .eq('workspace_id', workspace_id)
    .eq('event_name', eventName);

  let rulesApplied = 0;
  if (rules && rules.length && contactId) {
    const { data: cRow } = await db.from('contacts').select('attributes').eq('id', contactId).single();
    const attrs = (cRow || {}).attributes || {};

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
        attrs[key] = expr;
      }
    }

    await db.from('contacts')
      .update({ attributes: attrs, updated_at: new Date().toISOString() })
      .eq('id', contactId);
    rulesApplied = rules.length;
  }

  // 4. Queue event-triggered campaigns (if campaign_queue table exists)
  let queued = 0;
  if (contactId) {
    try {
      const { data: triggerCampaigns } = await db.from('campaigns')
        .select('id, trigger_event, trigger_conditions, delay_amount, delay_unit')
        .eq('workspace_id', workspace_id)
        .eq('trigger_event', eventName)
        .eq('status', 'active');

      for (const camp of (triggerCampaigns || [])) {
        // Check additional conditions against contact properties
        const { data: cData } = await db.from('contacts').select('*').eq('id', contactId).single();
        if (!cData) continue;

        const conditions = Array.isArray(camp.trigger_conditions) ? camp.trigger_conditions : [];
        let pass = true;
        for (const cond of conditions) {
          const contactVal = String(cData[cond.field] || (cData.attributes || {})[cond.field] || '');
          const condVal    = String(cond.value || '');
          if (cond.op === 'equals'     && contactVal.toLowerCase() !== condVal.toLowerCase()) { pass = false; break; }
          if (cond.op === 'not equals' && contactVal.toLowerCase() === condVal.toLowerCase()) { pass = false; break; }
          if (cond.op === 'contains'   && !contactVal.toLowerCase().includes(condVal.toLowerCase())) { pass = false; break; }
          if (cond.op === 'greater than' && parseFloat(contactVal) <= parseFloat(condVal)) { pass = false; break; }
          if (cond.op === 'less than'    && parseFloat(contactVal) >= parseFloat(condVal)) { pass = false; break; }
        }
        if (!pass) continue;

        // Calculate fire_at based on delay
        let fireAt = new Date();
        const amount = parseInt(camp.delay_amount) || 0;
        const unit   = (camp.delay_unit || 'immediately').toLowerCase();
        if (amount > 0 && unit !== 'immediately') {
          const msMap = { minutes: 60000, hours: 3600000, days: 86400000 };
          fireAt = new Date(Date.now() + amount * (msMap[unit] || 0));
        }

        // Check not already queued for this campaign+contact combo
        const { data: existing } = await db.from('campaign_queue')
          .select('id').eq('campaign_id', camp.id).eq('contact_id', contactId)
          .eq('status', 'pending').maybeSingle();
        if (existing) continue;

        await db.from('campaign_queue').insert({
          workspace_id, campaign_id: camp.id, contact_id: contactId,
          fire_at: fireAt.toISOString(), status: 'pending'
        });
        queued++;
      }
    } catch (e) {
      // campaign_queue table may not exist yet — silently skip
    }
  }

  return res.status(200).json({
    ok: true,
    contact_id:    contactId,
    event:         eventName,
    event_id:      (evtRow || {}).id || null,
    rules_applied: rulesApplied,
    campaigns_queued: queued
  });
};

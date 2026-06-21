// POST /api/import-contacts
// Body: { workspace_id, segment_name, contacts: [{phone, name, email, extra}] }
// Creates a segment and upserts contacts using the service key (bypasses RLS).
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const BATCH = 200;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { workspace_id, segment_name, contacts } = req.body || {};
  if (!workspace_id || !segment_name || !Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'workspace_id, segment_name, and contacts[] required' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Create segment
  const { data: segRow, error: segErr } = await db
    .from('segments')
    .insert({
      workspace_id,
      name: segment_name,
      type: 'csv',
      rules: { source: 'csv_import', imported_at: new Date().toISOString() },
      contact_count: 0
    })
    .select()
    .single();

  if (segErr) return res.status(500).json({ error: 'Segment create failed: ' + segErr.message });
  const segmentId = segRow.id;

  // 2. Insert contacts in batches — SELECT existing phones first to avoid
  //    duplicate inserts without needing a unique constraint in the schema.
  let imported = 0;
  const allContactIds = [];

  for (let i = 0; i < contacts.length; i += BATCH) {
    const chunk = contacts.slice(i, i + BATCH);
    const phones = chunk.map(function(c) { return c.phone; });

    // Find which phones already exist
    const { data: existing } = await db
      .from('contacts')
      .select('id, phone')
      .eq('workspace_id', workspace_id)
      .in('phone', phones);

    const existingMap = {};
    (existing || []).forEach(function(c) { existingMap[c.phone] = c.id; });

    // Collect IDs of already-existing contacts
    (existing || []).forEach(function(c) { allContactIds.push(c.id); });

    // Insert only new contacts
    const newRows = chunk
      .filter(function(c) { return !existingMap[c.phone]; })
      .map(function(c) {
        return {
          workspace_id,
          phone: c.phone,
          name:  c.name  || null,
          email: c.email || null,
          opted_out: false
        };
      });

    if (newRows.length > 0) {
      const { data: inserted, error: insErr } = await db
        .from('contacts')
        .insert(newRows)
        .select('id');

      if (insErr) {
        console.error('contacts insert error:', insErr.message, insErr.code);
        return res.status(200).json({ ok: false, error: insErr.message, code: insErr.code, hint: insErr.hint });
      }
      if (inserted) {
        inserted.forEach(function(r) { allContactIds.push(r.id); });
      }
    }

    imported += (existing || []).length + newRows.length;
  }

  // 3. Link contacts to segment
  for (let j = 0; j < allContactIds.length; j += BATCH) {
    const jChunk = allContactIds.slice(j, j + BATCH);
    const jRows  = jChunk.map(function(cid) {
      return { segment_id: segmentId, contact_id: cid, workspace_id };
    });
    const { error: jErr } = await db
      .from('segment_contacts')
      .upsert(jRows, { onConflict: 'segment_id,contact_id', ignoreDuplicates: true });
    if (jErr) console.error('segment_contacts batch error:', jErr.message);
  }

  // 4. Update segment contact_count
  await db.from('segments').update({ contact_count: imported }).eq('id', segmentId);

  return res.status(200).json({ ok: true, segment_id: segmentId, imported, failed });
};

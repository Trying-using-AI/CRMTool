// PATCH /api/update-vendor
// Updates the config of an existing vendor_connections row (service key bypasses RLS)
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).json({ error: 'POST/PATCH only' });

  const { workspace_id, vendor_id, config, sender_id, name } = req.body || {};
  if (!workspace_id || !vendor_id) {
    return res.status(400).json({ error: 'workspace_id and vendor_id required' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const updates = {};
  if (config    !== undefined) updates.config    = config;
  if (sender_id !== undefined) updates.sender_id = sender_id;
  if (name      !== undefined) updates.name      = name;

  const { data: row, error } = await db
    .from('vendor_connections')
    .update(updates)
    .eq('id', vendor_id)
    .eq('workspace_id', workspace_id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, vendor: row });
};

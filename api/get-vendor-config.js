// GET /api/get-vendor-config?workspace_id=...&vendor_id=...
// Returns the full config for a single vendor (service key bypasses RLS).
// Used by the Edit Vendor modal to pre-fill credential fields.
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { workspace_id, vendor_id } = req.query;
  if (!workspace_id || !vendor_id) {
    return res.status(400).json({ error: 'workspace_id and vendor_id required' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: vendor, error } = await db
    .from('vendor_connections')
    .select('id, name, config, sender_id')
    .eq('id', vendor_id)
    .eq('workspace_id', workspace_id)
    .single();

  if (error || !vendor) return res.status(404).json({ error: 'Vendor not found' });

  return res.status(200).json({ ok: true, config: vendor.config || {}, sender_id: vendor.sender_id || '' });
};

// POST /api/save-vendor
// Saves a vendor connection to vendor_connections using the service key (bypasses RLS)
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { workspace_id, name, channel, sender_id, config } = req.body || {};
  if (!workspace_id || !name || !channel) {
    return res.status(400).json({ error: 'workspace_id, name, channel required' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: row, error } = await db.from('vendor_connections').insert({
    workspace_id,
    name,
    channel,
    sender_id: sender_id || '',
    status: 'active',
    config: config || {},
    used_in: 0,
    connected_at: new Date().toISOString()
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, vendor: row });
};

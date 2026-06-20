// GET /api/get-vendors?workspace_id=...
// Returns vendor connections for a workspace using the service key (bypasses RLS).
// Config values are NOT returned — only a `has_creds` flag so the frontend
// can show "Needs setup" without exposing secrets to the client.
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const workspace_id = req.query.workspace_id;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: rows, error } = await db
    .from('vendor_connections')
    .select('id, name, channel, sender_id, status, trial, used_in, connected_at, config')
    .eq('workspace_id', workspace_id)
    .order('connected_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Sanitize: replace config values with a boolean so the client knows
  // credentials are present without exposing secrets
  const vendors = (rows || []).map(function(v) {
    const cfg = v.config || {};
    const hasCreds = !!(cfg.account_sid || cfg.auth_token || cfg.api_key ||
                        cfg.permanent_access_token || cfg.access_token ||
                        cfg.phone_number_id || cfg.server_key || cfg.whatsapp_from);
    return {
      id:           v.id,
      name:         v.name,
      channel:      v.channel,
      sender_id:    v.sender_id,
      status:       v.status,
      trial:        v.trial,
      used_in:      v.used_in,
      connected_at: v.connected_at,
      has_creds:    hasCreds
    };
  });

  return res.status(200).json({ ok: true, vendors });
};

// ═══════════════════════════════════════════════════
//  PingCRM — Invite Team Member API
//  POST /api/invite-member  { email, role, workspace_id }
//  Header: Authorization: Bearer <caller's supabase access token>
//
//  Creates the member row, then sends an invite email via
//  Supabase Auth (free built-in mailer). The link lands the
//  invitee on /?invite=1 where they set a password.
// ═══════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_URL              = process.env.APP_URL || 'https://pingcrm-tau.vercel.app';

const VALID_ROLES = ['admin', 'editor', 'viewer'];
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)
    return res.status(500).json({ error: 'Server not configured: SUPABASE_URL / SUPABASE_SERVICE_KEY env vars missing' });

  const { email, role, workspace_id } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email address is required' });
  if (!VALID_ROLES.includes(role))     return res.status(400).json({ error: 'Role must be admin, editor or viewer' });
  if (!workspace_id)                   return res.status(400).json({ error: 'workspace_id required' });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── Caller must be signed in ─────────────────────
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in required to invite members' });
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller || !caller.user)
    return res.status(401).json({ error: 'Session expired — please sign in again' });
  if (caller.user.email && caller.user.email.toLowerCase() === email.toLowerCase())
    return res.status(400).json({ error: 'You are already a member of this workspace' });

  // ── Upsert member row (status: invited) ──────────
  const { error: insErr } = await admin.from('workspace_members').insert({
    workspace_id,
    email,
    role,
    status: 'invited',
    name: email.split('@')[0],
  });
  if (insErr) {
    if (insErr.code === '23505') {
      const { data: existing } = await admin
        .from('workspace_members')
        .select('status')
        .eq('workspace_id', workspace_id)
        .eq('email', email)
        .single();
      if (existing && existing.status === 'active')
        return res.status(409).json({ error: 'This person is already an active member' });
      // status "invited" → fall through and re-send the invite email
    } else {
      return res.status(500).json({ error: 'Could not save member: ' + insErr.message });
    }
  }

  // ── Send invite email via Supabase Auth ──────────
  const redirectTo = APP_URL + '/?invite=1';
  const { error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { role, workspace_id, invited_by: caller.user.email || 'a teammate' },
  });

  if (invErr) {
    const msg = (invErr.message || '').toLowerCase();
    // Invitee already has an auth account (e.g. re-invite) → send a
    // password-set link instead; it lands on the same set-password page.
    if (msg.includes('already') && (msg.includes('registered') || msg.includes('exists'))) {
      const { error: rstErr } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
      if (rstErr) return res.status(502).json({ error: 'Could not send invite email: ' + rstErr.message });
      return res.status(200).json({ ok: true, resent: true, message: 'Invite re-sent — they will get a link to set their password' });
    }
    if (msg.includes('rate limit') || msg.includes('rate_limit'))
      return res.status(429).json({ error: 'Email rate limit reached (free mailer allows a few emails per hour). Try again in an hour.' });
    return res.status(502).json({ error: 'Could not send invite email: ' + invErr.message });
  }

  return res.status(200).json({ ok: true, message: 'Invite email sent to ' + email });
};

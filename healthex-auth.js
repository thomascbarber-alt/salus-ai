/**
 * GET /api/healthex-auth
 *
 * Starts the HealthEx OAuth 2.0 + PKCE flow.
 * Generates a code_verifier/challenge, stores the verifier in a signed
 * session cookie, then redirects the patient to HealthEx for consent.
 *
 * Required Vercel env vars:
 *   HEALTHEX_CLIENT_ID   — from run-once-register-healthex.js
 *   SESSION_SECRET       — random 32-char string for signing cookies
 */

import crypto from 'crypto';

const CLIENT_ID    = process.env.HEALTHEX_CLIENT_ID;
const SESSION_SEC  = process.env.SESSION_SECRET || 'dev-secret-change-me';
const REDIRECT_URI = 'https://salusai.health/api/healthex-callback';
const AUTH_URL     = 'https://api.healthex.io/oauth/authorize';

export default function handler(req, res) {
  if (!CLIENT_ID) {
    return res.status(500).send('HEALTHEX_CLIENT_ID env var not set. Run run-once-register-healthex.js first.');
  }

  // ── PKCE ──────────────────────────────────────────────────────────────
  const codeVerifier  = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(
    crypto.createHash('sha256').update(codeVerifier).digest()
  );
  const state = base64url(crypto.randomBytes(16));

  // ── Store verifier + state in signed session cookie ──────────────────
  const sessionData = JSON.stringify({ codeVerifier, state });
  const signature   = sign(sessionData, SESSION_SEC);
  const cookieVal   = Buffer.from(sessionData).toString('base64') + '.' + signature;

  res.setHeader('Set-Cookie',
    `hx_session=${cookieVal}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  // ── Redirect to HealthEx consent page ─────────────────────────────────
  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    scope:                 'openid profile health:records:read',
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  });

  res.redirect(302, `${AUTH_URL}?${params}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function base64url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

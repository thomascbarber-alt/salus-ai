/**
 * GET /api/healthex-callback?code=...&state=...
 *
 * HealthEx redirects here after patient consent.
 * Exchanges the authorization code for an access token, stores it in
 * an encrypted httpOnly cookie, then returns the patient to the site.
 *
 * The httpOnly cookie means:
 *  - JavaScript (and XSS attacks) can NEVER read the raw token
 *  - The proxy reads it server-side on each API call
 *  - Patients stay logged-in to their records until the token expires
 */

import crypto from 'crypto';

const CLIENT_ID    = process.env.HEALTHEX_CLIENT_ID;
const SESSION_SEC  = process.env.SESSION_SECRET || 'dev-secret-change-me';
const TOKEN_SEC    = process.env.SESSION_SECRET || 'dev-secret-change-me';
const REDIRECT_URI = 'https://salusai.health/api/healthex-callback';
const TOKEN_URL    = 'https://api.healthex.io/oauth/token';

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  // ── Handle errors from HealthEx ───────────────────────────────────────
  if (error) {
    console.error('HealthEx OAuth error:', error);
    return res.redirect(302, '/health-decisions4.html?records=error&reason=' + encodeURIComponent(error));
  }

  if (!code || !state) {
    return res.status(400).send('Missing code or state parameter.');
  }

  // ── Verify session cookie ─────────────────────────────────────────────
  const cookieVal = parseCookie(req.headers.cookie, 'hx_session');
  if (!cookieVal) {
    return res.redirect(302, '/health-decisions4.html?records=error&reason=session_expired');
  }

  let codeVerifier;
  try {
    const [encoded, sig] = cookieVal.split('.');
    const data = Buffer.from(encoded, 'base64').toString('utf8');
    if (sign(data, SESSION_SEC) !== sig) throw new Error('invalid signature');
    const session = JSON.parse(data);
    if (session.state !== state) throw new Error('state mismatch');
    codeVerifier = session.codeVerifier;
  } catch (e) {
    console.error('Session validation failed:', e.message);
    return res.redirect(302, '/health-decisions4.html?records=error&reason=session_invalid');
  }

  // ── Exchange code for token ───────────────────────────────────────────
  let tokenData;
  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     CLIENT_ID,
        redirect_uri:  REDIRECT_URI,
        code,
        code_verifier: codeVerifier,
      }).toString()
    });
    tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error || 'token exchange failed');
  } catch (e) {
    console.error('Token exchange error:', e.message);
    return res.redirect(302, '/health-decisions4.html?records=error&reason=token_exchange');
  }

  // ── Encrypt token and store in httpOnly cookie ────────────────────────
  // Store access_token + optional refresh_token as encrypted JSON
  const tokenPayload = JSON.stringify({
    access_token:  tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    expires_at:    Date.now() + ((tokenData.expires_in || 3600) * 1000)
  });

  const encrypted = encrypt(tokenPayload, TOKEN_SEC);

  // Clear the PKCE session cookie, set the encrypted token cookie
  res.setHeader('Set-Cookie', [
    `hx_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    `hx_token=${encrypted}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`
  ]);

  // ── Redirect back to site with success signal ─────────────────────────
  // The page detects ?records=connected and updates the UI
  res.redirect(302, '/health-decisions4.html?records=connected');
}

// ── Crypto helpers ────────────────────────────────────────────────────────

function encrypt(plaintext, secret) {
  const key = crypto.scryptSync(secret, 'salus-salt', 32);
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';')
    .map(c => c.trim().split('='))
    .find(([k]) => k === name);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Caedrix AI — Free Trial helpers (shared backend utility)
 * ==========================================================
 * Used only by /api/trial-start.js and /api/trial-verify.js.
 * Files starting with "_" are not exposed as URLs by Vercel.
 *
 * ── ENV VARS (Vercel → Settings → Environment Variables) ──
 *   RESEND_API_KEY     (required) API key from resend.com
 *   TRIAL_FROM_EMAIL   (optional) default: "Caedrix AI <verify@caedrix.com>"
 *   TRIAL_DAILY_CAP    (optional) max free trials granted per day, default 30
 *   KV_REST_API_URL / KV_REST_API_TOKEN  (already set for the token system)
 *
 * ── DATA MODEL ──
 * trial:granted:{canonicalEmail}  -> { email, at }   permanent; one trial ever
 * trial:code:{canonicalEmail}     -> { hash, email, attempts }  expires in 10 min
 * trial:cooldown:{canonicalEmail} -> "1"   expires in 60 s (resend throttle)
 * trial:ip:{ip}                   -> count expires in 1 hour (send throttle)
 * trial:daily:{YYYY-MM-DD}        -> count of trials granted that day
 * trial:total                     -> count of all trials ever granted
 */

const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const { normalizeEmail } = require('./_tokenLedger');

const TRIAL_CREDITS = 2;
const CODE_TTL_SECONDS = 600;          // code valid for 10 minutes
const MAX_VERIFY_ATTEMPTS = 5;         // wrong guesses before code is killed
const RESEND_COOLDOWN_SECONDS = 60;    // one code email per minute per address
const MAX_SENDS_PER_IP_PER_HOUR = 5;   // stops one person farming many emails

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Common throwaway-email services. Add more here if you see abuse.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org',
  'temp-mail.io', 'tempmailo.com', 'throwawaymail.com', 'yopmail.com',
  'yopmail.net', 'getnada.com', 'nada.email', 'trashmail.com', 'trashmail.de',
  'dispostable.com', 'maildrop.cc', 'mohmal.com', 'fakeinbox.com',
  'emailondeck.com', 'mintemail.com', 'mytemp.email', 'tempinbox.com',
  'burnermail.io', 'spamgourmet.com', 'mailnesia.com', 'moakt.com',
  'tmail.ws', 'tmpmail.org', 'tmpmail.net', 'discard.email', 'inboxkitten.com'
]);

function getRedis() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV_REST_API_URL / KV_REST_API_TOKEN are not set.');
  return new Redis({ url, token });
}

function dailyCap() {
  const n = parseInt(process.env.TRIAL_DAILY_CAP || '30', 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function isValidEmail(email) {
  const e = normalizeEmail(email);
  return e.length <= 254 && EMAIL_RE.test(e);
}

function isDisposable(email) {
  const domain = normalizeEmail(email).split('@')[1] || '';
  return DISPOSABLE_DOMAINS.has(domain);
}

/**
 * Collapses address tricks so one person can't claim many trials:
 *   Tom+1@Gmail.com, t.om@gmail.com, tom@googlemail.com -> tom@gmail.com
 * Used ONLY for trial bookkeeping. Credits still go to the email the person
 * typed (normalized the usual way), so it matches their token balance.
 */
function canonicalEmail(email) {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  local = local.split('+')[0];
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Codes are stored hashed, never in plain text.
function hashCode(email, code) {
  return crypto
    .createHash('sha256')
    .update(`${canonicalEmail(email)}:${code}:${process.env.KV_REST_API_TOKEN || ''}`)
    .digest('hex');
}

function codesMatch(storedHash, email, code) {
  const a = Buffer.from(String(storedHash || ''), 'hex');
  const b = Buffer.from(hashCode(email, code), 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function todayKey() {
  return 'trial:daily:' + new Date().toISOString().slice(0, 10);
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return String(req.headers['x-real-ip'] || 'unknown');
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body;
}

async function sendCodeEmail(to, code) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set.');
  const from = process.env.TRIAL_FROM_EMAIL || 'Caedrix AI <verify@caedrix.com>';

  const html = `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f9;padding:32px 0;">
  <tr><td align="center">
    <table width="480" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
      <tr><td style="background:#0c1e3a;padding:22px 32px;color:#ffffff;font-size:20px;font-weight:bold;">Caedrix AI</td></tr>
      <tr><td style="padding:32px;color:#1f2a3a;font-size:15px;line-height:1.6;">
        <p style="margin:0 0 16px 0;">Your code for 2 free searches:</p>
        <p style="margin:0 0 24px 0;font-size:34px;font-weight:bold;letter-spacing:8px;color:#0a7c6e;">${code}</p>
        <p style="margin:0 0 16px 0;">Enter it on caedrix.com to start. The code expires in 10 minutes.</p>
        <p style="margin:0;color:#7a8597;font-size:13px;">If you didn't ask for this, you can ignore this email.</p>
      </td></tr>
      <tr><td style="background:#f4f6f9;padding:16px 32px;color:#7a8597;font-size:12px;">Caedrix AI provides health information, not medical advice.</td></tr>
    </table>
  </td></tr>
</table>`;

  const text = `Your Caedrix AI code for 2 free searches: ${code}\n\nEnter it on caedrix.com. It expires in 10 minutes.\nIf you didn't ask for this, ignore this email.`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `${code} is your Caedrix AI code`,
      html,
      text
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend error ${res.status}: ${detail}`);
  }
}

module.exports = {
  TRIAL_CREDITS,
  CODE_TTL_SECONDS,
  MAX_VERIFY_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  MAX_SENDS_PER_IP_PER_HOUR,
  getRedis,
  dailyCap,
  isValidEmail,
  isDisposable,
  canonicalEmail,
  generateCode,
  hashCode,
  codesMatch,
  todayKey,
  clientIp,
  parseBody,
  sendCodeEmail
};

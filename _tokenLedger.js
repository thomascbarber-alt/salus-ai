/**
 * Caedrix AI — Token Ledger (shared backend utility)
 * =====================================================
 * Wraps Vercel KV / Upstash Redis access for the token system.
 * Imported only by /api/*.js serverless functions — never by frontend code
 * (this file uses the KV secret token, which must stay server-side).
 *
 * ── SETUP REQUIRED (see .env.example) ──
 * Requires these environment variables in your Vercel project:
 *   KV_REST_API_URL
 *   KV_REST_API_TOKEN
 * (Created automatically if you provision Vercel KV from the Vercel
 * dashboard's Storage tab. If using Upstash directly instead of Vercel KV,
 * use their equivalent REST URL/token — same shape, same npm package.)
 *
 * ── DATA MODEL ──
 * user:{email}                    -> JSON { tokens: number, history: [...] }
 * code:{CODE}                     -> JSON { label, tokensGranted,
 *                                            maxRedemptions, redemptions,
 *                                            createdAt, active }
 * code:{CODE}:redeemedBy:{email}  -> "1"  (prevents the same person
 *                                          redeeming a code twice)
 *
 * Emails are lowercased/trimmed before use as keys, so the same person
 * can't get two balances by capitalizing their email differently.
 */

const { Redis } = require('@upstash/redis');

function getClient() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      'KV_REST_API_URL / KV_REST_API_TOKEN are not set. ' +
      'Provision Vercel KV (or Upstash Redis) and add these env vars before tokens can work.'
    );
  }
  return new Redis({ url, token });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// ---------- User balances ----------

async function getUser(email) {
  const key = normalizeEmail(email);
  const redis = getClient();
  const data = await redis.get(`user:${key}`);
  return data || { tokens: 0, history: [] };
}

async function addTokens(email, count, reason) {
  const key = normalizeEmail(email);
  const redis = getClient();
  const user = await getUser(key);
  user.tokens += count;
  user.history = user.history || [];
  user.history.push({ type: 'credit', amount: count, reason, at: Date.now() });
  if (user.history.length > 200) user.history = user.history.slice(-200);
  await redis.set(`user:${key}`, user);
  return user;
}

/**
 * Atomically spends one token if available. Returns { ok: true, remaining }
 * or { ok: false, remaining } if balance was already 0.
 * NOTE: Upstash Redis REST doesn't provide a true multi-key transaction
 * here, but since each user's record is a single key, get+set is safe
 * enough at this app's scale. For high-concurrency needs later, switch to
 * a Lua script via redis.eval() for a guaranteed atomic decrement.
 */
async function spendToken(email, reason) {
  const key = normalizeEmail(email);
  const redis = getClient();
  const user = await getUser(key);
  if (user.tokens <= 0) {
    return { ok: false, remaining: 0 };
  }
  user.tokens -= 1;
  user.history = user.history || [];
  user.history.push({ type: 'debit', amount: 1, reason, at: Date.now() });
  if (user.history.length > 200) user.history = user.history.slice(-200);
  await redis.set(`user:${key}`, user);
  return { ok: true, remaining: user.tokens };
}

// ---------- Influencer / physician codes ----------

async function createCode(code, { label, tokensGranted, maxRedemptions }) {
  const redis = getClient();
  const existing = await redis.get(`code:${code}`);
  if (existing) throw new Error('CODE_ALREADY_EXISTS');
  const record = {
    label: label || '',
    tokensGranted: tokensGranted || 1,
    maxRedemptions: maxRedemptions || 1,
    redemptions: 0,
    createdAt: Date.now(),
    active: true
  };
  await redis.set(`code:${code}`, record);
  return record;
}

async function getCode(code) {
  const redis = getClient();
  return await redis.get(`code:${code}`);
}

async function listCodes() {
  const redis = getClient();
  const keys = await redis.keys('code:*');
  // Filter out per-user redemption tracking keys (code:X:redeemedBy:Y)
  const codeKeys = keys.filter(k => k.split(':').length === 2);
  const records = await Promise.all(codeKeys.map(async k => ({
    code: k.replace('code:', ''),
    ...(await redis.get(k))
  })));
  return records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * Redeems a code for a given email. Returns:
 *   { ok: true, tokensGranted, remaining }
 *   { ok: false, error: 'NOT_FOUND' | 'INACTIVE' | 'EXHAUSTED' | 'ALREADY_REDEEMED' }
 */
async function redeemCode(code, email) {
  const key = normalizeEmail(email);
  const redis = getClient();
  const record = await redis.get(`code:${code}`);
  if (!record) return { ok: false, error: 'NOT_FOUND' };
  if (!record.active) return { ok: false, error: 'INACTIVE' };
  if (record.redemptions >= record.maxRedemptions) return { ok: false, error: 'EXHAUSTED' };

  const alreadyRedeemedKey = `code:${code}:redeemedBy:${key}`;
  const already = await redis.get(alreadyRedeemedKey);
  if (already) return { ok: false, error: 'ALREADY_REDEEMED' };

  record.redemptions += 1;
  await redis.set(`code:${code}`, record);
  await redis.set(alreadyRedeemedKey, '1');

  const user = await addTokens(key, record.tokensGranted, `code:${code}`);
  return { ok: true, tokensGranted: record.tokensGranted, remaining: user.tokens };
}

async function deactivateCode(code) {
  const redis = getClient();
  const record = await redis.get(`code:${code}`);
  if (!record) throw new Error('NOT_FOUND');
  record.active = false;
  await redis.set(`code:${code}`, record);
  return record;
}

module.exports = {
  normalizeEmail,
  getUser,
  addTokens,
  spendToken,
  createCode,
  getCode,
  listCodes,
  redeemCode,
  deactivateCode
};

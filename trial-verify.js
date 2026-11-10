/**
 * POST /api/trial-verify   body: { email, code }
 * Checks the emailed code and, if correct, grants 2 free searches (once ever).
 *
 * Responses:
 *   { ok: true, tokensGranted: 2, remaining }
 *   { ok: false, error: 'INVALID_EMAIL' | 'INVALID_CODE' | 'CODE_EXPIRED'
 *                       | 'WRONG_CODE' (+ attemptsLeft) | 'TOO_MANY_ATTEMPTS'
 *                       | 'ALREADY_CLAIMED' | 'DAILY_LIMIT' | 'SERVER_ERROR' }
 */

const { normalizeEmail, addTokens } = require('./_tokenLedger');
const T = require('./_trial');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = T.parseBody(req);
    const email = normalizeEmail(body.email);
    const code = String(body.code || '').replace(/\D/g, '');

    if (!T.isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'INVALID_EMAIL' });
    }
    if (code.length !== 6) {
      return res.status(400).json({ ok: false, error: 'INVALID_CODE' });
    }

    const canon = T.canonicalEmail(email);
    const redis = T.getRedis();
    const codeKey = `trial:code:${canon}`;

    const record = await redis.get(codeKey);
    if (!record) {
      return res.status(200).json({ ok: false, error: 'CODE_EXPIRED' });
    }

    if ((record.attempts || 0) >= T.MAX_VERIFY_ATTEMPTS) {
      await redis.del(codeKey);
      return res.status(200).json({ ok: false, error: 'TOO_MANY_ATTEMPTS' });
    }

    if (!T.codesMatch(record.hash, email, code)) {
      record.attempts = (record.attempts || 0) + 1;
      const ttl = await redis.ttl(codeKey);
      await redis.set(codeKey, record, { ex: ttl > 0 ? ttl : 60 });
      return res.status(200).json({
        ok: false,
        error: 'WRONG_CODE',
        attemptsLeft: Math.max(0, T.MAX_VERIFY_ATTEMPTS - record.attempts)
      });
    }

    // Correct code — it can only be used once.
    await redis.del(codeKey);

    // Claim the trial atomically (NX = only if not already set).
    const grantedKey = `trial:granted:${canon}`;
    const claimed = await redis.set(grantedKey, { email, at: Date.now() }, { nx: true });
    if (!claimed) {
      return res.status(200).json({ ok: false, error: 'ALREADY_CLAIMED' });
    }

    // Enforce the daily spending cap.
    const dayKey = T.todayKey();
    const countToday = await redis.incr(dayKey);
    if (countToday === 1) await redis.expire(dayKey, 60 * 60 * 48);
    if (countToday > T.dailyCap()) {
      await redis.decr(dayKey);
      await redis.del(grantedKey); // give them their trial back for tomorrow
      return res.status(200).json({ ok: false, error: 'DAILY_LIMIT' });
    }

    await redis.incr('trial:total');
    const user = await addTokens(email, T.TRIAL_CREDITS, 'free-trial');

    return res.status(200).json({
      ok: true,
      tokensGranted: T.TRIAL_CREDITS,
      remaining: user.tokens
    });
  } catch (err) {
    console.error('trial-verify error:', err);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
};

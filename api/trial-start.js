/**
 * POST /api/trial-start   body: { email }
 * Emails a 6-digit code that unlocks 2 free searches.
 *
 * Responses:
 *   { ok: true }
 *   { ok: false, error: 'INVALID_EMAIL' | 'DISPOSABLE_EMAIL' | 'ALREADY_CLAIMED'
 *                       | 'DAILY_LIMIT' | 'TOO_MANY_REQUESTS' | 'RESEND_TOO_SOON'
 *                       | 'SEND_FAILED' | 'SERVER_ERROR' }
 */

const { normalizeEmail } = require('./_tokenLedger');
const T = require('./_trial');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = T.parseBody(req);
    const email = normalizeEmail(body.email);

    if (!T.isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'INVALID_EMAIL' });
    }
    if (T.isDisposable(email)) {
      return res.status(400).json({ ok: false, error: 'DISPOSABLE_EMAIL' });
    }

    const canon = T.canonicalEmail(email);
    const redis = T.getRedis();

    // One free trial per person, ever.
    if (await redis.get(`trial:granted:${canon}`)) {
      return res.status(200).json({ ok: false, error: 'ALREADY_CLAIMED' });
    }

    // Spending cap: stop granting once today's limit is reached.
    const usedToday = Number(await redis.get(T.todayKey())) || 0;
    if (usedToday >= T.dailyCap()) {
      return res.status(200).json({ ok: false, error: 'DAILY_LIMIT' });
    }

    // Per-IP throttle.
    const ipKey = `trial:ip:${T.clientIp(req)}`;
    const ipCount = await redis.incr(ipKey);
    if (ipCount === 1) await redis.expire(ipKey, 3600);
    if (ipCount > T.MAX_SENDS_PER_IP_PER_HOUR) {
      return res.status(429).json({ ok: false, error: 'TOO_MANY_REQUESTS' });
    }

    // Per-email resend throttle.
    const cooldownKey = `trial:cooldown:${canon}`;
    const cooldownSet = await redis.set(cooldownKey, '1', { nx: true, ex: T.RESEND_COOLDOWN_SECONDS });
    if (!cooldownSet) {
      return res.status(429).json({ ok: false, error: 'RESEND_TOO_SOON' });
    }

    const code = T.generateCode();
    await redis.set(
      `trial:code:${canon}`,
      { hash: T.hashCode(email, code), email, attempts: 0 },
      { ex: T.CODE_TTL_SECONDS }
    );

    try {
      await T.sendCodeEmail(email, code);
    } catch (sendErr) {
      console.error('Trial code email failed:', sendErr);
      await redis.del(cooldownKey);           // let them retry right away
      await redis.del(`trial:code:${canon}`);
      return res.status(502).json({ ok: false, error: 'SEND_FAILED' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('trial-start error:', err);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
};

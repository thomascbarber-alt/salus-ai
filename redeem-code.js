/**
 * Caedrix AI — Redeem a Gift Code
 * ==================================
 * POST /api/redeem-code
 * Body: { code: string, email: string }
 * Returns:
 *   { ok: true, tokensGranted, remaining }
 *   { ok: false, error: 'NOT_FOUND' | 'INACTIVE' | 'EXHAUSTED' | 'ALREADY_REDEEMED' | 'INVALID_EMAIL' }
 *
 * Codes are created via the password-protected /admin.html page (which
 * calls /api/admin/create-code). Each code can be capped to a maximum
 * number of redemptions, and a given email can only redeem any one code
 * once (tracked server-side, not by trusting the browser).
 */

const { redeemCode, normalizeEmail } = require('./_tokenLedger');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const { code, email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ ok: false, error: 'INVALID_EMAIL' });
    return;
  }
  if (!code || typeof code !== 'string' || !code.trim()) {
    res.status(400).json({ ok: false, error: 'MISSING_CODE' });
    return;
  }

  try {
    const result = await redeemCode(code.trim().toUpperCase(), normalizeEmail(email));
    res.status(200).json(result);
  } catch (err) {
    console.error('Redeem code error:', err);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: err.message });
  }
};

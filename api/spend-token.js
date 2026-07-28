/**
 * Caedrix AI — Spend One Token
 * ===============================
 * POST /api/spend-token
 * Body: { email: string, reason?: string }
 * Returns: { ok: true, remaining } or { ok: false, remaining: 0 }
 *
 * Call this immediately BEFORE running a search (Health Decisions,
 * Determine Diagnosis, or Understand Diagnosis). It atomically deducts one
 * token from the user's server-side balance. If { ok: false }, block the
 * search and prompt the user to buy more tokens or redeem a code — do NOT
 * run the search anyway.
 *
 * This must be checked server-side (not just a locally cached number) —
 * otherwise a user could edit their local folder's token count and get
 * free searches.
 */

const { spendToken, normalizeEmail } = require('./_tokenLedger');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const { email, reason } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'INVALID_EMAIL' });
    return;
  }

  try {
    const result = await spendToken(normalizeEmail(email), reason || 'search');
    res.status(200).json(result);
  } catch (err) {
    console.error('Spend token error:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
};

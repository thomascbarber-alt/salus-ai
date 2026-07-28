/**
 * Caedrix AI — Admin: List Gift Codes
 * ======================================
 * GET /api/admin/list-codes
 * Headers: { Authorization: "Bearer <ADMIN_PASSWORD>" }
 * Returns: { ok: true, codes: [{ code, label, tokensGranted, maxRedemptions,
 *            redemptions, createdAt, active }, ...] }
 *
 * Used by admin.html to show usage stats per influencer/physician code —
 * how many times each code has been redeemed, so you can see who's
 * actually driving signups.
 */

const { listCodes } = require('../_tokenLedger');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const { ADMIN_PASSWORD } = process.env;
  if (!ADMIN_PASSWORD) {
    res.status(500).json({ error: 'NOT_CONFIGURED', message: 'ADMIN_PASSWORD env var is not set.' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const providedPassword = authHeader.replace(/^Bearer\s+/i, '');
  if (providedPassword !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  try {
    const codes = await listCodes();
    res.status(200).json({ ok: true, codes });
  } catch (err) {
    console.error('List codes error:', err);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: err.message });
  }
};

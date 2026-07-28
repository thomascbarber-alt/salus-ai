/**
 * Caedrix AI — Check Token Balance
 * ===================================
 * GET /api/token-balance?email=user@example.com
 * Returns: { tokens: number }
 *
 * This is the source of truth for "how many searches does this person have
 * left" — always check here rather than trusting any locally cached number,
 * since a local file/value could be edited by the user.
 */

const { getUser, normalizeEmail } = require('./_tokenLedger');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const email = req.query.email;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'INVALID_EMAIL' });
    return;
  }

  try {
    const user = await getUser(normalizeEmail(email));
    res.status(200).json({ tokens: user.tokens });
  } catch (err) {
    console.error('Token balance lookup error:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
};

/**
 * Caedrix AI — Admin: Deactivate Gift Code
 * ===========================================
 * POST /api/admin/deactivate-code
 * Headers: { Authorization: "Bearer <ADMIN_PASSWORD>" }
 * Body: { code: string }
 * Returns: { ok: true, ...record } or { ok: false, error }
 *
 * Use this if a code leaks publicly or is being abused — it stops future
 * redemptions without affecting tokens already granted to people who
 * already used it.
 */

const { deactivateCode } = require('../_tokenLedger');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
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

  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    res.status(400).json({ ok: false, error: 'MISSING_CODE' });
    return;
  }

  try {
    const record = await deactivateCode(code.trim().toUpperCase());
    res.status(200).json({ ok: true, ...record });
  } catch (err) {
    if (err.message === 'NOT_FOUND') {
      res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      return;
    }
    console.error('Deactivate code error:', err);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: err.message });
  }
};

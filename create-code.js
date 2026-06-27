/**
 * Caedrix AI — Admin: Create Gift Code
 * =======================================
 * POST /api/admin/create-code
 * Headers: { Authorization: "Bearer <ADMIN_PASSWORD>" }
 * Body: { label: string, tokensGranted?: number, maxRedemptions?: number, customCode?: string }
 * Returns: { ok: true, code, ...record } or { ok: false, error }
 *
 * Protected by a single shared admin password (not a full user account
 * system — appropriate for a single-operator admin tool). Set this in
 * Vercel env vars as ADMIN_PASSWORD. Never commit this value into code.
 *
 * If customCode isn't provided, a readable code is auto-generated from the
 * label, e.g. label "Dr. Smith" -> "DRSMITH-X7K2".
 */

const { createCode } = require('../_tokenLedger');

function generateCode(label) {
  const base = (label || 'CAEDRIX')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10) || 'CAEDRIX';
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}-${suffix}`;
}

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

  const { label, tokensGranted, maxRedemptions, customCode } = req.body || {};

  let code = (customCode || generateCode(label)).trim().toUpperCase();

  try {
    // Retry a couple times in case of a random collision on auto-generated codes
    let record = null;
    let attempts = 0;
    while (!record && attempts < 5) {
      try {
        record = await createCode(code, {
          label: label || '',
          tokensGranted: Number(tokensGranted) || 1,
          maxRedemptions: Number(maxRedemptions) || 1
        });
      } catch (err) {
        if (err.message === 'CODE_ALREADY_EXISTS' && !customCode) {
          code = generateCode(label);
          attempts++;
        } else {
          throw err;
        }
      }
    }
    if (!record) {
      res.status(409).json({ ok: false, error: 'COULD_NOT_GENERATE_UNIQUE_CODE' });
      return;
    }
    res.status(200).json({ ok: true, code, ...record });
  } catch (err) {
    console.error('Create code error:', err);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: err.message });
  }
};

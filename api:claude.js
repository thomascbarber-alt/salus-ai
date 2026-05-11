/**
 * POST /api/claude
 *
 * Anthropic API proxy for Salus AI.
 * - API key lives in ANTHROPIC_API_KEY env var (never sent to browser)
 * - If the patient has linked their HealthEx records (hx_token cookie),
 *   the proxy attaches the HealthEx MCP server so Claude can read their
 *   records and personalize every answer automatically.
 *
 * Required Vercel env vars:
 *   ANTHROPIC_API_KEY    — your Anthropic API key
 *   SESSION_SECRET       — same secret used in healthex-callback.js
 */

import crypto from 'crypto';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TOKEN_SEC     = process.env.SESSION_SECRET || 'dev-secret-change-me';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured.' });
  }

  const body = { ...req.body };

  // Attach HealthEx MCP if the patient has linked their records
  const healthexToken = getHealthexToken(req);
  if (healthexToken) {
    body.mcp_servers = [
      {
        type:                'url',
        url:                 'https://api.healthex.io/mcp',
        name:                'HealthEx',
        authorization_token: healthexToken,
        tool_configuration: {
          enabled: true,
          allowed_tools: [
            'get_health_summary','get_conditions','get_medications',
            'get_labs','get_vitals','get_allergies',
            'get_immunizations','get_procedures','get_visits'
          ]
        }
      }
    ];
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'mcp-client-2025-11-20',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    res.setHeader('Content-Type', 'application/json');
    return res.status(response.status).json(data);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(502).json({ error: 'Upstream error', detail: err.message });
  }
}

function getHealthexToken(req) {
  const encrypted = parseCookie(req.headers.cookie, 'hx_token');
  if (!encrypted) return null;
  try {
    const payload = decrypt(encrypted, TOKEN_SEC);
    const { access_token, expires_at } = JSON.parse(payload);
    if (expires_at && Date.now() > expires_at) return null;
    return access_token;
  } catch (e) {
    return null;
  }
}

function decrypt(encryptedHex, secret) {
  const key = crypto.scryptSync(secret, 'salus-salt', 32);
  const [ivHex, dataHex] = encryptedHex.split(':');
  const iv        = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');
  const decipher  = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';')
    .map(c => c.trim().split('='))
    .find(([k]) => k === name);
  return match ? decodeURIComponent(match.slice(1).join('=')) : null;
}

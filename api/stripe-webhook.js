/**
 * Caedrix AI — Stripe Webhook Handler
 * ======================================
 * POST /api/stripe-webhook
 *
 * THIS is the only place token purchases actually get credited. The
 * frontend never tells the backend "I paid, give me tokens" — Stripe tells
 * us directly, server-to-server, with a cryptographic signature we verify.
 * This prevents anyone from forging a "payment succeeded" request to get
 * free tokens.
 *
 * ── SETUP REQUIRED ──
 * 1. STRIPE_SECRET_KEY (same as create-checkout-session.js)
 * 2. STRIPE_WEBHOOK_SECRET — after deploying, go to Stripe Dashboard >
 *    Developers > Webhooks > Add endpoint, point it at:
 *      https://caedrix.com/api/stripe-webhook
 *    listening for event: checkout.session.completed
 *    Stripe will then show a signing secret (starts with "whsec_") — put
 *    that value in this env var.
 *
 * ── VERCEL CONFIG NOTE ──
 * Stripe webhooks need the RAW request body to verify the signature, not
 * the JSON-parsed body. This requires disabling Vercel's automatic body
 * parsing for this route — see the `config` export below.
 */

const Stripe = require('stripe');
const { addTokens } = require('./_tokenLedger');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = process.env;
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    console.error('Stripe webhook env vars not configured.');
    res.status(500).end();
    return;
  }

  const stripe = Stripe(STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.metadata?.email;
    const tokensToGrant = parseInt(session.metadata?.tokensToGrant || '0', 10);

    if (email && tokensToGrant > 0) {
      try {
        await addTokens(email, tokensToGrant, `stripe:${session.id}`);
      } catch (err) {
        console.error('Failed to credit tokens after payment:', err);
        // Still return 200 so Stripe doesn't retry forever; a failure here
        // needs manual reconciliation against the Stripe Dashboard payment
        // record. Consider wiring up an alert (email/Slack) on this branch.
      }
    } else {
      console.error('Webhook received checkout.session.completed without expected metadata:', session.id);
    }
  }

  res.status(200).json({ received: true });
};

// Disable Vercel's default body parser so we can verify Stripe's signature
// against the exact raw bytes Stripe sent.
module.exports.config = {
  api: { bodyParser: false }
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

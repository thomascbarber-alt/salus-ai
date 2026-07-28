/**
 * Caedrix AI — Create Checkout Session
 * =======================================
 * POST /api/create-checkout-session
 * Body: { email: string, pack: 'single' | 'five' }
 * Returns: { url: string } — redirect the browser to this Stripe-hosted
 * Checkout page. Apple Pay / Google Pay surface automatically there.
 *
 * ── SETUP REQUIRED (see .env.example) ──
 *   STRIPE_SECRET_KEY        — Stripe Dashboard > Developers > API keys
 *   STRIPE_PRICE_SINGLE      — Price ID for the single-search product
 *   STRIPE_PRICE_FIVE_PACK   — Price ID for the five-search pack
 *   PUBLIC_SITE_URL          — e.g. https://caedrix.com (for redirects back)
 */

const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const { STRIPE_SECRET_KEY, STRIPE_PRICE_SINGLE, STRIPE_PRICE_FIVE_PACK, PUBLIC_SITE_URL } = process.env;

  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_SINGLE || !STRIPE_PRICE_FIVE_PACK || !PUBLIC_SITE_URL) {
    res.status(500).json({
      error: 'NOT_CONFIGURED',
      message: 'Stripe environment variables are not set up yet. See .env.example.'
    });
    return;
  }

  const { email, pack, returnUrl } = req.body || {};

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'INVALID_EMAIL' });
    return;
  }
  if (pack !== 'single' && pack !== 'five') {
    res.status(400).json({ error: 'INVALID_PACK', message: 'pack must be "single" or "five"' });
    return;
  }

  // Only accept a same-origin relative path for returnUrl (e.g.
  // "/health-decisions.html") to avoid this becoming an open redirect.
  // Falls back to the hub page if missing or unsafe.
  let returnPath = '/precision-medicine3.html';
  if (typeof returnUrl === 'string' && returnUrl.startsWith('/') && !returnUrl.startsWith('//')) {
    returnPath = returnUrl;
  }

  const stripe = Stripe(STRIPE_SECRET_KEY);
  const priceId = pack === 'single' ? STRIPE_PRICE_SINGLE : STRIPE_PRICE_FIVE_PACK;
  const tokensToGrant = pack === 'single' ? 1 : 5;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'], // Apple Pay / Google Pay surface automatically on Checkout
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      // email + tokensToGrant travel through to the webhook, which is the
      // ONLY place tokens actually get credited (never trust the client).
      metadata: { email: email.trim().toLowerCase(), tokensToGrant: String(tokensToGrant), pack },
      success_url: `${PUBLIC_SITE_URL}${returnPath}?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_SITE_URL}${returnPath}?purchase=cancelled`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout session error:', err);
    res.status(500).json({ error: 'STRIPE_ERROR', message: err.message });
  }
};

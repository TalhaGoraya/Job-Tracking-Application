'use strict';

let _stripe = null;
function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured.');
    _stripe = require('stripe')(key);
  }
  return _stripe;
}

async function createCheckoutSession(userId, email, successUrl, cancelUrl) {
  const stripe = getStripe();
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error('STRIPE_PRICE_ID not configured.');

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: email || undefined,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  cancelUrl,
    metadata: { userId: String(userId) },
    subscription_data: { metadata: { userId: String(userId) } },
  });

  return session;
}

function constructWebhookEvent(rawBody, sig) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured.');
  return require('stripe').webhooks.constructEvent(rawBody, sig, secret);
}

module.exports = { createCheckoutSession, constructWebhookEvent };

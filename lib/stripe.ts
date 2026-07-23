/**
 * Stripe server-side singleton.
 * Import only in API routes / server components — never in client code.
 */
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[GasCap] STRIPE_SECRET_KEY is not set. Stripe features will be unavailable.');
}

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' })
  : null;

/** Price IDs — set in .env.local after creating in Stripe Dashboard */
export const PRICES = {
  proMonthly:     process.env.STRIPE_PRICE_PRO_MONTHLY      ?? '',
  proLifetime:    process.env.STRIPE_PRICE_PRO_LIFETIME     ?? '',
  lifetimePerks:  process.env.STRIPE_PRICE_LIFETIME_PERKS   ?? '',
  // Annual is shelved (2026-07-23) — at $26.99/yr it was strictly worse than
  // Lifetime ($19.99 one-time: cheaper, forever, more giveaway entries, + the
  // vacation getaway) on every axis, so there was no rational reason to buy it.
  // Zero subscribers existed when removed. Checkout explicitly rejects new
  // 'annual' requests (see app/api/stripe/checkout/route.ts).
  // proAnnual:   process.env.STRIPE_PRICE_PRO_ANNUAL       ?? '',
  // Fleet prices preserved in env for future relaunch — not currently active
  // fleetMonthly:  process.env.STRIPE_PRICE_FLEET_MONTHLY  ?? '',
  // fleetAnnual:   process.env.STRIPE_PRICE_FLEET_ANNUAL   ?? '',
} as const;

// ── Display pricing — update these when you create prices in Stripe Dashboard
export const PRICING = {
  pro: {
    monthly:       2.99,
    lifetime:      19.99,  // one-time payment — no subscription
    lifetimePerks: 9.99,   // annual Lifetime Perks renewal (+20 entries + vacation voucher)
    vehicles:      'Unlimited',
    drivers:       1,
    // annual: 26.99 — shelved 2026-07-23, see PRICES.proAnnual comment above
  },
  // Fleet plan is shelved — code preserved for future relaunch
  // fleet: { ... }
} as const;

// Legacy export kept for backward compatibility
export const PRO_PRICE_MONTHLY_DISPLAY = `$${PRICING.pro.monthly}`;

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
  proAnnual:      process.env.STRIPE_PRICE_PRO_ANNUAL       ?? '',
  proLifetime:    process.env.STRIPE_PRICE_PRO_LIFETIME     ?? '',
  lifetimePerks:  process.env.STRIPE_PRICE_LIFETIME_PERKS   ?? '',
  // Fleet prices preserved in env for future relaunch — not currently active
  // fleetMonthly:  process.env.STRIPE_PRICE_FLEET_MONTHLY  ?? '',
  // fleetAnnual:   process.env.STRIPE_PRICE_FLEET_ANNUAL   ?? '',
} as const;

// ── Display pricing — update these when you create prices in Stripe Dashboard
export const PRICING = {
  pro: {
    monthly:       2.99,
    annual:        26.99,  // ~3 months free vs monthly
    lifetime:      19.99,  // one-time payment — no subscription
    lifetimePerks: 9.99,   // annual Lifetime Perks renewal (+20 entries + vacation voucher)
    vehicles:      'Unlimited',
    drivers:       1,
  },
  // Fleet plan is shelved — code preserved for future relaunch
  // fleet: { ... }
} as const;

// Legacy export kept for backward compatibility
export const PRO_PRICE_MONTHLY_DISPLAY = `$${PRICING.pro.monthly}`;

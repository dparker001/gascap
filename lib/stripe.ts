/**
 * Stripe server-side singleton.
 * Import only in API routes / server components — never in client code.
 */
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[GasCap] STRIPE_SECRET_KEY is not set. Stripe features will be unavailable.');
}

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' })
  : null;

/** Price IDs — set in .env.local after creating in Stripe Dashboard */
export const PRICES = {
  proMonthly:    process.env.STRIPE_PRICE_PRO_MONTHLY    ?? '',
  proAnnual:     process.env.STRIPE_PRICE_PRO_ANNUAL     ?? '',
  fleetMonthly:  process.env.STRIPE_PRICE_FLEET_MONTHLY  ?? '',
  fleetAnnual:   process.env.STRIPE_PRICE_FLEET_ANNUAL   ?? '',
} as const;

// ── Display pricing — update these when you create prices in Stripe Dashboard
// Annual = monthly × 10  (2 months free)
export const PRICING = {
  pro: {
    monthly:         4.99,
    annual:          49,      // flat $49/yr (≈2 months free)
    annualPerMonth:  4.08,    // $49 / 12, rounded
    vehicles:        5,
    drivers:         1,
  },
  fleet: {
    monthly:         19.99,
    annual:          199,     // flat $199/yr (≈2 months free)
    annualPerMonth:  16.58,   // $199 / 12, rounded
    vehicles:        'Unlimited',
    drivers:         10,
  },
} as const;

// Legacy exports kept for backward compatibility
export const PRO_PRICE_MONTHLY_DISPLAY = `$${PRICING.pro.monthly}`;
export const PRO_PRICE_ANNUAL_DISPLAY  = `$${PRICING.pro.annual}`;

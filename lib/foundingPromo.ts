/**
 * Founding Member launch promo.
 *
 * The first FOUNDING_CAP people to actually PURCHASE Pro Lifetime at $9.99 (50%
 * off $19.99) via this launch offer are "Founding Members" — this module adds the
 * SCARCITY layer: a live "X of 100 spots left" counter that drives launch signups.
 *
 * "Spots left" counts REAL redemptions (users with foundingMemberAt set by the
 * Stripe webhook — app/api/stripe/webhook/route.ts — when a Lifetime purchase's
 * checkout session metadata.offerSource === 'founding'), NOT raw signups since
 * launch. Earlier this counted every new account created after FOUNDING_START
 * regardless of whether they ever bought anything, which meant free signups with
 * zero purchases could exhaust "spots" — fixed 2026-07-23.
 *
 * Config via env (all optional): FOUNDING_PROMO_ACTIVE, FOUNDING_PROMO_CAP,
 * FOUNDING_PROMO_START (ISO) — START still gates which purchases count (in case
 * the coupon is ever reused for a future campaign after this one ends).
 */

import { prisma } from './prisma';

export const FOUNDING_ACTIVE = (process.env.FOUNDING_PROMO_ACTIVE ?? 'true') === 'true';
export const FOUNDING_CAP    = Number(process.env.FOUNDING_PROMO_CAP ?? 100);
export const FOUNDING_START  = process.env.FOUNDING_PROMO_START ?? '2026-06-23T00:00:00.000Z';
export const FOUNDING_PRICE  = 9.99;

// Stripe coupon: "$10 off, once" → $19.99 Lifetime becomes $9.99 (same $10-off coupon
// the win-back / new-member offers use). Applied server-side ONLY, on the Lifetime
// checkout, ONLY while the founding promo is active (see stripe/checkout/route.ts).
export const FOUNDING_LIFETIME_COUPON = process.env.FOUNDING_COUPON ?? 'hV3LWKzw';

// Minimum REAL redemptions before the marketing banner shows itself. A live "100
// of 100 spots left" counter (i.e. zero redemptions) reads as "nobody wants this"
// rather than urgency — so the banner stays hidden pre-marketing-launch and
// auto-reveals once there's enough real momentum to be a believable positive
// signal, with no manual toggle to remember. Does NOT affect `active` — the
// coupon must stay redeemable via a direct link even before the floor is met, or
// nobody could ever become one of the first FOUNDING_DISPLAY_FLOOR members.
export const FOUNDING_DISPLAY_FLOOR = Number(process.env.FOUNDING_DISPLAY_FLOOR ?? 5);

export interface FoundingStatus {
  active:     boolean;  // promo on AND spots remain — gates checkout coupon eligibility
  cap:        number;
  spotsLeft:  number;
  price:      number;
  showBanner: boolean;  // true once real redemptions clear FOUNDING_DISPLAY_FLOOR — gates the marketing banner only
}

// Cache the count briefly — the banner is shown to lots of visitors, so we don't
// want a COUNT(*) on every page load.
let cache: { at: number; spotsLeft: number } | null = null;
const TTL_MS = 30_000;

export async function foundingStatus(): Promise<FoundingStatus> {
  if (!FOUNDING_ACTIVE) {
    return { active: false, cap: FOUNDING_CAP, spotsLeft: 0, price: FOUNDING_PRICE, showBanner: false };
  }
  let spotsLeft: number;
  if (cache && Date.now() - cache.at < TTL_MS) {
    spotsLeft = cache.spotsLeft;
  } else {
    const count = await prisma.user.count({
      where: { foundingMemberAt: { not: null, gte: new Date(FOUNDING_START) } },
    });
    spotsLeft = Math.max(0, FOUNDING_CAP - count);
    cache = { at: Date.now(), spotsLeft };
  }
  const active     = spotsLeft > 0;
  const redemptions = FOUNDING_CAP - spotsLeft;
  return {
    active,
    cap:        FOUNDING_CAP,
    spotsLeft,
    price:      FOUNDING_PRICE,
    showBanner: active && redemptions >= FOUNDING_DISPLAY_FLOOR,
  };
}

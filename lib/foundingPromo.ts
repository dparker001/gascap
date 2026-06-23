/**
 * Founding Member launch promo.
 *
 * The first FOUNDING_CAP people who sign up after FOUNDING_START are "Founding
 * Members" and get Pro Lifetime for $9.99 (50% off $19.99). The $9.99 price itself
 * is delivered by the existing 7-day new-member offer (lib/newMemberOffer.ts →
 * coupon applied server-side at checkout) — this module only adds the SCARCITY
 * layer: a live "X of 100 spots left" counter that drives launch signups.
 *
 * Config via env (all optional): FOUNDING_PROMO_ACTIVE, FOUNDING_PROMO_CAP,
 * FOUNDING_PROMO_START (ISO). createdAt is an ISO string in the DB and ISO strings
 * sort chronologically, so a `gte` string filter counts post-launch signups.
 */

import { prisma } from './prisma';

export const FOUNDING_ACTIVE = (process.env.FOUNDING_PROMO_ACTIVE ?? 'true') === 'true';
export const FOUNDING_CAP    = Number(process.env.FOUNDING_PROMO_CAP ?? 100);
export const FOUNDING_START  = process.env.FOUNDING_PROMO_START ?? '2026-06-23T00:00:00.000Z';
export const FOUNDING_PRICE  = 9.99;

export interface FoundingStatus {
  active:    boolean;  // promo on AND spots remain
  cap:       number;
  spotsLeft: number;
  price:     number;
}

// Cache the count briefly — it only moves on new signups and the banner is shown
// to lots of visitors, so we don't want a COUNT(*) on every page load.
let cache: { at: number; spotsLeft: number } | null = null;
const TTL_MS = 30_000;

export async function foundingStatus(): Promise<FoundingStatus> {
  if (!FOUNDING_ACTIVE) {
    return { active: false, cap: FOUNDING_CAP, spotsLeft: 0, price: FOUNDING_PRICE };
  }
  let spotsLeft: number;
  if (cache && Date.now() - cache.at < TTL_MS) {
    spotsLeft = cache.spotsLeft;
  } else {
    const count = await prisma.user.count({ where: { createdAt: { gte: FOUNDING_START } } });
    spotsLeft = Math.max(0, FOUNDING_CAP - count);
    cache = { at: Date.now(), spotsLeft };
  }
  return { active: spotsLeft > 0, cap: FOUNDING_CAP, spotsLeft, price: FOUNDING_PRICE };
}

/**
 * Post-Revision-2 fix — the giveaway's Lifetime bonus entries were the
 * explicitly named violation: gated on `stripeInterval === 'lifetime'`
 * alone, an RC-only Lifetime (native IAP) purchaser would silently lose
 * the Lifetime giveaway bonus once stripeInterval was correctly narrowed
 * to Stripe/gift-only provenance. This proves parity: same reward amount,
 * regardless of provider, for entrants who are otherwise identical.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface UserRow {
  id: string; name: string; email: string; plan: string;
  stripeInterval: string | null;
  revenueCatActive: boolean; revenueCatInterval: string | null;
  lifetimePerksUntil: string | null;
  activeDays: string[]; streak: number; referralCount: number;
  earlyUpgradeBonusEntries: number; garageBonusDays: string[];
  verifyReminderBonusEntries: number; phoneBonusEntries: number;
  dailyBonusEntries: number; firstCalcBonusEntries: number;
  priceReportEntries: number; gigLogEntries: number;
  streakMilestoneBonusEntries: number; referralLifetimeBonusEntries: number;
  loginCount: number; lastLoginAt: string | null;
  isTestAccount: boolean; emailVerified: boolean;
}

function makeUser(overrides: Partial<UserRow>): UserRow {
  return {
    id: 'u', name: 'Test User', email: 'test@example.com', plan: 'pro',
    stripeInterval: null, revenueCatActive: false, revenueCatInterval: null,
    lifetimePerksUntil: null,
    activeDays: ['2026-08-01'], streak: 0, referralCount: 0,
    earlyUpgradeBonusEntries: 0, garageBonusDays: [],
    verifyReminderBonusEntries: 0, phoneBonusEntries: 0,
    dailyBonusEntries: 0, firstCalcBonusEntries: 0,
    priceReportEntries: 0, gigLogEntries: 0,
    streakMilestoneBonusEntries: 0, referralLifetimeBonusEntries: 0,
    loginCount: 1, lastLoginAt: null,
    isTestAccount: false, emailVerified: true,
    ...overrides,
  };
}

let users: UserRow[] = [];

const prismaMock = {
  user: {
    findMany: vi.fn(async (args?: { where?: { plan?: unknown } }) => {
      // getCommunityActiveDays also calls findMany with a `select` — return
      // the same rows either way; the community bonus isn't what's under test.
      return users;
    }),
  },
};

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/amoeEntries', () => ({
  amoeEntriesForMonth: () => [],
  amoeEntrantId: (email: string) => `amoe-${email}`,
  normalizeAmoeEmail: (e: string) => e.toLowerCase(),
  AMOE_ENTRY_VALUE: 1,
}));

beforeEach(() => {
  users = [];
  vi.clearAllMocks();
});

describe('getEligibleEntrants — Lifetime bonus parity across providers', () => {
  it('a Stripe/gift Lifetime entrant and an RC-only Lifetime entrant earn the IDENTICAL lifetimeBonusEntries amount', async () => {
    const { getEligibleEntrants } = await import('../lib/giveaway');
    users = [
      makeUser({ id: 'stripe-lifetime', email: 'stripe@example.com', stripeInterval: 'lifetime' }),
      makeUser({ id: 'rc-lifetime', email: 'rc@example.com', revenueCatActive: true, revenueCatInterval: 'lifetime' }),
    ];
    const period = '2026-08';
    const entrants = await getEligibleEntrants(period);
    const stripeEntrant = entrants.find((e) => e.userId === 'stripe-lifetime')!;
    const rcEntrant      = entrants.find((e) => e.userId === 'rc-lifetime')!;
    expect(stripeEntrant).toBeTruthy();
    expect(rcEntrant).toBeTruthy();
    // Both are base (non-Perks) Lifetime, so both should get the SAME base
    // Lifetime bonus — no reward-amount change, only eligibility-source fix.
    expect(rcEntrant.entryCount).toBeGreaterThan(0);
    expect(rcEntrant.entryCount).toBe(stripeEntrant.entryCount);
  });

  it('an RC-active-but-monthly entrant does NOT get the Lifetime bonus (only genuinely Lifetime RC purchasers do)', async () => {
    const { getEligibleEntrants } = await import('../lib/giveaway');
    users = [
      makeUser({ id: 'rc-monthly', email: 'rcm@example.com', revenueCatActive: true, revenueCatInterval: 'monthly' }),
      makeUser({ id: 'no-entitlement', email: 'none@example.com' }),
    ];
    const entrants = await getEligibleEntrants('2026-08');
    const rcMonthly = entrants.find((e) => e.userId === 'rc-monthly')!;
    const none       = entrants.find((e) => e.userId === 'no-entitlement')!;
    // Same active days, same everything else — RC-monthly should score
    // identically to no-entitlement (neither gets a Lifetime OR Annual bonus).
    expect(rcMonthly.entryCount).toBe(none.entryCount);
  });

  // ── Lifetime Perks eligibility — 2026-08-24 ChatGPT-review fix ───────────
  // Perks is only ever PURCHASED via Stripe (no native IAP path), and
  // `lifetimePerksUntil` is always a Stripe-set field regardless of who
  // owns it — but base Lifetime OWNERSHIP is provider-neutral (a RevenueCat
  // Lifetime owner can also buy Perks, per the checkout-gate fix). The
  // superseded test below asserted the OLD (buggy) behavior — a RevenueCat
  // Lifetime member with a genuinely active lifetimePerksUntil got only the
  // base bonus, meaning a customer could PAY for Perks but never receive
  // the Perks-tier benefit. Perks activation itself
  // (setLifetimePerksActive) is unconditional once the checkout completes,
  // so a real `lifetimePerksUntil` value on an RC Lifetime account
  // represents a genuine paid Perks subscription, not a "stray" value.

  it('LP1. Stripe Lifetime + active Perks → Perks bonus tier', async () => {
    const { getEligibleEntrants } = await import('../lib/giveaway');
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    users = [
      makeUser({ id: 'stripe-perks', email: 'sp@example.com', stripeInterval: 'lifetime', lifetimePerksUntil: future }),
      makeUser({ id: 'stripe-base',  email: 'sb@example.com', stripeInterval: 'lifetime' }),
    ];
    const entrants = await getEligibleEntrants('2026-08');
    const perks = entrants.find((e) => e.userId === 'stripe-perks')!;
    const base  = entrants.find((e) => e.userId === 'stripe-base')!;
    expect(perks.entryCount).toBeGreaterThan(base.entryCount);
  });

  it('LP2. RevenueCat Lifetime + active Perks → Perks bonus tier (matches Stripe Lifetime + Perks)', async () => {
    const { getEligibleEntrants } = await import('../lib/giveaway');
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    users = [
      makeUser({ id: 'stripe-perks', email: 'sp@example.com', stripeInterval: 'lifetime', lifetimePerksUntil: future }),
      makeUser({ id: 'rc-perks',     email: 'rcp@example.com', revenueCatActive: true, revenueCatInterval: 'lifetime', lifetimePerksUntil: future }),
    ];
    const entrants = await getEligibleEntrants('2026-08');
    const stripePerks = entrants.find((e) => e.userId === 'stripe-perks')!;
    const rcPerks      = entrants.find((e) => e.userId === 'rc-perks')!;
    expect(rcPerks.entryCount).toBe(stripePerks.entryCount);
  });

  it('LP3. RevenueCat Lifetime + expired Perks → base Lifetime bonus only, not Perks tier', async () => {
    const { getEligibleEntrants } = await import('../lib/giveaway');
    const past = new Date(Date.now() - 30 * 86_400_000).toISOString();
    users = [
      makeUser({ id: 'rc-expired-perks', email: 'rce@example.com', revenueCatActive: true, revenueCatInterval: 'lifetime', lifetimePerksUntil: past }),
      makeUser({ id: 'rc-base',          email: 'rcb@example.com', revenueCatActive: true, revenueCatInterval: 'lifetime' }),
    ];
    const entrants = await getEligibleEntrants('2026-08');
    const expired = entrants.find((e) => e.userId === 'rc-expired-perks')!;
    const base     = entrants.find((e) => e.userId === 'rc-base')!;
    expect(expired.entryCount).toBe(base.entryCount);
  });

  it('LP4. RevenueCat Lifetime + no Perks → base Lifetime bonus only', async () => {
    const { getEligibleEntrants } = await import('../lib/giveaway');
    users = [
      makeUser({ id: 'rc-no-perks', email: 'rcn@example.com', revenueCatActive: true, revenueCatInterval: 'lifetime' }),
    ];
    const entrants = await getEligibleEntrants('2026-08');
    const entrant = entrants.find((e) => e.userId === 'rc-no-perks')!;
    expect(entrant.entryCount).toBeGreaterThan(0); // gets the base bonus...
    // ...but confirmed less than the Perks tier via LP1/LP2's own numbers.
  });

  it('LP5. RevenueCat Monthly (not Lifetime) + even a stale/future lifetimePerksUntil → Perks inactive, no bonus at all', async () => {
    const { getEligibleEntrants } = await import('../lib/giveaway');
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    users = [
      makeUser({ id: 'rc-monthly-stray-perks', email: 'rcms@example.com', revenueCatActive: true, revenueCatInterval: 'monthly', lifetimePerksUntil: future }),
      makeUser({ id: 'no-entitlement',          email: 'none2@example.com' }),
    ];
    const entrants = await getEligibleEntrants('2026-08');
    const rcMonthly = entrants.find((e) => e.userId === 'rc-monthly-stray-perks')!;
    const none       = entrants.find((e) => e.userId === 'no-entitlement')!;
    // Not Lifetime at all → gets neither the base nor the Perks bonus,
    // regardless of the stray lifetimePerksUntil value.
    expect(rcMonthly.entryCount).toBe(none.entryCount);
  });
});

/**
 * Ambassador Program — shared constants and pure helpers.
 *
 * Single source of truth for tier thresholds, entry multipliers,
 * and eligibility rules. Imported by lib/users.ts (tier grants)
 * and lib/giveaway.ts (draw entry multipliers + always-eligible logic).
 *
 * Tiers are based on CUMULATIVE all-time paying referrals — the count
 * only ever goes up, so milestones are permanent once reached.
 */

export const AMBASSADOR_THRESHOLDS = {
  SUPPORTER:  5,
  AMBASSADOR: 15,
  ELITE:      30,
} as const;

export type AmbassadorTier = 'elite' | 'ambassador' | 'supporter' | null;

/**
 * Derive the ambassador tier from a cumulative paying referral count.
 * Returns null when below the Supporter threshold.
 */
export function getAmbassadorTier(referralCount: number): AmbassadorTier {
  if (referralCount >= AMBASSADOR_THRESHOLDS.ELITE)      return 'elite';
  if (referralCount >= AMBASSADOR_THRESHOLDS.AMBASSADOR) return 'ambassador';
  if (referralCount >= AMBASSADOR_THRESHOLDS.SUPPORTER)  return 'supporter';
  return null;
}

/**
 * Daily drawing entry multiplier for a given cumulative referral count.
 *   Standard  (0–4)  → 1×
 *   Supporter (5–14) → 2×
 *   Ambassador (15–29) → 3×
 *   Elite (30+)      → 5×
 */
export function ambassadorEntryMultiplier(referralCount: number): number {
  if (referralCount >= AMBASSADOR_THRESHOLDS.ELITE)      return 5;
  if (referralCount >= AMBASSADOR_THRESHOLDS.AMBASSADOR) return 3;
  if (referralCount >= AMBASSADOR_THRESHOLDS.SUPPORTER)  return 2;
  return 1;
}

/**
 * Ambassador tier holders are always eligible to win the monthly drawing —
 * the consecutive-month and quarterly restrictions do not apply to them.
 */
export function isAlwaysEligible(referralCount: number): boolean {
  return referralCount >= AMBASSADOR_THRESHOLDS.SUPPORTER;
}

/**
 * Whether a referral count has reached the free-Pro-for-life milestone.
 * True at Ambassador tier (15+) and above.
 */
export function qualifiesForFreeProForLife(referralCount: number): boolean {
  return referralCount >= AMBASSADOR_THRESHOLDS.AMBASSADOR;
}

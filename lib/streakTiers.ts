/**
 * Streak bonus tiers for the monthly draw.
 *
 * Its own zero-import module so it can be unit-tested: lib/giveaway.ts pulls
 * in prisma and the whole data layer, which vitest can't load. Same reason
 * lib/streakRisk.ts exists.
 */

export interface StreakBonusTier {
  minStreak: number;
  bonus:     number;
  label:     string;   // shown in UI / admin
}

export const STREAK_BONUS_TIERS: StreakBonusTier[] = [
  { minStreak:   0, bonus:   0, label: 'No bonus'        },
  // Deliberately small. This is a live tier recomputed from the CURRENT
  // streak, not a one-time award, so breaking and rebuilding restores it but
  // never stacks — there's nothing to farm by cycling 3 days on, 1 off.
  { minStreak:   3, bonus:   1, label: '3-day streak'    },
  { minStreak:   7, bonus:   3, label: '1-week streak'   },
  { minStreak:  30, bonus:   8, label: '1-month streak'  },
  { minStreak:  90, bonus:  40, label: '3-month streak'  },
  { minStreak: 180, bonus:  70, label: '6-month streak'  },
  { minStreak: 365, bonus: 120, label: '1-year streak'   },
];

/**
 * Return the bonus entries for a given streak length.
 * e.g. streak 45 → 5 bonus entries (1-month tier)
 */
export function streakBonusEntries(streak: number): number {
  let bonus = 0;
  for (const tier of STREAK_BONUS_TIERS) {
    if (streak >= tier.minStreak) bonus = tier.bonus;
  }
  return bonus;
}

/** Return the streak bonus tier object for a given streak length */
export function streakTierForStreak(streak: number): StreakBonusTier {
  let active = STREAK_BONUS_TIERS[0];
  for (const tier of STREAK_BONUS_TIERS) {
    if (streak >= tier.minStreak) active = tier;
  }
  return active;
}

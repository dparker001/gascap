/**
 * Badge definitions and evaluation logic.
 * Keep this file free of server-only imports — it's used in both client and API routes.
 */

export interface BadgeDef {
  id:          string;
  name:        string;
  emoji:       string;
  description: string;
  /** Secret criteria shown only after earning */
  hint:        string;
}

export interface UserStats {
  calcCount:       number;
  budgetCalcCount: number;
  locationLookups: number;
  streak:          number;   // current consecutive-day streak
  vehicleCount:    number;
  daysActive:      number;   // total unique days used
}

// ── Badge catalogue ────────────────────────────────────────────────────────
// Order matters — shown in this order on the shelf.

export const BADGES: BadgeDef[] = [
  {
    id:          'first_calc',
    name:        'First Fill',
    emoji:       '⛽',
    description: 'Ran your first calculation.',
    hint:        'Run your first fuel calculation.',
  },
  {
    id:          'road_warrior',
    name:        'Road Warrior',
    emoji:       '🛣️',
    description: 'Ran 10 calculations.',
    hint:        'Run 10 calculations.',
  },
  {
    id:          'fuel_master',
    name:        'Fuel Master',
    emoji:       '🏆',
    description: 'Ran 50 calculations — you\'re a pro.',
    hint:        'Run 50 calculations.',
  },
  {
    id:          'streak_3',
    name:        'On a Roll',
    emoji:       '⚡',
    description: 'Used GasCap 3 days in a row.',
    hint:        'Use the app 3 days in a row.',
  },
  {
    id:          'streak_7',
    name:        'Week Warrior',
    emoji:       '💪',
    description: 'Used GasCap 7 days in a row.',
    hint:        'Use the app 7 days in a row.',
  },
  {
    id:          'garage_builder',
    name:        'Garage Builder',
    emoji:       '🚗',
    description: 'Saved your first vehicle.',
    hint:        'Save a vehicle to My Garage.',
  },
  {
    id:          'location_scout',
    name:        'Location Scout',
    emoji:       '📍',
    description: 'Looked up live gas prices.',
    hint:        'Use the gas price location lookup.',
  },
  {
    id:          'budget_conscious',
    name:        'Budget Conscious',
    emoji:       '💰',
    description: 'Used Budget mode 5 times.',
    hint:        'Run 5 budget calculations.',
  },
  {
    id:          'daily_driver',
    name:        'Daily Driver',
    emoji:       '📅',
    description: 'Used GasCap on 10 different days.',
    hint:        'Use the app on 10 separate days.',
  },
];

// ── Evaluation ─────────────────────────────────────────────────────────────

/** Returns the IDs of ALL badges that should be earned given these stats. */
export function evaluateEarned(stats: UserStats): string[] {
  const earned: string[] = [];
  if (stats.calcCount       >= 1)  earned.push('first_calc');
  if (stats.calcCount       >= 10) earned.push('road_warrior');
  if (stats.calcCount       >= 50) earned.push('fuel_master');
  if (stats.streak          >= 3)  earned.push('streak_3');
  if (stats.streak          >= 7)  earned.push('streak_7');
  if (stats.vehicleCount    >= 1)  earned.push('garage_builder');
  if (stats.locationLookups >= 1)  earned.push('location_scout');
  if (stats.budgetCalcCount >= 5)  earned.push('budget_conscious');
  if (stats.daysActive      >= 10) earned.push('daily_driver');
  return earned;
}

/** Given current earned set and new stats, returns only NEWLY earned badge IDs. */
export function findNewBadges(stats: UserStats, alreadyEarned: string[]): string[] {
  return evaluateEarned(stats).filter((id) => !alreadyEarned.includes(id));
}

/** Look up a badge definition by ID. */
export function getBadge(id: string): BadgeDef | undefined {
  return BADGES.find((b) => b.id === id);
}

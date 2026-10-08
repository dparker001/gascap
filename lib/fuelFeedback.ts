/**
 * Phase 1 P1-B — the post-save fuel feedback model (pure, zero-DB).
 *
 * After a fill-up is saved the user is shown how it compares with the
 * same-grade EIA weekly average that was frozen onto the row when it was
 * logged — or an explicit "not enough data yet" with the reason. This module
 * only DECIDES what to say; it never fetches anything and never invents a
 * number:
 *
 *  - Savings use the CONFIRMED values stored on the saved row (what the user
 *    typed or explicitly confirmed), never a planned/calculated value.
 *  - The comparison is the Phase 0.5 rule set, reused unchanged
 *    (lib/savingsBaseline.ts computeFillupSavings): priceable grade only,
 *    stored baseline only (a brand-new row has no other), sanity checks, and
 *    paid-more-than-average is reported as-is, never hidden or floored.
 *  - No stored baseline, no grade, an unsupported grade, or odd numbers all
 *    yield `insufficient_data` — there is no fallback constant and no
 *    estimate, and no BUY/WAIT or prediction language anywhere.
 */
import { computeFillupSavings, type SavingsFillup, type SavingsStatus } from './savingsBaseline';
import { NATIONAL_AREA } from './eiaAreas';

export type FeedbackOutcome = 'priced' | 'insufficient_data';
export type FeedbackReason = Exclude<SavingsStatus, 'compared'>;
export type AreaKind = 'national' | 'regional' | 'state';
export type NextStep = 'add_odometer' | 'log_next';

export interface FuelFeedback {
  outcome: FeedbackOutcome;
  /** Why no comparison is shown (only when outcome = insufficient_data). */
  reason?: FeedbackReason;
  /** below / above / same relative to the average (only when priced). */
  direction?: 'below' | 'above' | 'same';
  /** |baseline cost - amount paid| in dollars, always >= 0 (only when priced). */
  amount?: number;
  grade?: string;
  paidPerGallon?: number;
  baselinePrice?: number;
  /** EIA survey date (YYYY-MM-DD) of the average — its real observation date. */
  baselinePeriod?: string;
  areaKind?: AreaKind;
  nextStep: NextStep;
}

/** NUS = national, R?? = PADD region, S?? = a state series. */
export function areaKind(area: string | null | undefined): AreaKind {
  if (!area || area === NATIONAL_AREA) return 'national';
  if (area.startsWith('S')) return 'state';
  if (area.startsWith('R')) return 'regional';
  return 'national';
}

/** Under half a cent per gallon is "right at" the average. */
const SAME_EPSILON = 0.005;

export interface SavedFillupForFeedback extends SavingsFillup {
  odometerReading?: number | null;
}

export function buildFuelFeedback(saved: SavedFillupForFeedback): FuelFeedback {
  const nextStep: NextStep =
    typeof saved.odometerReading === 'number' && saved.odometerReading > 0 ? 'log_next' : 'add_odometer';

  // No national snapshots passed: only the baseline frozen at save time is
  // admissible for brand-new feedback. A row without one is "no_baseline".
  const s = computeFillupSavings(saved, {});
  if (s.status !== 'compared' || s.baselinePrice === undefined || s.paidPerGallon === undefined || s.savings === undefined) {
    return { outcome: 'insufficient_data', reason: s.status === 'compared' ? 'no_baseline' : s.status, grade: s.grade, nextStep };
  }

  const perGallon = s.baselinePrice - s.paidPerGallon;
  const direction: 'below' | 'above' | 'same' =
    Math.abs(perGallon) < SAME_EPSILON || Math.abs(s.savings) < 0.005 ? 'same' : s.savings > 0 ? 'below' : 'above';

  return {
    outcome: 'priced',
    direction,
    amount: Math.round(Math.abs(s.savings) * 100) / 100,
    grade: s.grade,
    paidPerGallon: s.paidPerGallon,
    baselinePrice: s.baselinePrice,
    baselinePeriod: s.baselinePeriod,
    areaKind: areaKind(s.baselineArea),
    nextStep,
  };
}

/**
 * Trial Value Summary (TC-2A, 2026-09-01)
 *
 * Server-authoritative recap of what a trial (or ex-trial) user has actually
 * done with GasCap™ Pro — used to personalize the Day-21/Day-28/trial-ended
 * emails and the TrialExpiryBanner. Deliberately returns ONLY four aggregate
 * counts: no raw rows, no PII, no derived dollar "savings" claim (there is
 * no authoritative GasCap savings metric — see CLAUDE.md).
 *
 * ── calculation-counter reliability verification (required before use) ────
 * Two independent, equally-reliable server counters exist, both maintained
 * by lib/users.ts's recordActivity():
 *   - `User.calcCount`       — `if (event === 'calc') calcCount++;`, fired
 *     from components/TargetFillForm.tsx's handleCalculate() only after a
 *     successful, validated Calculate press ("Only from an explicit
 *     successful Calculate press — never from liveRecalc()", per that
 *     file's own comment).
 *   - `User.budgetCalcCount` — `if (event === 'budget_calc') budgetCalcCount++;`,
 *     fired from components/BudgetForm.tsx's equivalent handler, same
 *     "explicit successful Calculate press only" guarantee (identical
 *     comment pattern at that call site).
 * Both routes go through the single POST /api/activity route
 * (app/api/activity/route.ts), which requires an authenticated session
 * (guests get a no-op, no DB write), so neither counter can be inflated by
 * a logged-out visitor. Neither is literally double-click-proof (no
 * client-side debounce/disable was found on either button), but that is a
 * generic UI-affordance question shared by every counter in this codebase,
 * not a semantic mismatch with "number of calculations the user ran".
 *
 * Since GasCap has multiple calculators (Target Fill, Budget, and others)
 * and a trial user's value isn't limited to whichever one they happened to
 * use, `calculations` is the SUM of both reliable counters:
 * `(calcCount ?? 0) + (budgetCalcCount ?? 0)`. No other calculator (e.g. EV)
 * is included unless and until an equally reliable server-persisted counter
 * for it is verified the same way. Decision: RELIABLE enough to surface as
 * a coarse, non-precise "N GasCap calculations" recap line — deliberately
 * labeled broadly (not "fill calculations") since Budget calculations are
 * included in the total.
 *
 * ── fillups scope decision ──────────────────────────────────────────────
 * `Fillup.rentalSessionId` distinguishes personal fill-ups (null) from
 * rental fill-ups logged via Rental Return Mode (set). This helper counts
 * ALL Fillup rows for the user regardless of that flag: both are genuine
 * logged fill-ups the user actually performed, and rentalSessions is
 * reported as its own separate metric alongside it — so a rental fill-up
 * is never miscounted as a "vehicle" or hidden from the recap, it's simply
 * also true that it was a fill-up.
 */
import { prisma } from './prisma';

export interface TrialValueSummary {
  /** null when calcCount can't be vouched for — see file header. Currently always a number (see above). */
  calculations:   number | null;
  vehicles:       number;
  fillups:        number;
  rentalSessions: number;
}

export async function getTrialValueSummary(userId: string): Promise<TrialValueSummary> {
  const [user, vehicles, fillups, rentalSessions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { calcCount: true, budgetCalcCount: true } }),
    prisma.vehicle.count({ where: { userId } }),
    prisma.fillup.count({ where: { userId } }),
    prisma.rentalSession.count({ where: { userId } }),
  ]);

  return {
    calculations:   (user?.calcCount ?? 0) + (user?.budgetCalcCount ?? 0),
    vehicles,
    fillups,
    rentalSessions,
  };
}

/** True when the summary has at least one non-zero, reliable metric worth displaying. */
export function hasTrialValue(summary: TrialValueSummary): boolean {
  return (
    (summary.calculations !== null && summary.calculations > 0) ||
    summary.vehicles > 0 ||
    summary.fillups > 0 ||
    summary.rentalSessions > 0
  );
}

function plural(n: number, singular: string, pluralWord = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralWord}`;
}

/**
 * Compact, ordered list of human-readable phrases for every non-zero,
 * reliable metric — e.g. ["4 fill-ups logged", "2 vehicles saved"].
 * Never includes a zero-value metric and never includes a dollar amount.
 */
export function trialValuePhrases(summary: TrialValueSummary): string[] {
  const phrases: string[] = [];
  if (summary.calculations !== null && summary.calculations > 0) {
    // Broad label — includes Budget calculations, not just Target Fill —
    // so never call this "fill calculations" (see file header).
    phrases.push(`${plural(summary.calculations, 'GasCap calculation')}`);
  }
  if (summary.vehicles > 0) {
    phrases.push(`${plural(summary.vehicles, 'vehicle')} saved`);
  }
  if (summary.fillups > 0) {
    phrases.push(`${plural(summary.fillups, 'fill-up')} logged`);
  }
  if (summary.rentalSessions > 0) {
    phrases.push(`${plural(summary.rentalSessions, 'rental')} tracked`);
  }
  return phrases;
}

/**
 * READ-ONLY — pure calculation library for scripts/diagnostics/conversion_funnel.ts.
 *
 * This module contains ZERO database access and ZERO side effects. Every
 * function here is a pure function of its arguments so it can be unit-tested
 * with fixture data (see __tests__/conversionFunnelDiagnostic.test.ts) without
 * touching Prisma or any real/mock database connection.
 *
 * Nothing in this file may import '@/lib/prisma', '@prisma/client', 'pg', or
 * any network/DB client. If a future edit needs one, it belongs in
 * conversion_funnel.ts instead, not here.
 */

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  days: 7 | 14 | 30;
  since: Date | null;
  until: Date | null;
  authoritativeStart: Date | null;
  tc2aStart: Date | null;
  attributionWindowMs: number;
  attributionWindowLabel: string;
  json: boolean;
}

const VALID_DAYS = new Set([7, 14, 30]);

/** Default TC-2A recap→purchase attribution window: 7 days.
 *  Chosen to match the design audit's documented default
 *  (docs/reviews/2026-09-01-tc2b-conversion-measurement-design.md §5.5/§9) —
 *  it is explicitly called out there as the "ceiling, not an estimate"
 *  window, reported alongside tighter windows in the narrative output. We
 *  keep it as the configurable default so a run with no flags still produces
 *  a number, while the printed report always labels which window was used. */
export const DEFAULT_ATTRIBUTION_DAYS = 7;

/** Checkout→purchase default window. No repo evidence supports a materially
 *  tighter window being appropriate (Stripe Checkout can be abandoned and
 *  resumed, and a considered $19.99 Lifetime purchase is not an impulse
 *  buy), so we intentionally reuse the same 7-day default rather than
 *  inventing an unsupported 24h figure. */
export const CHECKOUT_ATTRIBUTION_MS = DEFAULT_ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000;

export class ArgParseError extends Error {}

function parseIsoDate(raw: string, flagName: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new ArgParseError(`Invalid date for ${flagName}: "${raw}" is not a valid ISO 8601 date.`);
  }
  return d;
}

/**
 * Parse CLI argv (e.g. process.argv.slice(2)) into a validated ParsedArgs.
 * Throws ArgParseError with a clear message on anything invalid — callers
 * must catch this and exit non-zero, never swallow it into defaults.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const map = new Map<string, string | true>();
  for (const raw of argv) {
    const m = /^--([a-zA-Z-]+)(?:=(.*))?$/.exec(raw);
    if (!m) throw new ArgParseError(`Unrecognized argument: "${raw}"`);
    map.set(m[1], m[2] ?? true);
  }

  const knownFlags = new Set([
    'days', 'since', 'until', 'authoritative-start', 'tc2a-start',
    'attribution-hours', 'attribution-days', 'json',
  ]);
  for (const key of map.keys()) {
    if (!knownFlags.has(key)) throw new ArgParseError(`Unknown flag: --${key}`);
  }

  let days: 7 | 14 | 30 = 30;
  if (map.has('days')) {
    const v = map.get('days');
    const n = Number(v);
    if (!VALID_DAYS.has(n)) {
      throw new ArgParseError(`--days must be one of 7, 14, 30 (got "${String(v)}").`);
    }
    days = n as 7 | 14 | 30;
  }

  const since = map.has('since') ? parseIsoDate(String(map.get('since')), '--since') : null;
  const until = map.has('until') ? parseIsoDate(String(map.get('until')), '--until') : null;
  if (since && until && since.getTime() >= until.getTime()) {
    throw new ArgParseError('--since must be earlier than --until.');
  }

  const authoritativeStart = map.has('authoritative-start')
    ? parseIsoDate(String(map.get('authoritative-start')), '--authoritative-start')
    : null;

  const tc2aStart = map.has('tc2a-start')
    ? parseIsoDate(String(map.get('tc2a-start')), '--tc2a-start')
    : null;

  if (map.has('attribution-hours') && map.has('attribution-days')) {
    throw new ArgParseError('Pass only one of --attribution-hours or --attribution-days, not both.');
  }
  let attributionWindowMs = DEFAULT_ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000;
  let attributionWindowLabel = `${DEFAULT_ATTRIBUTION_DAYS}d (default)`;
  if (map.has('attribution-hours')) {
    const hours = Number(map.get('attribution-hours'));
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new ArgParseError(`--attribution-hours must be a positive number (got "${String(map.get('attribution-hours'))}").`);
    }
    attributionWindowMs = hours * 60 * 60 * 1000;
    attributionWindowLabel = `${hours}h`;
  } else if (map.has('attribution-days')) {
    const daysN = Number(map.get('attribution-days'));
    if (!Number.isFinite(daysN) || daysN <= 0) {
      throw new ArgParseError(`--attribution-days must be a positive number (got "${String(map.get('attribution-days'))}").`);
    }
    attributionWindowMs = daysN * 24 * 60 * 60 * 1000;
    attributionWindowLabel = `${daysN}d`;
  }

  const json = map.has('json');

  return { days, since, until, authoritativeStart, tc2aStart, attributionWindowMs, attributionWindowLabel, json };
}

/** Resolve the exact [start, end) window to query, given parsed args and "now". */
export function resolveWindow(args: Pick<ParsedArgs, 'days' | 'since' | 'until'>, now: Date): { start: Date; end: Date } {
  const end = args.until ?? now;
  const start = args.since ?? new Date(end.getTime() - args.days * 24 * 60 * 60 * 1000);
  return { start, end };
}

// ---------------------------------------------------------------------------
// Activation classification
// ---------------------------------------------------------------------------

export interface UserActivityCounts {
  calculations: number;   // calcCount + budgetCalcCount
  vehicles: number;
  fillups: number;
  rentalSessions: number;
  activeDays: number;     // length of activeDays[]
}

export type ActivationState = 'unactivated' | 'activated';

/** UNACTIVATED / ACTIVATED per CLAUDE.md task spec — mirrors hasTrialValue()
 *  in lib/trialValue.ts (negation of "all four counters are zero"). */
export function classifyActivation(counts: UserActivityCounts): ActivationState {
  const { calculations, vehicles, fillups, rentalSessions } = counts;
  const anyActivity = calculations >= 1 || vehicles >= 1 || fillups >= 1 || rentalSessions >= 1;
  return anyActivity ? 'activated' : 'unactivated';
}

/**
 * HIGHLY ACTIVATED — ANALYSIS HYPOTHESIS, not a proven/validated threshold.
 * activeDays>=3 AND (calculations>=3 OR fillups>=2 OR rentalSessions>=1).
 */
export function classifyHighlyActivatedHypothesis(counts: UserActivityCounts): boolean {
  const { calculations, fillups, rentalSessions, activeDays } = counts;
  return activeDays >= 3 && (calculations >= 3 || fillups >= 2 || rentalSessions >= 1);
}

/** "Returned another day" — activeDays (a String[] of YYYY-MM-DD dates) has
 *  length >= 2. Documented explicitly: this measures days with a meaningful
 *  recorded action (recordActivity()), NOT generic app visits — a user who
 *  opens the app and does nothing does not get an activeDays entry. */
export function classifyReturnedAnotherDay(activeDaysLength: number): boolean {
  return activeDaysLength >= 2;
}

export type ActiveDaysBucket = '0' | '1' | '2' | '3' | '4+';
export function activeDaysBucket(n: number): ActiveDaysBucket {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n === 2) return '2';
  if (n === 3) return '3';
  return '4+';
}

export type CalcBand = '0' | '1' | '2' | '3-4' | '5+';
export function calculationBand(n: number): CalcBand {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n === 2) return '2';
  if (n <= 4) return '3-4';
  return '5+';
}

// ---------------------------------------------------------------------------
// Percentage / formatting helpers
// ---------------------------------------------------------------------------

/** Format a percentage. Zero-denominator always renders "N/A", never
 *  "0%"/"Infinity"/"NaN". */
export function formatPercent(numerator: number, denominator: number, decimals = 1): string {
  if (!Number.isFinite(denominator) || denominator <= 0) return 'N/A';
  if (!Number.isFinite(numerator)) return 'N/A';
  const pct = (numerator / denominator) * 100;
  return `${pct.toFixed(decimals)}%`;
}

/** Small-sample warning threshold. 30 is a practical starting point (not a
 *  statistical-significance guarantee) — chosen because it is the smallest
 *  round number at which a simple proportion's standard error stops being
 *  dominated by single-observation noise; GasCap has no confirmed baseline
 *  event volume that would justify a different repo-specific number, so we
 *  use this generic floor and say so in the output rather than implying
 *  false precision. */
export const SMALL_SAMPLE_THRESHOLD = 30;

export function isSmallSample(uniqueCount: number): boolean {
  return uniqueCount < SMALL_SAMPLE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Unique-user vs event-count dedup
// ---------------------------------------------------------------------------

export interface MinimalEvent {
  userId: string | null;
  createdAt: Date;
}

/** Count of raw rows vs. distinct non-null userIds. Never conflates the two —
 *  callers must always report both explicitly. */
export function countEventsAndUniqueUsers(events: MinimalEvent[]): { events: number; uniqueUsers: number } {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.userId) ids.add(e.userId);
  }
  return { events: events.length, uniqueUsers: ids.size };
}

// ---------------------------------------------------------------------------
// Plan / billing classification — verified metadata fields only
// ---------------------------------------------------------------------------

export type BillingClass = 'monthly' | 'lifetime' | 'unknown';

/** Classify billing strictly from the verified `billing` column/metadata
 *  field ('monthly' | 'lifetime' per AnalyticsEvent.billing and the
 *  iap_checkout_started/upgrade_plan_selected metadata.billing contract in
 *  app/api/analytics/event/route.ts). Anything else is 'unknown' — never
 *  guessed from another field. */
export function classifyBilling(billing: unknown): BillingClass {
  if (billing === 'monthly' || billing === 'lifetime') return billing;
  return 'unknown';
}

export type PlatformClass = 'web' | 'ios' | 'android' | 'unknown';

/** Classify platform strictly from a verified originPlatform value. Never
 *  inferred from email domain, user-agent, or any other guess. */
export function classifyPlatform(originPlatform: unknown): PlatformClass {
  if (originPlatform === 'web' || originPlatform === 'ios' || originPlatform === 'android') return originPlatform;
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Attribution: same-user, purchase-after-source, within-window
// ---------------------------------------------------------------------------

export interface AttributionSourceEvent {
  userId: string;
  createdAt: Date;
}

export interface AttributionPurchaseEvent {
  userId: string;
  createdAt: Date;
}

/**
 * True iff `purchase` legitimately attributes to `source`:
 *   - same userId (caller must pre-filter/join by userId; this only checks
 *     the temporal predicate given a matched pair, but also defensively
 *     re-checks userId equality)
 *   - purchase.createdAt >= source.createdAt (never counts a purchase that
 *     happened BEFORE its supposed source event)
 *   - purchase.createdAt <= source.createdAt + windowMs
 */
export function isAttributed(
  source: AttributionSourceEvent,
  purchase: AttributionPurchaseEvent,
  windowMs: number
): boolean {
  if (source.userId !== purchase.userId) return false;
  const delta = purchase.createdAt.getTime() - source.createdAt.getTime();
  return delta >= 0 && delta <= windowMs;
}

/**
 * Given a list of source (exposure) events and a list of purchase events,
 * compute the set of unique userIds attributed within `windowMs`, using each
 * user's EARLIEST source event as the anchor (matches the audit's Q5
 * MIN(createdAt) self-join design). A user with multiple purchase_completed
 * rows (e.g. a legitimate re-purchase, or a webhook redelivery that slipped
 * past idempotency in some edge case) is counted at most ONCE in the
 * returned attributed set — duplicate purchases never inflate the unique
 * attributed-buyer count.
 */
export function computeAttributedBuyers(
  sourceEvents: AttributionSourceEvent[],
  purchaseEvents: AttributionPurchaseEvent[],
  windowMs: number
): Set<string> {
  const earliestSourceByUser = new Map<string, Date>();
  for (const e of sourceEvents) {
    const existing = earliestSourceByUser.get(e.userId);
    if (!existing || e.createdAt.getTime() < existing.getTime()) {
      earliestSourceByUser.set(e.userId, e.createdAt);
    }
  }

  const purchasesByUser = new Map<string, Date[]>();
  for (const p of purchaseEvents) {
    const arr = purchasesByUser.get(p.userId) ?? [];
    arr.push(p.createdAt);
    purchasesByUser.set(p.userId, arr);
  }

  const attributed = new Set<string>();
  for (const [userId, firstSource] of earliestSourceByUser.entries()) {
    const purchases = purchasesByUser.get(userId);
    if (!purchases) continue;
    const anyAttributed = purchases.some((purchaseDate) =>
      isAttributed({ userId, createdAt: firstSource }, { userId, createdAt: purchaseDate }, windowMs)
    );
    if (anyAttributed) attributed.add(userId);
  }
  return attributed;
}

// ---------------------------------------------------------------------------
// Historical / reconstructed cohort labeling
// ---------------------------------------------------------------------------

export const HISTORICAL_COHORT_LABEL =
  'HISTORICAL RECONSTRUCTED COHORT — NOT EVENT-AUTHORITATIVE. Methodology: every ' +
  'non-test User with createdAt before the authoritative-start cutoff is treated as a ' +
  'best-effort historical trial-cohort member, keyed on User.createdAt alone. ' +
  'User.isProTrial and User.trialExpiresAt are CLEARED when a trial expires or converts, ' +
  'so they can only prove a CURRENTLY active trial, never a HISTORICAL one that already ' +
  'ended — using them to gate cohort membership silently excludes exactly the users this ' +
  'reconstruction exists to capture. This is observational, not proof: it assumes every ' +
  'pre-cutoff signup received the standard signup trial (grantNewSignupProTrial in ' +
  'lib/users.ts, wired from app/api/auth/register/route.ts) and cannot rule out a signup ' +
  'path that does not grant one.';

export const MIXED_METHODOLOGY_LABEL =
  'MIXED METHODOLOGY WARNING — this total combines an event-authoritative cohort ' +
  'with a historically reconstructed cohort. Never treat it as a single clean ' +
  'denominator; the two halves are reported separately above for a reason.';

// Historical cohort membership is gated on User.createdAt alone (see
// HISTORICAL_COHORT_LABEL above) — a helper keyed on isProTrial/trialExpiresAt
// was deliberately removed here: both fields are CLEARED when a trial expires
// or converts, so they can only prove a CURRENTLY active trial, never a
// HISTORICAL one that already ended. Do not reintroduce a reconstruction rule
// based on either field.

// ---------------------------------------------------------------------------
// Late-trial eligibility (TC-2A's WARN_DAYS=15)
// ---------------------------------------------------------------------------

export const WARN_DAYS = 15;

/**
 * Late-trial eligibility can only be defensibly computed for a user whose
 * trial start AND trial end are both known (i.e. reconstructible), by
 * checking that trialExpiresAt (or the reconstructed createdAt+30d estimate)
 * fell/falls within WARN_DAYS of "now" while status implies they were still
 * trialing. For an expired/historical user where we cannot reconstruct
 * timing (no trialExpiresAt and not currently isProTrial), we explicitly
 * return 'unknown' rather than inflating the count from current plan alone.
 */
export type LateTrialEligibility = 'eligible' | 'not-eligible' | 'unknown';

export function classifyLateTrialEligibility(u: {
  isProTrial: boolean;
  trialExpiresAtMs: number | null; // parsed epoch ms, or null if unparseable/absent
  nowMs: number;
}): LateTrialEligibility {
  if (u.trialExpiresAtMs == null) return 'unknown';
  const daysLeft = (u.trialExpiresAtMs - u.nowMs) / (24 * 60 * 60 * 1000);
  if (!u.isProTrial) {
    // Trial already ended/converted/reverted and we no longer know whether
    // they were ever in the WARN_DAYS window while still trialing.
    return 'unknown';
  }
  return daysLeft <= WARN_DAYS && daysLeft >= 0 ? 'eligible' : 'not-eligible';
}

// ---------------------------------------------------------------------------
// TC-2A exposure — no reliable web-visit signal exists (see script header /
// review packet). Recap-viewed/-clicked remain real, measurable AnalyticsEvent
// populations; what is NOT measurable is "how many late-trial users were
// actually exposed to the banner", because no persisted, timestamped signal
// proves a user opened the WEB app (as opposed to native) while eligible.
// ---------------------------------------------------------------------------

export const RECAP_OPPORTUNITY_NOT_MEASURABLE_REASON =
  'A late-trial user is not proven to have opened the web experience while the ' +
  'personalized banner was eligible.';

// ---------------------------------------------------------------------------
// Cohort maturity / right-censoring (trial age relative to an explicit
// reference timestamp — never the wall clock read inside this file; the caller passes
// the resolved reference in).
// ---------------------------------------------------------------------------

export type TrialAgeBucket = 'EARLY_IN_FLIGHT' | 'LATE_IN_FLIGHT' | 'MATURED';

/**
 * Bucket a trial by elapsed days between `trialStartMs` and `referenceMs`:
 *   EARLY_IN_FLIGHT  0-14 days
 *   LATE_IN_FLIGHT   15-29 days
 *   MATURED          30+ days
 * `referenceMs` must be supplied by the caller (the CLI's resolved --until,
 * or now if --until wasn't given) — this function never reads the wall
 * clock directly.
 */
export function classifyTrialAge(trialStartMs: number, referenceMs: number): TrialAgeBucket {
  const elapsedDays = (referenceMs - trialStartMs) / (24 * 60 * 60 * 1000);
  if (elapsedDays < 15) return 'EARLY_IN_FLIGHT';
  if (elapsedDays < 30) return 'LATE_IN_FLIGHT';
  return 'MATURED';
}

/**
 * MATURED TRIAL -> PAID: unique purchasers among a given matured-trial-user
 * id population, over that same population's size. Pure set-intersection —
 * testable without any DB fixture. Denominator 0 is handled by the caller via
 * formatPercent (always prints "N/A", never "0%"/"NaN").
 */
export function computeMaturedConversion(
  maturedTrialUserIds: Iterable<string>,
  buyerUserIds: Iterable<string>
): { numerator: number; denominator: number } {
  const matured = new Set(maturedTrialUserIds);
  const buyers = new Set(buyerUserIds);
  let numerator = 0;
  for (const id of matured) {
    if (buyers.has(id)) numerator++;
  }
  return { numerator, denominator: matured.size };
}

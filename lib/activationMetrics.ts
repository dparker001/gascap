/**
 * Phase 1 P1-A — time-bounded ACTIVATION metrics (pure computation).
 *
 * Kept apart from lib/engagementBaseline.ts on purpose: that module's
 * Phase 0.5 numbers are all-time historical counts and are unchanged. These
 * are the owner-approved Phase 1 definitions (docs/PHASE1_ACTIVATION_PLAN.md
 * section 3), measured per signup cohort inside fixed windows.
 *
 * DEFINITIONS
 *  - Qualifying fuel action: a real saved, gallon-based gasoline/diesel
 *    fill-up record of any of
 *      personal  — Fillup row, no rentalSessionId
 *      rental    — Fillup row with a rentalSessionId
 *      gig       — GigFillup row with energyUnit 'gal'
 *    EV / kWh records never qualify (kWh and gallons are not mixed).
 *  - Valid: gallons > 0, total cost > 0, unit price within the same
 *    plausibility bounds the EIA ingest uses, gallons <= MAX_PLAUSIBLE_GALLONS.
 *    Deleted rows no longer exist; test and admin accounts are excluded.
 *  - Timing uses the record's createdAt (when it was logged), NOT the
 *    user-entered fill date, so back-dating cannot manufacture activation.
 *  - "Local calendar date": the User model carries no timezone, so the
 *    documented baseline fallback (America/New_York, same as the Phase 0.5
 *    panel) is used for every user. If a per-user timezone is added later,
 *    pass it as `timeZone` on the user and it is honoured.
 *  - First valid fuel action <= 14 days: earliest qualifying action within
 *    14 days (inclusive) of signup. Rate is over MATURED signups only
 *    (signed up >= 14 days ago) so users still inside their window don't
 *    understate it.
 *  - Activated: >= 2 qualifying actions within 30 days (inclusive) of signup
 *    on >= 2 distinct local dates. Matured = signed up >= 30 days ago.
 *  - Personal second-fill diagnostic: same rule restricted to personal
 *    fill-ups; diagnostic only, not the Activated definition.
 */
import { MIN_PLAUSIBLE_PRICE, MAX_PLAUSIBLE_PRICE } from './eiaClient';
import { TIMEZONE } from './engagementBaseline';

export const FIRST_ACTION_WINDOW_DAYS = 14;
export const ACTIVATED_WINDOW_DAYS = 30;
export const MAX_PLAUSIBLE_GALLONS = 500;

const DAY_MS = 86_400_000;

export type FuelActionSource = 'personal' | 'rental' | 'gig';

export interface FuelActionRecord {
  userId: string;
  source: FuelActionSource;
  /** ISO timestamp the record was logged. */
  createdAt: string;
  gallons: number;
  pricePerGallon: number;
  totalCost: number;
  /** 'kwh' records are excluded. Absent/'gal' = gallons. */
  energyUnit?: 'gal' | 'kwh';
}

export interface ActivationUser {
  id: string;
  /** Signup instant (ISO). */
  createdAt: string;
  isTestAccount?: boolean;
  role?: string | null;
  /** IANA timezone if the data model ever provides one; else the fallback. */
  timeZone?: string | null;
}

export interface ActivationInput {
  now: Date;
  users: ActivationUser[];
  fuelActions: FuelActionRecord[];
  vehicleUserIds: string[];
  truncated?: boolean;
}

export function isQualifyingFuelAction(r: FuelActionRecord): boolean {
  if (r.energyUnit === 'kwh') return false;
  return (
    Number.isFinite(r.gallons) && r.gallons > 0 && r.gallons <= MAX_PLAUSIBLE_GALLONS &&
    Number.isFinite(r.totalCost) && r.totalCost > 0 &&
    Number.isFinite(r.pricePerGallon) &&
    r.pricePerGallon >= MIN_PLAUSIBLE_PRICE && r.pricePerGallon <= MAX_PLAUSIBLE_PRICE
  );
}

/** Calendar date (YYYY-MM-DD) of an instant in an IANA zone. */
export function localDateOf(iso: string, timeZone: string = TIMEZONE): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(t));
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(t));
  }
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export interface RateRow { users: number; eligible: number; rate: number | null }

export interface ActivationReport {
  generatedAt: string;
  timezone: string;
  truncated: boolean;
  cohort: {
    eligibleSignups: number;
    matured14: number;
    matured30: number;
    pending14: number;
    pending30: number;
  };
  /** PRIMARY leading metric. Denominator = matured14 signups. */
  firstAction14d: RateRow;
  /** NORTH STAR. Denominator = matured30 signups. */
  activated30d: RateRow;
  /** Matured30 signups with any qualifying action <= 30d (denominator for the conversion below). */
  firstAction30d: RateRow;
  personalSecondFill30d: RateRow;
  /** Of matured14 signups who have a saved vehicle: share with a first action <= 14d. */
  vehicleToFirstAction14d: RateRow;
  /** Of matured30 signups with a first action <= 30d: share Activated. */
  firstActionToActivated30d: RateRow;
  firstActionBySource14d: Record<FuelActionSource, number>;
  definitions: string[];
}

export function computeActivation(input: ActivationInput): ActivationReport {
  const nowMs = input.now.getTime();
  const pop = input.users.filter((u) => !u.isTestAccount && u.role !== 'admin');
  const popById = new Map(pop.map((u) => [u.id, u]));

  const byUser = new Map<string, FuelActionRecord[]>();
  for (const r of input.fuelActions) {
    if (!popById.has(r.userId) || !isQualifyingFuelAction(r)) continue;
    const arr = byUser.get(r.userId);
    if (arr) arr.push(r); else byUser.set(r.userId, [r]);
  }
  const vehicleUsers = new Set(input.vehicleUserIds);

  let matured14 = 0, matured30 = 0;
  let first14 = 0, first30 = 0, activated = 0, personalSecond = 0;
  let vehMatured14 = 0, vehFirst14 = 0;
  const bySource14: Record<FuelActionSource, number> = { personal: 0, rental: 0, gig: 0 };

  for (const u of pop) {
    const signupMs = Date.parse(u.createdAt);
    if (Number.isNaN(signupMs)) continue;
    const age = nowMs - signupMs;
    const m14 = age >= FIRST_ACTION_WINDOW_DAYS * DAY_MS;
    const m30 = age >= ACTIVATED_WINDOW_DAYS * DAY_MS;
    if (m14) matured14 += 1;
    if (m30) matured30 += 1;

    // Qualifying actions in time order, at/after signup (a negative offset is
    // a data error, never an action), within the 30-day outer window.
    const actions = (byUser.get(u.id) ?? [])
      .map((r) => ({ r, ms: Date.parse(r.createdAt) }))
      .filter((a) => !Number.isNaN(a.ms) && a.ms >= signupMs && a.ms - signupMs <= ACTIVATED_WINDOW_DAYS * DAY_MS)
      .sort((a, b) => a.ms - b.ms);

    const tz = u.timeZone || TIMEZONE;
    const distinctDates = (list: typeof actions) =>
      new Set(list.map((a) => localDateOf(a.r.createdAt, tz)).filter((d): d is string => d !== null));

    const within14 = actions.filter((a) => a.ms - signupMs <= FIRST_ACTION_WINDOW_DAYS * DAY_MS);
    const hasFirst14 = within14.length > 0;
    const hasFirst30 = actions.length > 0;
    const isActivated = distinctDates(actions).size >= 2;
    const personalOnly = actions.filter((a) => a.r.source === 'personal');
    const hasPersonalSecond = distinctDates(personalOnly).size >= 2;

    if (m14) {
      if (hasFirst14) {
        first14 += 1;
        bySource14[within14[0].r.source] += 1;
      }
      if (vehicleUsers.has(u.id)) {
        vehMatured14 += 1;
        if (hasFirst14) vehFirst14 += 1;
      }
    }
    if (m30) {
      if (hasFirst30) first30 += 1;
      if (isActivated) activated += 1;
      if (hasPersonalSecond) personalSecond += 1;
    }
  }

  const signups = pop.length;
  return {
    generatedAt: input.now.toISOString(),
    timezone: TIMEZONE,
    truncated: !!input.truncated,
    cohort: {
      eligibleSignups: signups,
      matured14,
      matured30,
      pending14: signups - matured14,
      pending30: signups - matured30,
    },
    firstAction14d: { users: first14, eligible: matured14, rate: pct(first14, matured14) },
    activated30d: { users: activated, eligible: matured30, rate: pct(activated, matured30) },
    firstAction30d: { users: first30, eligible: matured30, rate: pct(first30, matured30) },
    personalSecondFill30d: { users: personalSecond, eligible: matured30, rate: pct(personalSecond, matured30) },
    vehicleToFirstAction14d: { users: vehFirst14, eligible: vehMatured14, rate: pct(vehFirst14, vehMatured14) },
    firstActionToActivated30d: { users: activated, eligible: first30, rate: pct(activated, first30) },
    firstActionBySource14d: bySource14,
    definitions: [
      'Phase 1 activation metrics are TIME-BOUNDED per signup cohort. They are separate from the all-time historical funnel above, which is unchanged.',
      'Qualifying fuel action = a real saved gasoline/diesel (gallon-based) fill-up: personal, rental (Fillup with a rental session) or gig (energyUnit gal). EV/kWh records are excluded; kWh and gallons are never mixed.',
      'Valid = gallons > 0 (and <= 500), total cost > 0, unit price within $0.50-$15.00/gal. Test accounts, admins and deleted rows are excluded.',
      'Timing uses when the record was logged (createdAt), not the user-entered fill date, so back-dating cannot create activation.',
      'First valid fuel action <= 14 days (primary leading metric): earliest qualifying action within 14 days (inclusive) of signup; rate over signups at least 14 days old.',
      'Activated (north star): at least two qualifying actions within 30 days (inclusive) of signup on two distinct local calendar dates; rate over signups at least 30 days old.',
      'Local date uses America/New_York for every user: the data model has no per-user timezone, so the documented baseline fallback applies.',
      'Personal second-fill is a diagnostic (personal fill-ups only), not part of the Activated definition. Vehicle -> first action uses current saved vehicles (deleted vehicles are not counted).',
      'Signups newer than the window are shown as pending and are NOT in the rates, so a young cohort never understates a rate.',
    ],
  };
}

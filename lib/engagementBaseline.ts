/**
 * Engagement & conversion BASELINE (Phase 0.5A) — pure computation.
 *
 * Purpose: establish where GasCap stands TODAY — retention, DAU/WAU, fuel
 * actions, paywall exposure, trials currently paid / trial -> purchase event —
 * from data that already exists,
 * so GasCap Daily can later be judged against a real baseline instead of a
 * guess. This module only reads the shapes handed to it; the route
 * (app/api/admin/engagement-baseline) loads them. No writes, no new tracking.
 *
 * DEFINITIONS (also surfaced in the report's `definitions` block):
 *  - Population: every real user — `isTestAccount` and admin accounts are
 *    excluded by the loader. Deleted accounts no longer exist and are not
 *    counted (survivorship bias is possible for old cohorts).
 *  - Activity: a user is "active" on a day if that YYYY-MM-DD is in
 *    User.activeDays. A day is added by any app visit (client-local date)
 *    or sign-in (UTC date). Visits are NOT in AnalyticsEvent, so activeDays
 *    is the only activity source. Because client-local and UTC dates can
 *    differ by a day, Day 0 = the earlier of the signup UTC date and the
 *    user's earliest active day.
 *  - Retention Day N: of users whose Day 0 is at least N days ago (the
 *    "matured" cohort — newer users haven't had the chance yet), the share
 *    active on exactly Day N ("exact") and the share active on Day N or
 *    later ("onOrAfter", the funnel measure, monotonic by construction).
 *  - Fuel action: a Fillup row (personal or rental — both are logged fuel
 *    purchases). First = >=1 row, second = >=2. Calculator runs are not
 *    persisted, so they are not fuel actions here.
 *  - Trial (historical population): a current real user with ANY of — a
 *    trial_started event, a trial_expired event, or a trial column set. It is the
 *    de-duplicated UNION of distinct user ids (never a sum of sources and never a
 *    count of event rows). trial_expired matters: a trial that already ended
 *    has its columns cleared, so only the event still evidences it. Event data only
 *    begins when instrumentation shipped, so both counts are reported.
 *  - Paid: entitlement from a paid source (Stripe subscription, Stripe/gift
 *    lifetime, RevenueCat) per lib/entitlements. Ambassador-for-life and a
 *    running trial do NOT count as paid.
 *  - "Trials currently paid" is a CURRENT-STATUS snapshot: of users who ever had
 *    a trial, the share holding a paid entitlement NOW. It is NOT historical
 *    conversion — a user who converted and later cancelled is not counted.
 *    "Trial -> purchase event" is the closer-to-historical measure (a
 *    purchase_completed event exists for the user) but is directional only;
 *    see dataQuality.
 *  - "Today" is the America/New_York calendar date.
 */
import { resolveUserEntitlements } from './entitlements';

export const RETENTION_DAYS = [1, 3, 7, 14, 30] as const;
export const TIMEZONE = 'America/New_York';

export const EVENT_NAMES = [
  'trial_started',
  'trial_expired',
  'paywall_viewed',
  'upgrade_plan_selected',
  'trial_value_recap_viewed',
  'trial_value_recap_upgrade_clicked',
  'checkout_started',
  'iap_checkout_started',
  'purchase_completed',
  'fillup_logged',
  'vehicle_saved',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export interface BaselineUser {
  id: string;
  createdAt: string;
  activeDays: string[];
  isProTrial: boolean;
  trialExpiresAt: string | null;
  ambassadorProForLife: boolean;
  stripeInterval: string | null;
  stripeSubscriptionId: string | null;
  revenueCatActive: boolean;
  revenueCatInterval: string | null;
}

export interface EventAgg {
  /** Distinct userIds that emitted the event (anonymous rows excluded). */
  users: string[];
  /** Total rows, including anonymous. */
  total: number;
  /** Earliest row (ISO) — tells you when measurement of this event began. */
  firstAt: string | null;
}

export interface BaselineInput {
  now: Date;
  users: BaselineUser[];
  /** userId -> logged fill-ups: count and earliest createdAt (ISO). */
  fillups: Record<string, { count: number; firstAt: string | null }>;
  savedStationUserIds: string[];
  vehicleUserIds: string[];
  events: Partial<Record<EventName, EventAgg>>;
  /** One entry per purchase_completed row (production-classified upstream). */
  purchases: { userId: string; at: string; provider: string | null; billing: string | null }[];
  revenueCat: { CANCELLATION: number; EXPIRATION: number; REFUND: number };
  /** True if the loader hit a row cap — numbers are then lower bounds. */
  truncated?: boolean;
}

// ── helpers (exported for tests) ────────────────────────────────────────────

const DAY_MS = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function dayNum(ymd: string): number | null {
  if (!YMD.test(ymd)) return null;
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.floor(t / DAY_MS);
}

export function ymdFromDayNum(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** America/New_York calendar date (YYYY-MM-DD) for an instant. */
export function etDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function rate(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}

/** Day 0 for a user: earlier of signup UTC date and earliest active day. */
export function userDay0(u: Pick<BaselineUser, 'createdAt' | 'activeDays'>): number | null {
  const created = dayNum((u.createdAt ?? '').slice(0, 10));
  const actives = u.activeDays.map(dayNum).filter((n): n is number => n !== null);
  const candidates = [...(created !== null ? [created] : []), ...(actives.length ? [Math.min(...actives)] : [])];
  return candidates.length ? Math.min(...candidates) : null;
}

const PAID_SOURCES = new Set(['stripe_or_gift_lifetime', 'stripe_subscription', 'revenuecat']);

export function hasPaidEntitlement(u: BaselineUser, now: Date): boolean {
  const r = resolveUserEntitlements({
    ambassadorProForLife: u.ambassadorProForLife,
    stripeInterval:       u.stripeInterval,
    stripeSubscriptionId: u.stripeSubscriptionId,
    revenueCatActive:     u.revenueCatActive,
    revenueCatInterval:   u.revenueCatInterval,
    isProTrial:           u.isProTrial,
    trialExpiresAt:       u.trialExpiresAt,
  }, now.getTime());
  return r.sources.some((s) => PAID_SOURCES.has(s));
}

export function isActiveTrial(u: BaselineUser, now: Date): boolean {
  return u.isProTrial && !!u.trialExpiresAt && Date.parse(u.trialExpiresAt) > now.getTime();
}

// ── report ──────────────────────────────────────────────────────────────────

export interface RetentionRow {
  day: number;
  eligible: number;
  exactActive: number;
  exactRate: number | null;
  onOrAfterActive: number;
  onOrAfterRate: number | null;
}

export interface BaselineReport {
  generatedAt: string;
  todayET: string;
  timezone: typeof TIMEZONE;
  truncated: boolean;
  population: {
    signups: number;
    trialsEver: number;
    trialDefinition: { byTrialStarted: number; byTrialExpired: number; byTrialColumns: number; union: number };
    activeTrialNow: number;
    paidNow: number;
  };
  activity: {
    dauToday: number;
    dauYesterday: number;
    wau7d: number;
    mau30d: number;
    dauSeries: { date: string; users: number }[];
  };
  retention: RetentionRow[];
  fuelActions: {
    usersWithFirstFillup: number;
    usersWithSecondFillup: number;
    firstFillupRate: number | null;
    secondFillupRate: number | null;
    totalFillups: number;
    fillupsPerSignup: number | null;
    fillupsPerActiveFuelUser: number | null;
    medianHoursToFirstFillup: number | null;
    usersWithSavedStation: number;
    savedStationRate: number | null;
    usersWithVehicle: number;
    vehicleRate: number | null;
  };
  paywall: Record<string, { users: number; total: number; firstAt: string | null; trust: 'server' | 'client' }>;
  conversion: {
    purchaseEventUsers: number;
    purchasesByProviderBilling: Record<string, number>;
    /** CURRENT paid entitlement among users who ever had a trial. Not historical conversion. */
    trialsCurrentlyPaid: { trials: number; paidNow: number; rate: number | null };
    /** Users with a purchase_completed event among trial users. Closer to historical, but directional (see dataQuality). */
    trialToPurchaseEvent: { trials: number; users: number; rate: number | null; eventsBeganAt: string | null };
    trialExpiredEvents: number;
    medianDaysSignupToFirstPurchase: number | null;
  };
  cancellation: {
    revenueCat: { CANCELLATION: number; EXPIRATION: number; REFUND: number };
    stripe: null;
    note: string;
  };
  funnel: { step: string; users: number | null; pctOfSignups: number | null; matureEligible: number | null; note?: string }[];
  definitions: string[];
  dataQuality: string[];
}

const TRUST: Record<string, 'server' | 'client'> = {
  trial_started: 'server', trial_expired: 'server', checkout_started: 'server',
  purchase_completed: 'server', fillup_logged: 'server', vehicle_saved: 'server',
  paywall_viewed: 'client', upgrade_plan_selected: 'client', iap_checkout_started: 'client',
  trial_value_recap_viewed: 'client', trial_value_recap_upgrade_clicked: 'client',
};

export function computeBaseline(input: BaselineInput): BaselineReport {
  const { now, users } = input;
  const today = etDate(now);
  const todayN = dayNum(today) as number;
  const userIds = new Set(users.map((u) => u.id));
  const inPop = (ids: string[]) => ids.filter((id) => userIds.has(id));

  // ── population ───────────────────────────────────────────────────────────
  // Distinct CURRENT REAL users only: `users` already excludes test/admin
  // accounts, and inPop() drops event rows for anyone outside it (test, admin,
  // deleted). Sets de-duplicate users, so repeated event rows never inflate this.
  const trialStarted = new Set(inPop(input.events.trial_started?.users ?? []));
  const trialExpired = new Set(inPop(input.events.trial_expired?.users ?? []));
  const trialCols    = new Set(users.filter((u) => u.isProTrial || !!u.trialExpiresAt).map((u) => u.id));
  const trialsEver   = new Set([...trialStarted, ...trialExpired, ...trialCols]);
  const paidSet    = new Set(users.filter((u) => hasPaidEntitlement(u, now)).map((u) => u.id));

  // ── activity ─────────────────────────────────────────────────────────────
  const last30 = Array.from({ length: 30 }, (_, i) => todayN - i);       // today .. today-29
  const dayUsers = new Map<number, Set<string>>(last30.map((n) => [n, new Set<string>()]));
  for (const u of users) {
    for (const d of u.activeDays) {
      const n = dayNum(d);
      if (n !== null) dayUsers.get(n)?.add(u.id);
    }
  }
  const distinctOver = (days: number) => {
    const s = new Set<string>();
    for (let i = 0; i < days; i++) dayUsers.get(todayN - i)?.forEach((id) => s.add(id));
    return s.size;
  };
  const dauSeries = last30.slice(0, 14).reverse().map((n) => ({ date: ymdFromDayNum(n), users: dayUsers.get(n)!.size }));

  // ── retention + funnel (per-user Day 0 offsets) ──────────────────────────
  const rows: RetentionRow[] = RETENTION_DAYS.map((day) => ({
    day, eligible: 0, exactActive: 0, exactRate: null, onOrAfterActive: 0, onOrAfterRate: null,
  }));
  const reached: Record<number, number> = {};   // any user (matured or not) active on/after day N
  for (const d of RETENTION_DAYS) reached[d] = 0;

  for (const u of users) {
    const d0 = userDay0(u);
    if (d0 === null) continue;
    const offsets = new Set(u.activeDays.map(dayNum).filter((n): n is number => n !== null).map((n) => n - d0));
    const maxOff = offsets.size ? Math.max(...offsets) : -1;
    for (const row of rows) {
      if (maxOff >= row.day) reached[row.day] += 1;
      if (todayN - d0 < row.day) continue;               // not matured for this N
      row.eligible += 1;
      if (offsets.has(row.day)) row.exactActive += 1;
      if (maxOff >= row.day)    row.onOrAfterActive += 1;
    }
  }
  for (const row of rows) {
    row.exactRate = rate(row.exactActive, row.eligible);
    row.onOrAfterRate = rate(row.onOrAfterActive, row.eligible);
  }

  // ── fuel actions ─────────────────────────────────────────────────────────
  let first = 0, second = 0, totalFillups = 0;
  const hoursToFirst: number[] = [];
  for (const u of users) {
    const f = input.fillups[u.id];
    if (!f || f.count < 1) continue;
    first += 1;
    if (f.count >= 2) second += 1;
    totalFillups += f.count;
    if (f.firstAt) {
      const h = (Date.parse(f.firstAt) - Date.parse(u.createdAt)) / 3_600_000;
      if (Number.isFinite(h) && h >= 0) hoursToFirst.push(h);
    }
  }
  const savedUsers = new Set(inPop(input.savedStationUserIds));
  const vehicleUsers = new Set(inPop(input.vehicleUserIds));

  // ── paywall / upgrade ────────────────────────────────────────────────────
  const paywall: BaselineReport['paywall'] = {};
  for (const name of EVENT_NAMES) {
    if (name === 'fillup_logged' || name === 'vehicle_saved' || name === 'trial_started') continue;
    const e = input.events[name];
    paywall[name] = {
      users: e ? inPop(e.users).length : 0,
      total: e?.total ?? 0,
      firstAt: e?.firstAt ?? null,
      trust: TRUST[name] ?? 'client',
    };
  }

  // ── conversion ───────────────────────────────────────────────────────────
  const purchasers = new Set(inPop(input.purchases.map((p) => p.userId)));
  const byPB: Record<string, number> = {};
  const firstPurchaseAt = new Map<string, string>();
  for (const p of input.purchases) {
    if (!userIds.has(p.userId)) continue;
    const k = `${p.provider ?? 'unknown'}:${p.billing ?? 'unknown'}`;
    byPB[k] = (byPB[k] ?? 0) + 1;
    const prev = firstPurchaseAt.get(p.userId);
    if (!prev || p.at < prev) firstPurchaseAt.set(p.userId, p.at);
  }
  const daysToPay: number[] = [];
  for (const u of users) {
    const at = firstPurchaseAt.get(u.id);
    if (!at) continue;
    const d = (Date.parse(at) - Date.parse(u.createdAt)) / DAY_MS;
    if (Number.isFinite(d) && d >= 0) daysToPay.push(d);
  }
  const trialPaidNow = [...trialsEver].filter((id) => paidSet.has(id)).length;
  const trialPurch   = [...trialsEver].filter((id) => purchasers.has(id)).length;

  // ── funnel ───────────────────────────────────────────────────────────────
  const maturedFor = (day: number) => rows.find((r) => r.day === day)!.eligible;
  const signups = users.length;
  const funnel: BaselineReport['funnel'] = [
    { step: 'Signups', users: signups, pctOfSignups: rate(signups, signups), matureEligible: null },
    ...RETENTION_DAYS.map((d) => ({
      step: `Active on Day ${d} or later`,
      users: reached[d],
      pctOfSignups: rate(reached[d], signups),
      matureEligible: maturedFor(d),
    })),
    { step: 'Logged first fill-up', users: first, pctOfSignups: rate(first, signups), matureEligible: null },
    { step: 'Logged second fill-up', users: second, pctOfSignups: rate(second, signups), matureEligible: null },
    { step: 'Viewed savings', users: null, pctOfSignups: null, matureEligible: null,
      note: 'Not tracked: no event exists for viewing the savings dashboard.' },
    { step: 'Has paid entitlement now', users: paidSet.size, pctOfSignups: rate(paidSet.size, signups), matureEligible: null },
  ];

  return {
    generatedAt: now.toISOString(),
    todayET: today,
    timezone: TIMEZONE,
    truncated: !!input.truncated,
    population: {
      signups,
      trialsEver: trialsEver.size,
      trialDefinition: {
        byTrialStarted: trialStarted.size,
        byTrialExpired: trialExpired.size,
        byTrialColumns: trialCols.size,
        union: trialsEver.size,
      },
      activeTrialNow: users.filter((u) => isActiveTrial(u, now)).length,
      paidNow: paidSet.size,
    },
    activity: {
      dauToday: dayUsers.get(todayN)!.size,
      dauYesterday: dayUsers.get(todayN - 1)!.size,
      wau7d: distinctOver(7),
      mau30d: distinctOver(30),
      dauSeries,
    },
    retention: rows,
    fuelActions: {
      usersWithFirstFillup: first,
      usersWithSecondFillup: second,
      firstFillupRate: rate(first, signups),
      secondFillupRate: rate(second, signups),
      totalFillups,
      fillupsPerSignup: signups > 0 ? Math.round((totalFillups / signups) * 100) / 100 : null,
      fillupsPerActiveFuelUser: first > 0 ? Math.round((totalFillups / first) * 100) / 100 : null,
      medianHoursToFirstFillup: median(hoursToFirst),
      usersWithSavedStation: savedUsers.size,
      savedStationRate: rate(savedUsers.size, signups),
      usersWithVehicle: vehicleUsers.size,
      vehicleRate: rate(vehicleUsers.size, signups),
    },
    paywall,
    conversion: {
      purchaseEventUsers: purchasers.size,
      purchasesByProviderBilling: byPB,
      trialsCurrentlyPaid: { trials: trialsEver.size, paidNow: trialPaidNow, rate: rate(trialPaidNow, trialsEver.size) },
      trialToPurchaseEvent: {
        trials: trialsEver.size, users: trialPurch, rate: rate(trialPurch, trialsEver.size),
        eventsBeganAt: input.events.purchase_completed?.firstAt ?? null,
      },
      trialExpiredEvents: input.events.trial_expired?.total ?? 0,
      medianDaysSignupToFirstPurchase: median(daysToPay),
    },
    cancellation: {
      revenueCat: input.revenueCat,
      stripe: null,
      note: 'RevenueCat counts are webhook rows received (all time, includes users since deleted). Stripe cancellations are not recorded as events — the subscription id is simply cleared — so there is no Stripe cancellation figure.',
    },
    funnel,
    definitions: [
      'Population = real users; test accounts and admins excluded. Deleted accounts are gone from the data.',
      'Active day = a YYYY-MM-DD in activeDays (app visit by client-local date, or sign-in by UTC date). Day 0 = earlier of signup UTC date and first active day.',
      'Retention Day N is computed over the matured cohort only (Day 0 at least N days ago). "Exact" = active on Day N; "on or after" = active on Day N or any later day.',
      'Fuel action = a logged Fillup row (personal or rental). Calculator runs are not persisted and are not counted.',
      'Trial (historical population) = distinct current real users with a trial_started event, OR a trial_expired event, OR a trial column set — de-duplicated into one union, never a sum of sources and never a count of event rows. Test accounts, admins and deleted users are excluded. The three source counts are shown so the derivation is visible.',
      'Paid = entitlement from Stripe subscription, Stripe/gift lifetime, or RevenueCat. Running trials and Ambassador-for-life are not paid.',
      'Trials currently paid = of users who ever had a trial, how many hold a paid entitlement NOW. A user who converted and later cancelled is NOT counted, so this is a current-status snapshot, not historical or lifetime trial-to-paid conversion.',
      'Trial -> purchase event = of users who ever had a trial, how many have a purchase_completed event. Closer to historical conversion, but treat it as directional (see data quality).',
      'Today = America/New_York calendar date.',
    ],
    dataQuality: [
      'Visits are not events. DAU/WAU/retention come from activeDays only.',
      'Server events (trial_started, purchase_completed, fillup_logged, checkout_started) are authoritative. Client events (paywall_viewed, upgrade_plan_selected, iap_checkout_started, trial_value_recap_*) are self-reported and can be missing or spoofed.',
      'RevenueCat purchase_completed is production-only (sandbox excluded upstream). Stripe purchase_completed is NOT filtered for test mode; test accounts are excluded by flag only. Test accounts are excluded from the population. Therefore historical purchase-event conversion is directional, not definitive.',
      'Compare each event\'s firstAt: it is when measurement of that event began. Rates computed over older signups understate it.',
      'Saved-station and vehicle counts are the current state (deleted items are not counted).',
      ...(input.truncated ? ['A row cap was hit while loading — counts are lower bounds.'] : []),
    ],
  };
}

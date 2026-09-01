/**
 * READ-ONLY PRODUCTION DIAGNOSTIC. NO DATA MUTATIONS.
 *
 * TC-2B-B — Trial→Paid Conversion Funnel Diagnostic.
 *
 * Measures the trial → activation → retention → TC-2A recap → upgrade →
 * checkout → purchase funnel from AnalyticsEvent + User + Vehicle + Fillup +
 * RentalSession, per the design in
 * docs/reviews/2026-09-01-tc2b-conversion-measurement-design.md.
 *
 * READ-ONLY GUARANTEE: this script issues only Prisma `findMany` / `count` /
 * `groupBy` read calls. It contains zero `create`/`update`/`upsert`/
 * `delete`/`createMany`/`updateMany`/`deleteMany` calls, no write
 * transactions, no raw INSERT/UPDATE/DELETE/ALTER/DROP/TRUNCATE, no
 * Stripe/RevenueCat mutation calls, and no email/push sends. See
 * __tests__/conversionFunnelDiagnostic.test.ts for a structural proof.
 *
 * NO PII: no userId, email, name, phone, VIN, vehicle identifier, Stripe
 * customer/subscription/checkout-session id, RevenueCat app-user id, receipt
 * id, or raw AnalyticsEvent row is ever printed. userId is used only as an
 * in-memory join key for attribution; it never reaches stdout.
 *
 * Run (production credentials injected locally, never committed — see
 * scripts/diagnostics/README.md):
 *
 *   railway run --service gascap -- npx tsx scripts/diagnostics/conversion_funnel.ts [flags]
 *
 * Flags:
 *   --days=7|14|30                (default 30)
 *   --since=<ISO8601> --until=<ISO8601>   (overrides --days when given)
 *   --authoritative-start=<ISO8601>       (enables the event-authoritative post-TC-2B-A cohort;
 *                                           without it, the entire window is reported as the
 *                                           historical reconstructed cohort only)
 *   --tc2a-start=<ISO8601>                (required for the TC-2A pre/post section)
 *   --attribution-hours=N | --attribution-days=N   (default 7 days)
 *   --json                                 (aggregates-only JSON, same PII rules)
 */

// Must set env BEFORE any imports that use it — matches
// scripts/query_trials.ts's established convention.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/lib/generated/prisma/client';
import {
  parseArgs,
  resolveWindow,
  classifyActivation,
  classifyHighlyActivatedHypothesis,
  classifyReturnedAnotherDay,
  activeDaysBucket,
  calculationBand,
  formatPercent,
  isSmallSample,
  SMALL_SAMPLE_THRESHOLD,
  countEventsAndUniqueUsers,
  classifyBilling,
  classifyPlatform,
  computeAttributedBuyers,
  HISTORICAL_COHORT_LABEL,
  MIXED_METHODOLOGY_LABEL,
  classifyLateTrialEligibility,
  classifyTrialAge,
  computeMaturedConversion,
  RECAP_OPPORTUNITY_NOT_MEASURABLE_REASON,
  ArgParseError,
  CHECKOUT_ATTRIBUTION_MS,
  type UserActivityCounts,
  type TrialAgeBucket,
} from './conversionFunnelLib';

const FUNNEL_EVENT_TYPES = [
  'trial_started',
  'trial_value_recap_viewed',
  'trial_value_recap_upgrade_clicked',
  'upgrade_plan_selected',
  'checkout_started',
  'iap_checkout_started',
  'purchase_completed',
  'trial_expired',
] as const;

function fail(message: string): never {
  console.error(`\n[conversion_funnel] ERROR: ${message}\n`);
  process.exit(1);
}

function toEpochMsOrNull(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    fail('DATABASE_URL is not set. Refusing to run — this script must never silently print zeros.');
  }

  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof ArgParseError) fail(e.message);
    throw e;
  }

  if (args.tc2aStart === null && process.argv.some((a) => a.startsWith('--tc2a-comparison'))) {
    // Defensive: no such flag exists, but keep the explicit-refusal contract
    // visible in code in case a future edit adds one without wiring the check.
    fail('TC-2A comparison requested without --tc2a-start=<ISO8601>.');
  }

  const now = new Date();
  const { start, end } = resolveWindow(args, now);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const lines: string[] = [];
  const print = (s = '') => lines.push(s);

  try {
    print('='.repeat(78));
    print('GasCap TC-2B-B — Conversion Funnel Diagnostic (READ-ONLY)');
    print('='.repeat(78));
    print(`Resolved window: ${start.toISOString()}  →  ${end.toISOString()}`);
    print(`Attribution window (recap→purchase, default): ${args.attributionWindowLabel}`);
    print(`Checkout→purchase attribution window: ${CHECKOUT_ATTRIBUTION_MS / 86_400_000}d ` +
      `(same 7-day default — no repo evidence supports a tighter window; see script header)`);
    if (args.authoritativeStart) {
      print(`Authoritative cohort cutoff: ${args.authoritativeStart.toISOString()}`);
    } else {
      print('No --authoritative-start given — entire cohort reported as HISTORICAL RECONSTRUCTED.');
    }
    print();

    // -----------------------------------------------------------------
    // AnalyticsEvent funnel query — fetched BEFORE cohort construction
    // because BLOCKER 1's authoritative cohort membership is derived from
    // the trial_started AnalyticsEvent, not from User.createdAt (see below).
    // -----------------------------------------------------------------
    const rawEvents = await prisma.analyticsEvent.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        eventType: { in: [...FUNNEL_EVENT_TYPES] },
      },
      select: { userId: true, eventType: true, createdAt: true, billing: true, provider: true, originPlatform: true, metadata: true },
    });

    // FIX 1 — test-account exclusion for event-derived populations. The
    // AnalyticsEvent table has no isTestAccount column of its own (it isn't
    // joined to User), so a test account's rows would otherwise flow
    // unfiltered into every downstream user-level population (recap
    // viewed/clicked, plan selection, checkout, purchase, platform
    // breakdown, TC-2A attribution, and now the authoritative trial cohort).
    // Look up which of the userIds that actually appear in this window's
    // events belong to a test account, and drop those rows. Null-userId rows
    // are never test-account rows (there is no user to test-flag) and are
    // left untouched — they still correctly never enter a user-level
    // denominator via countEventsAndUniqueUsers.
    const eventUserIds = [...new Set(rawEvents.map((e) => e.userId).filter((id): id is string => id != null))];
    const testAccountRows = eventUserIds.length
      ? await prisma.user.findMany({ where: { id: { in: eventUserIds }, isTestAccount: true }, select: { id: true } })
      : [];
    const testAccountIdSet = new Set(testAccountRows.map((r) => r.id));
    const events = rawEvents.filter((e) => !e.userId || !testAccountIdSet.has(e.userId));

    const byType = new Map<string, typeof events>();
    for (const e of events) {
      const arr = byType.get(e.eventType) ?? [];
      arr.push(e);
      byType.set(e.eventType, arr);
    }

    // -----------------------------------------------------------------
    // BLOCKER 1 — authoritative cohort membership derived from the
    // trial_started AnalyticsEvent, never from User.createdAt.
    //
    // Rule: a user is an authoritative-cohort member iff there exists a
    // trial_started AnalyticsEvent row with userId != null, that row's
    // userId does not belong to a test account (testAccountIdSet, above),
    // and createdAt >= authoritativeStart (the event is also already
    // window-scoped to [start, end) by the query above). Unique-userId
    // semantics: a user with multiple trial_started events (e.g.
    // redelivery) counts once, keyed on their EARLIEST such event's
    // createdAt — that earliest timestamp is the authoritative trial-start
    // timestamp used everywhere downstream (never User.createdAt).
    // A null-userId trial_started event may still appear in the raw
    // event/unique-user counts printed in EVENT FUNNEL below (via
    // countEventsAndUniqueUsers, which already never lets a null userId
    // reach the unique-user denominator) but can never enter this
    // user-level authoritative population.
    // -----------------------------------------------------------------
    const authoritativeTrialStartMsByUser = new Map<string, number>();
    if (args.authoritativeStart) {
      const authoritativeStartMs = args.authoritativeStart.getTime();
      for (const e of byType.get('trial_started') ?? []) {
        if (!e.userId) continue; // null-userId events never enter a user-level denominator
        const ts = e.createdAt.getTime();
        if (ts < authoritativeStartMs) continue; // event is in-window but predates the cutoff
        const existing = authoritativeTrialStartMsByUser.get(e.userId);
        if (existing == null || ts < existing) {
          authoritativeTrialStartMsByUser.set(e.userId, ts); // earliest event wins
        }
      }
    }
    const authoritativeUserIds = [...authoritativeTrialStartMsByUser.keys()];

    // -----------------------------------------------------------------
    // Cohort query: users created in [start, end) — this remains the basis
    // for the HISTORICAL RECONSTRUCTED COHORT only (unchanged from the
    // prior round). It is NOT used to determine authoritative membership.
    // -----------------------------------------------------------------
    const users = await prisma.user.findMany({
      where: {
        isTestAccount: false,
        createdAt: { gte: start.toISOString(), lt: end.toISOString() },
      },
      select: {
        id: true,
        createdAt: true,
        isProTrial: true,
        trialExpiresAt: true,
        calcCount: true,
        budgetCalcCount: true,
        activeDays: true,
        signupPlatform: true,
      },
    });

    const windowUserIds = users.map((u) => u.id);
    const windowUserIdSet = new Set(windowUserIds);

    // A user in the authoritative-cohort (keyed on their trial_started event)
    // whose User.createdAt does not fall inside [start, end) is still a real
    // authoritative member — trial_started timing, not account-creation
    // timing, governs membership per BLOCKER 1. Fetch those extra users
    // (never re-widening the HISTORICAL cohort's own createdAt-window rule
    // above) so we can source their incidental account-age context and
    // activity counts. isTestAccount:false is redundant here (authoritative
    // userIds are already sourced from test-account-filtered events) but
    // kept for fail-closed defense in depth per CLAUDE.md.
    const extraAuthoritativeUserIds = authoritativeUserIds.filter((id) => !windowUserIdSet.has(id));
    const extraUsers = extraAuthoritativeUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: extraAuthoritativeUserIds }, isTestAccount: false },
          select: {
            id: true,
            createdAt: true,
            isProTrial: true,
            trialExpiresAt: true,
            calcCount: true,
            budgetCalcCount: true,
            activeDays: true,
            signupPlatform: true,
          },
        })
      : [];

    // Union of userIds needing domain-activity counts: window-cohort users
    // (for the historical/reconstructed side) plus any authoritative-cohort
    // users pulled in above.
    const allUserIds = [...new Set([...windowUserIds, ...extraUsers.map((u) => u.id)])];

    // Per-user domain counts. groupBy avoids N+1 per-user queries. All three
    // are all-time counts (schema has no window-filterable relation without
    // an ISO-string cast on createdAt) — same caveat the design audit calls
    // out in §3.3; stated explicitly in the printed output below.
    const [vehicleCounts, fillupCounts, rentalCounts] = await Promise.all([
      prisma.vehicle.groupBy({ by: ['userId'], where: { userId: { in: allUserIds } }, _count: { _all: true } }),
      prisma.fillup.groupBy({ by: ['userId'], where: { userId: { in: allUserIds } }, _count: { _all: true } }),
      prisma.rentalSession.groupBy({ by: ['userId'], where: { userId: { in: allUserIds } }, _count: { _all: true } }),
    ]);
    const vMap = new Map(vehicleCounts.map((r) => [r.userId, r._count._all]));
    const fMap = new Map(fillupCounts.map((r) => [r.userId, r._count._all]));
    const rMap = new Map(rentalCounts.map((r) => [r.userId, r._count._all]));

    interface CohortUser {
      id: string;
      /** User.createdAt — incidental account-age context ONLY. Never used as
       *  the authoritative trial-start timestamp (BLOCKER 1). */
      createdAtMs: number;
      /** The trial-start timestamp actually used for age/maturity bucketing:
       *  for a reconstructed-cohort member this is User.createdAt (unchanged,
       *  historical/observational); for an authoritative-cohort member this
       *  is their earliest trial_started AnalyticsEvent's createdAt. */
      trialStartMs: number;
      counts: UserActivityCounts;
      isProTrial: boolean;
      trialExpiresAt: string | null;
      isReconstructed: boolean;
    }

    // Historical-reconstruction population (FIX 4, unchanged from the prior
    // round): every non-test user created before the authoritative cutoff is
    // a best-effort historical trial-cohort member, keyed on User.createdAt
    // alone — see HISTORICAL_COHORT_LABEL for why isProTrial/trialExpiresAt
    // (which are CLEARED on expiry/conversion) cannot gate this population
    // without silently excluding the very users this reconstruction exists
    // to capture. This population and its construction rule are entirely
    // independent of the authoritative cohort below — the two methodologies
    // are never combined into a single membership list.
    const cohort: CohortUser[] = users.map((u) => {
      const createdMs = new Date(u.createdAt).getTime();
      const isReconstructed = !(args.authoritativeStart != null && createdMs >= args.authoritativeStart.getTime());
      return {
        id: u.id,
        createdAtMs: createdMs,
        trialStartMs: createdMs,
        counts: {
          calculations: (u.calcCount ?? 0) + (u.budgetCalcCount ?? 0),
          vehicles: vMap.get(u.id) ?? 0,
          fillups: fMap.get(u.id) ?? 0,
          rentalSessions: rMap.get(u.id) ?? 0,
          activeDays: Array.isArray(u.activeDays) ? u.activeDays.length : 0,
        },
        isProTrial: u.isProTrial,
        trialExpiresAt: u.trialExpiresAt,
        isReconstructed,
      };
    });
    const reconstructedTrialUsers = cohort.filter((u) => u.isReconstructed);

    // BLOCKER 1 — authoritative cohort: built strictly from
    // authoritativeTrialStartMsByUser (trial_started event, unique-user,
    // earliest-timestamp semantics — computed above from test-account-
    // filtered events, BEFORE this cohort query even ran). User.createdAt
    // is looked up only for incidental account-age context; it is never
    // substituted for the event timestamp.
    const windowUserById = new Map(users.map((u) => [u.id, u]));
    const extraUserById = new Map(extraUsers.map((u) => [u.id, u]));
    const authoritativeTrialUsers: CohortUser[] = [];
    for (const [userId, trialStartMs] of authoritativeTrialStartMsByUser.entries()) {
      const u = windowUserById.get(userId) ?? extraUserById.get(userId);
      if (!u) {
        // trial_started referenced a userId with no resolvable User row
        // (e.g. the account was since deleted). We cannot source activity
        // counts for a nonexistent user, so it cannot enter a user-level
        // cohort — the raw event itself is still visible in EVENT FUNNEL's
        // trial_started row above.
        continue;
      }
      authoritativeTrialUsers.push({
        id: u.id,
        createdAtMs: new Date(u.createdAt).getTime(),
        trialStartMs,
        counts: {
          calculations: (u.calcCount ?? 0) + (u.budgetCalcCount ?? 0),
          vehicles: vMap.get(u.id) ?? 0,
          fillups: fMap.get(u.id) ?? 0,
          rentalSessions: rMap.get(u.id) ?? 0,
          activeDays: Array.isArray(u.activeDays) ? u.activeDays.length : 0,
        },
        isProTrial: u.isProTrial,
        trialExpiresAt: u.trialExpiresAt,
        isReconstructed: false,
      });
    }

    function reportCohortSection(label: string, group: CohortUser[]) {
      print(`--- ${label} (n=${group.length}) ---`);
      if (group.length === 0) {
        print('  (no users in this window/segment)');
        print();
        return;
      }
      print('  OBSERVED TO DATE — this cohort mixes trial ages (including trials < 30 days old);');
      print('  percentages below are not final outcomes. See COHORT MATURITY section for the');
      print('  maturity-segmented MATURED TRIAL -> PAID rate.');
      const unactivated = group.filter((u) => classifyActivation(u.counts) === 'unactivated').length;
      const activated = group.length - unactivated;
      const highlyActivated = group.filter((u) => classifyHighlyActivatedHypothesis(u.counts)).length;
      const returned = group.filter((u) => classifyReturnedAnotherDay(u.counts.activeDays)).length;

      print(`  Trials started (cohort size):    ${group.length}`);
      print(`  Activated (any usage):           ${activated}  (${formatPercent(activated, group.length)} of cohort)`);
      print(`  Unactivated:                     ${unactivated}  (${formatPercent(unactivated, group.length)} of cohort)`);
      print(`  Returned another day (activeDays>=2): ${returned}  (${formatPercent(returned, group.length)} of cohort)`);
      print(`  HIGHLY ACTIVATED [ANALYSIS HYPOTHESIS, not a proven threshold]: ${highlyActivated}  (${formatPercent(highlyActivated, group.length)} of cohort)`);

      const adBuckets: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4+': 0 };
      const calcBuckets: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3-4': 0, '5+': 0 };
      for (const u of group) {
        adBuckets[activeDaysBucket(u.counts.activeDays)]++;
        calcBuckets[calculationBand(u.counts.calculations)]++;
      }
      print(`  activeDays distribution:  0=${adBuckets['0']}  1=${adBuckets['1']}  2=${adBuckets['2']}  3=${adBuckets['3']}  4+=${adBuckets['4+']}`);
      print(`  calculation-count bands:  0=${calcBuckets['0']}  1=${calcBuckets['1']}  2=${calcBuckets['2']}  3-4=${calcBuckets['3-4']}  5+=${calcBuckets['5+']}`);

      // Late-trial eligibility
      const lateEligible = group.filter((u) => {
        const trialExpiresAtMs = toEpochMsOrNull(u.trialExpiresAt);
        return classifyLateTrialEligibility({ isProTrial: u.isProTrial, trialExpiresAtMs, nowMs: end.getTime() }) === 'eligible';
      }).length;
      const lateUnknown = group.filter((u) => {
        const trialExpiresAtMs = toEpochMsOrNull(u.trialExpiresAt);
        return classifyLateTrialEligibility({ isProTrial: u.isProTrial, trialExpiresAtMs, nowMs: end.getTime() }) === 'unknown';
      }).length;
      print(`  Late-trial eligible (WARN_DAYS=${15}, defensible only): ${lateEligible}`);
      print(`  Late-trial eligibility UNKNOWN (timing not reconstructible): ${lateUnknown}`);
      print();
    }

    print('TRIAL / ACTIVATION / RETENTION');
    print('-'.repeat(78));
    if (args.authoritativeStart) {
      print(HISTORICAL_COHORT_LABEL);
      reportCohortSection('Reconstructed cohort (before authoritative-start)', reconstructedTrialUsers);
      print('AUTHORITATIVE EVENT COHORT (trial_started AnalyticsEvent, userId non-null, unique-user,');
      print('earliest-event timestamp, createdAt >= authoritative-start — NOT gated on User.createdAt)');
      reportCohortSection('Authoritative cohort (>= authoritative-start)', authoritativeTrialUsers);
      print(MIXED_METHODOLOGY_LABEL);
      print(`  Combined (informational only, NOT a clean denominator): ${reconstructedTrialUsers.length + authoritativeTrialUsers.length}`);
      print();
    } else {
      print(HISTORICAL_COHORT_LABEL);
      reportCohortSection('Reconstructed cohort (entire window — no --authoritative-start given)', reconstructedTrialUsers);
    }

    // -----------------------------------------------------------------
    // AnalyticsEvent funnel — event counts + unique users
    // -----------------------------------------------------------------
    print('EVENT FUNNEL (unique users; raw event counts shown separately)');
    print('-'.repeat(78));
    // rawEvents/events/byType were already fetched and test-account-filtered
    // above, BEFORE cohort construction, because the authoritative cohort
    // (BLOCKER 1) is derived from the trial_started row in this same query.

    for (const t of FUNNEL_EVENT_TYPES) {
      const rows = byType.get(t) ?? [];
      const { events: evCount, uniqueUsers } = countEventsAndUniqueUsers(
        rows.map((r) => ({ userId: r.userId, createdAt: r.createdAt }))
      );
      print(`  ${t.padEnd(36)} events=${String(evCount).padStart(6)}  unique_users=${String(uniqueUsers).padStart(6)}`);
    }
    print();

    // -----------------------------------------------------------------
    // TC-2A recap metrics
    // -----------------------------------------------------------------
    print('TC-2A RECAP METRICS [OBSERVATIONAL — no randomized holdout exists]');
    print('-'.repeat(78));
    const viewedRows = byType.get('trial_value_recap_viewed') ?? [];
    const clickedRows = byType.get('trial_value_recap_upgrade_clicked') ?? [];
    const viewedAgg = countEventsAndUniqueUsers(viewedRows.map((r) => ({ userId: r.userId, createdAt: r.createdAt })));
    const clickedAgg = countEventsAndUniqueUsers(clickedRows.map((r) => ({ userId: r.userId, createdAt: r.createdAt })));
    print(`  Recap viewed:  events=${viewedAgg.events}  unique_viewers=${viewedAgg.uniqueUsers}`);
    print(`  Recap clicked: events=${clickedAgg.events}  unique_clickers=${clickedAgg.uniqueUsers}`);
    print(`  Unique viewer -> unique clicker rate: ${formatPercent(clickedAgg.uniqueUsers, viewedAgg.uniqueUsers)}` +
      `  (numerator=unique_clickers, denominator=unique_viewers)`);
    if (isSmallSample(viewedAgg.uniqueUsers)) {
      print(`  EARLY SIGNAL — sample too small for product decision (unique viewers < ${SMALL_SAMPLE_THRESHOLD}).`);
    }
    print();

    // -----------------------------------------------------------------
    // TC-2A exposure measurability (FIX 2) — do not overstate exposure.
    // No persisted, timestamped signal proves a user opened the WEB app
    // (vs. native) while the personalized banner was eligible — verified
    // against lib/users.ts (recordActivity()'s 'visit' event fires only from
    // app/api/fillups/route.ts, an action endpoint reachable from native too,
    // and never distinguishes web/native or records "banner was shown"),
    // lib/trialValue.ts (returns only aggregate counts, no visit timestamp),
    // and components/TrialExpiryBanner.tsx (client-only render gate; its
    // trial_value_recap_viewed fire IS the only server-recorded signal, which
    // is the numerator here, not proof of the denominator). So a "late-trial
    // eligible -> recap viewed" ratio is never computed or labeled as an
    // opportunity/exposure rate.
    // -----------------------------------------------------------------
    print('TC-2A EXPOSURE MEASURABILITY');
    print('-'.repeat(78));
    const lateTrialCandidates = [...reconstructedTrialUsers, ...authoritativeTrialUsers].filter((u) => {
      const trialExpiresAtMs = toEpochMsOrNull(u.trialExpiresAt);
      return classifyLateTrialEligibility({ isProTrial: u.isProTrial, trialExpiresAtMs, nowMs: end.getTime() }) === 'eligible';
    });
    print(`  Late-trial users: ${lateTrialCandidates.length}`);
    print(`  Personalized recap viewers: ${viewedAgg.uniqueUsers}`);
    print(`  Personalized recap clickers: ${clickedAgg.uniqueUsers}`);
    print(`  Recap view -> click: ${formatPercent(clickedAgg.uniqueUsers, viewedAgg.uniqueUsers)}`);
    print(`  RECAP OPPORTUNITY RATE: NOT RELIABLY MEASURABLE — reason: "${RECAP_OPPORTUNITY_NOT_MEASURABLE_REASON}"`);
    print();

    // -----------------------------------------------------------------
    // Plan selection / checkout / purchase classification
    // -----------------------------------------------------------------
    print('PLAN SELECTION / CHECKOUT / PURCHASE');
    print('-'.repeat(78));

    const planRows = byType.get('upgrade_plan_selected') ?? [];
    const planByBilling = { monthly: new Set<string>(), lifetime: new Set<string>(), unknown: new Set<string>() };
    for (const r of planRows) {
      if (!r.userId) continue; // upgrade_plan_selected allows anonymous rows; unjoinable, excluded from user-level classification
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const cls = classifyBilling(meta.billing);
      planByBilling[cls].add(r.userId);
    }
    print(`  upgrade_plan_selected unique users by plan (metadata.billing, verified field only):`);
    print(`    monthly=${planByBilling.monthly.size}  lifetime=${planByBilling.lifetime.size}  unknown=${planByBilling.unknown.size}`);

    const webStarters = new Set((byType.get('checkout_started') ?? []).filter((r) => r.userId).map((r) => r.userId as string));
    const nativeStarters = new Set((byType.get('iap_checkout_started') ?? []).filter((r) => r.userId).map((r) => r.userId as string));
    const combinedStarters = new Set([...webStarters, ...nativeStarters]);
    print(`  Web checkout_started unique starters:    ${webStarters.size}`);
    print(`  Native iap_checkout_started unique starters: ${nativeStarters.size}  [client self-report, NOT server-authoritative]`);
    print(`  Combined unique starters (deduplicated):  ${combinedStarters.size}`);

    const purchaseRows = byType.get('purchase_completed') ?? [];
    const purchaseByBilling = { monthly: new Set<string>(), lifetime: new Set<string>(), unknown: new Set<string>() };
    const purchaseByPlatformProvider = new Map<string, Set<string>>();
    for (const r of purchaseRows) {
      if (!r.userId) continue;
      const cls = classifyBilling(r.billing);
      purchaseByBilling[cls].add(r.userId);
      const platform = classifyPlatform(r.originPlatform);
      const provider = r.provider === 'stripe' || r.provider === 'revenuecat' ? r.provider : 'unknown';
      const key = `${provider}/${platform}`;
      const set = purchaseByPlatformProvider.get(key) ?? new Set<string>();
      set.add(r.userId);
      purchaseByPlatformProvider.set(key, set);
    }
    print(`  purchase_completed unique buyers by plan (verified billing column only):`);
    print(`    monthly=${purchaseByBilling.monthly.size}  lifetime=${purchaseByBilling.lifetime.size}  unknown=${purchaseByBilling.unknown.size}`);
    print(`  purchase_completed unique buyers by provider/platform:`);
    for (const [key, set] of [...purchaseByPlatformProvider.entries()].sort()) {
      print(`    ${key.padEnd(24)} unique_buyers=${set.size}`);
    }
    const { events: purchaseEventCount, uniqueUsers: purchaseUniqueBuyers } = countEventsAndUniqueUsers(
      purchaseRows.map((r) => ({ userId: r.userId, createdAt: r.createdAt }))
    );
    print(`  purchase_completed total: events=${purchaseEventCount} (idempotency-keyed; redelivery cannot inflate) unique_buyers=${purchaseUniqueBuyers}`);
    print(`  NOTE: an unattributed "checkout -> purchase" rate (all purchasers / all starters) is` +
      ` intentionally NOT computed here — see CHECKOUT ATTRIBUTION below for the temporally-` +
      `attributed, same-user rates (the only valid checkout-conversion measurement).`);
    print();

    // -----------------------------------------------------------------
    // COHORT MATURITY / right-censoring (FIX 3)
    // -----------------------------------------------------------------
    print('COHORT MATURITY (trial-age segmentation)');
    print('-'.repeat(78));
    const maturityReferenceMs = end.getTime();
    print(`  Reference timestamp: ${end.toISOString()} ` +
      `(basis: ${args.until ? '--until, as given' : 'now — no --until given'})`);
    const allTrialUsers = [...reconstructedTrialUsers, ...authoritativeTrialUsers];
    const maturityBuckets: Record<TrialAgeBucket, CohortUser[]> = { EARLY_IN_FLIGHT: [], LATE_IN_FLIGHT: [], MATURED: [] };
    for (const u of allTrialUsers) {
      // trialStartMs, not createdAtMs: for the authoritative cohort this is
      // the trial_started event timestamp (BLOCKER 1); for the reconstructed
      // cohort it is still User.createdAt, unchanged from the prior round.
      maturityBuckets[classifyTrialAge(u.trialStartMs, maturityReferenceMs)].push(u);
    }
    print(`  EARLY/IN-FLIGHT (0-14 days):   ${maturityBuckets.EARLY_IN_FLIGHT.length}`);
    print(`  LATE/IN-FLIGHT  (15-29 days):  ${maturityBuckets.LATE_IN_FLIGHT.length}`);
    print(`  MATURED         (30+ days):   ${maturityBuckets.MATURED.length}`);

    const purchaserIds = purchaseRows.filter((r) => r.userId).map((r) => r.userId as string);
    const maturedConv = computeMaturedConversion(maturityBuckets.MATURED.map((u) => u.id), purchaserIds);
    print(`  MATURED TRIAL -> PAID: ${formatPercent(maturedConv.numerator, maturedConv.denominator)} ` +
      `(numerator=matured (30+ day) trial users who purchased, denominator=matured (30+ day) trial users, n=${maturedConv.denominator})`);
    print();

    // -----------------------------------------------------------------
    // TC-2A attribution (recap-viewed / clicked -> purchase)
    // -----------------------------------------------------------------
    print('TC-2A ATTRIBUTION (recap -> purchase)');
    print('-'.repeat(78));
    print(`  Window: purchase.createdAt in [source.createdAt, source.createdAt + ${args.attributionWindowLabel}]`);
    print(`  Anchor: each user's EARLIEST trial_value_recap_viewed (or _clicked) in the reporting window.`);
    print(`  A purchase before its source event is NEVER counted (isAttributed() enforces delta >= 0).`);

    const viewedEvts = viewedRows.filter((r) => r.userId).map((r) => ({ userId: r.userId as string, createdAt: r.createdAt }));
    const clickedEvts = clickedRows.filter((r) => r.userId).map((r) => ({ userId: r.userId as string, createdAt: r.createdAt }));
    const purchaseEvts = purchaseRows.filter((r) => r.userId).map((r) => ({ userId: r.userId as string, createdAt: r.createdAt }));

    const viewedAttributed = computeAttributedBuyers(viewedEvts, purchaseEvts, args.attributionWindowMs);
    const clickedAttributed = computeAttributedBuyers(clickedEvts, purchaseEvts, args.attributionWindowMs);

    print(`  Recap-viewed -> purchase (attributed):  ${viewedAttributed.size} / ${viewedAgg.uniqueUsers} viewers ` +
      `(${formatPercent(viewedAttributed.size, viewedAgg.uniqueUsers)})`);
    print(`  Recap-clicked -> purchase (attributed): ${clickedAttributed.size} / ${clickedAgg.uniqueUsers} clickers ` +
      `(${formatPercent(clickedAttributed.size, clickedAgg.uniqueUsers)})`);
    print(`  SCOPE LIMITS: web-only exposure but native-inclusive conversion; no control group; ` +
      `exposure requires non-zero activity (selection bias). See docs/reviews/2026-09-01-tc2b-conversion-measurement-design.md §5.4.`);
    if (isSmallSample(viewedAgg.uniqueUsers)) {
      print(`  EARLY SIGNAL — sample too small for product decision (unique viewers < ${SMALL_SAMPLE_THRESHOLD}).`);
    }
    print();

    // -----------------------------------------------------------------
    // Checkout attribution
    // -----------------------------------------------------------------
    print('CHECKOUT ATTRIBUTION (checkout_started/iap_checkout_started -> purchase)');
    print('-'.repeat(78));
    const checkoutStartedEvts = (byType.get('checkout_started') ?? []).filter((r) => r.userId).map((r) => ({ userId: r.userId as string, createdAt: r.createdAt }));
    const iapStartedEvts = (byType.get('iap_checkout_started') ?? []).filter((r) => r.userId).map((r) => ({ userId: r.userId as string, createdAt: r.createdAt }));
    const webCheckoutAttributed = computeAttributedBuyers(checkoutStartedEvts, purchaseEvts, CHECKOUT_ATTRIBUTION_MS);
    const iapCheckoutAttributed = computeAttributedBuyers(iapStartedEvts, purchaseEvts, CHECKOUT_ATTRIBUTION_MS);
    print(`  Web checkout_started -> purchase:      ${webCheckoutAttributed.size} / ${webStarters.size} ` +
      `(${formatPercent(webCheckoutAttributed.size, webStarters.size)})`);
    print(`  Native iap_checkout_started -> purchase: ${iapCheckoutAttributed.size} / ${nativeStarters.size} ` +
      `(${formatPercent(iapCheckoutAttributed.size, nativeStarters.size)}) [client self-report starter side]`);
    // Combined web+native attributed rate: feed BOTH source-event lists into
    // the SAME computeAttributedBuyers() call. It anchors each user on their
    // EARLIEST source event across the combined list and dedupes by userId,
    // so a user who started both a web and a native checkout is counted once
    // — never as two starters in the numerator or denominator. Denominator is
    // combinedStarters.size, the already-deduplicated starter population.
    const combinedCheckoutAttributed = computeAttributedBuyers(
      [...checkoutStartedEvts, ...iapStartedEvts],
      purchaseEvts,
      CHECKOUT_ATTRIBUTION_MS
    );
    print(`  Combined web+native checkout -> purchase (attributed, deduplicated): ` +
      `${combinedCheckoutAttributed.size} / ${combinedStarters.size} ` +
      `(${formatPercent(combinedCheckoutAttributed.size, combinedStarters.size)})`);
    print();

    // -----------------------------------------------------------------
    // CORE CONVERSION RATES — consolidated section. Every rate here is
    // computed via Set intersection against a specific unique-user
    // population, never raw event counts. Zero denominators always print
    // "N/A" via formatPercent. Never silently combines an authoritative and
    // reconstructed denominator into one "clean" number — a combined figure,
    // when shown, is explicitly labeled MIXED METHODOLOGY / INFORMATIONAL
    // ONLY per MIXED_METHODOLOGY_LABEL's existing convention.
    // -----------------------------------------------------------------
    print('CORE CONVERSION RATES');
    print('-'.repeat(78));

    const purchaserIdSet = new Set(purchaserIds);

    /** TRIAL -> PAID: unique cohort members with a purchase_completed event,
     *  over unique cohort size. Broader/less strict sibling of MATURED TRIAL
     *  -> PAID above — this one includes in-flight (< 30 day) trials, so it
     *  is never a substitute for the maturity-segmented rate. */
    function trialToPaid(group: CohortUser[]): { numerator: number; denominator: number } {
      let numerator = 0;
      for (const u of group) if (purchaserIdSet.has(u.id)) numerator++;
      return { numerator, denominator: group.length };
    }
    function hasInFlightTrial(group: CohortUser[]): boolean {
      return group.some((u) => classifyTrialAge(u.trialStartMs, maturityReferenceMs) !== 'MATURED');
    }
    function printObservedToDateIfInFlight(group: CohortUser[]) {
      if (hasInFlightTrial(group)) {
        print('    OBSERVED TO DATE — cohort includes trials < 30 days old; not a final outcome. ' +
          'See COHORT MATURITY / MATURED TRIAL -> PAID above for the maturity-segmented rate.');
      }
    }

    print('TRIAL -> PAID (broader/less-strict sibling of MATURED TRIAL -> PAID; includes in-flight trials)');
    const reconTrialToPaid = trialToPaid(reconstructedTrialUsers);
    print(`  Reconstructed cohort: ${formatPercent(reconTrialToPaid.numerator, reconTrialToPaid.denominator)} ` +
      `(numerator=reconstructed cohort users with purchase_completed, denominator=reconstructed cohort size, n=${reconTrialToPaid.denominator})`);
    printObservedToDateIfInFlight(reconstructedTrialUsers);
    let authTrialToPaid: { numerator: number; denominator: number } | null = null;
    if (args.authoritativeStart) {
      authTrialToPaid = trialToPaid(authoritativeTrialUsers);
      print(`  Authoritative cohort: ${formatPercent(authTrialToPaid.numerator, authTrialToPaid.denominator)} ` +
        `(numerator=authoritative cohort users with purchase_completed, denominator=authoritative cohort size, n=${authTrialToPaid.denominator})`);
      printObservedToDateIfInFlight(authoritativeTrialUsers);
      print(`  ${MIXED_METHODOLOGY_LABEL}`);
      const combinedNum = authTrialToPaid.numerator + reconTrialToPaid.numerator;
      const combinedDenom = authTrialToPaid.denominator + reconTrialToPaid.denominator;
      print(`  Combined (MIXED METHODOLOGY / INFORMATIONAL ONLY): ${formatPercent(combinedNum, combinedDenom)} (n=${combinedDenom})`);
    } else {
      print('  No --authoritative-start given — only the reconstructed cohort rate above is available.');
    }
    print();

    /** ACTIVATED -> PAID: numerator = unique cohort users who are ACTIVATED
     *  (classifyActivation()) AND have purchase_completed; denominator =
     *  unique ACTIVATED cohort users. */
    print('ACTIVATED -> PAID (classifyActivation() population only)');
    const reconActivated = reconstructedTrialUsers.filter((u) => classifyActivation(u.counts) === 'activated');
    const reconActivatedToPaid = trialToPaid(reconActivated);
    print(`  Reconstructed cohort: ${formatPercent(reconActivatedToPaid.numerator, reconActivatedToPaid.denominator)} ` +
      `(numerator=activated reconstructed users with purchase_completed, denominator=activated reconstructed users, n=${reconActivatedToPaid.denominator})`);
    let authActivatedToPaid: { numerator: number; denominator: number } | null = null;
    if (args.authoritativeStart) {
      const authActivated = authoritativeTrialUsers.filter((u) => classifyActivation(u.counts) === 'activated');
      authActivatedToPaid = trialToPaid(authActivated);
      print(`  Authoritative cohort: ${formatPercent(authActivatedToPaid.numerator, authActivatedToPaid.denominator)} ` +
        `(numerator=activated authoritative users with purchase_completed, denominator=activated authoritative users, n=${authActivatedToPaid.denominator})`);
    }
    print();

    /** HIGHLY ACTIVATED -> PAID: same structure, classifyHighlyActivatedHypothesis()
     *  population. ANALYSIS HYPOTHESIS, not a proven/validated threshold — same
     *  caveat used elsewhere in this report for this classification. */
    print('HIGHLY ACTIVATED -> PAID [ANALYSIS HYPOTHESIS, not a proven threshold]');
    const reconHighlyActivated = reconstructedTrialUsers.filter((u) => classifyHighlyActivatedHypothesis(u.counts));
    const reconHighlyActivatedToPaid = trialToPaid(reconHighlyActivated);
    print(`  Reconstructed cohort: ${formatPercent(reconHighlyActivatedToPaid.numerator, reconHighlyActivatedToPaid.denominator)} ` +
      `(numerator=highly-activated reconstructed users with purchase_completed, denominator=highly-activated reconstructed users, n=${reconHighlyActivatedToPaid.denominator})`);
    let authHighlyActivatedToPaid: { numerator: number; denominator: number } | null = null;
    if (args.authoritativeStart) {
      const authHighlyActivated = authoritativeTrialUsers.filter((u) => classifyHighlyActivatedHypothesis(u.counts));
      authHighlyActivatedToPaid = trialToPaid(authHighlyActivated);
      print(`  Authoritative cohort: ${formatPercent(authHighlyActivatedToPaid.numerator, authHighlyActivatedToPaid.denominator)} ` +
        `(numerator=highly-activated authoritative users with purchase_completed, denominator=highly-activated authoritative users, n=${authHighlyActivatedToPaid.denominator})`);
    }
    print();

    /** PLAN SELECTED -> CHECKOUT: temporally attributed. Source =
     *  upgrade_plan_selected events; destination = deduplicated combined
     *  checkout_started + iap_checkout_started population, mirroring the
     *  SAME union-then-attribute pattern used for "Combined web+native
     *  checkout -> purchase" above (feed both destination event lists into
     *  ONE computeAttributedBuyers() call so a user who both started a web
     *  checkout and an in-app checkout is anchored once, never double
     *  counted). Never `all checkout starters / all plan selectors` — that
     *  would not be temporally attributed. */
    print('PLAN SELECTED -> CHECKOUT (temporally attributed, same-user, within ' +
      `${CHECKOUT_ATTRIBUTION_MS / 86_400_000}d)`);
    const planSelectedEvts = planRows.filter((r) => r.userId).map((r) => ({ userId: r.userId as string, createdAt: r.createdAt }));
    const planSelectedUniqueUsers = new Set(planSelectedEvts.map((e) => e.userId)).size;
    const planToWebCheckout = computeAttributedBuyers(planSelectedEvts, checkoutStartedEvts, CHECKOUT_ATTRIBUTION_MS);
    const planToNativeCheckout = computeAttributedBuyers(planSelectedEvts, iapStartedEvts, CHECKOUT_ATTRIBUTION_MS);
    const planToCombinedCheckout = computeAttributedBuyers(
      planSelectedEvts,
      [...checkoutStartedEvts, ...iapStartedEvts],
      CHECKOUT_ATTRIBUTION_MS
    );
    print(`  Plan selectors (unique users): ${planSelectedUniqueUsers}`);
    print(`  Plan selected -> web checkout_started:      ${planToWebCheckout.size} / ${planSelectedUniqueUsers} ` +
      `(${formatPercent(planToWebCheckout.size, planSelectedUniqueUsers)})`);
    print(`  Plan selected -> native iap_checkout_started: ${planToNativeCheckout.size} / ${planSelectedUniqueUsers} ` +
      `(${formatPercent(planToNativeCheckout.size, planSelectedUniqueUsers)})`);
    print(`  Plan selected -> combined checkout (attributed, deduplicated): ${planToCombinedCheckout.size} / ${planSelectedUniqueUsers} ` +
      `(${formatPercent(planToCombinedCheckout.size, planSelectedUniqueUsers)})`);
    print();

    /** CHECKOUT -> PURCHASE: do not recompute — reference the canonical
     *  attributed web/native/combined metrics from CHECKOUT ATTRIBUTION
     *  above verbatim. */
    print('CHECKOUT -> PURCHASE (see CHECKOUT ATTRIBUTION section above — reproduced here for consolidation)');
    print(`  Web checkout_started -> purchase:      ${webCheckoutAttributed.size} / ${webStarters.size} ` +
      `(${formatPercent(webCheckoutAttributed.size, webStarters.size)})`);
    print(`  Native iap_checkout_started -> purchase: ${iapCheckoutAttributed.size} / ${nativeStarters.size} ` +
      `(${formatPercent(iapCheckoutAttributed.size, nativeStarters.size)})`);
    print(`  Combined web+native checkout -> purchase (attributed, deduplicated): ${combinedCheckoutAttributed.size} / ${combinedStarters.size} ` +
      `(${formatPercent(combinedCheckoutAttributed.size, combinedStarters.size)})`);
    print();

    // -----------------------------------------------------------------
    // Pre/post TC-2A baseline
    // -----------------------------------------------------------------
    print('PRE/POST TC-2A BASELINE — NOT A RANDOMIZED A/B TEST, OBSERVATIONAL ONLY');
    print('-'.repeat(78));
    if (!args.tc2aStart) {
      print('  SKIPPED: --tc2a-start not provided. Pass --tc2a-start=<ISO8601> to enable this section.');
    } else {
      const lateTrialBefore = cohort.filter((u) => {
        const trialExpiresAtMs = toEpochMsOrNull(u.trialExpiresAt);
        const eligible = classifyLateTrialEligibility({ isProTrial: u.isProTrial, trialExpiresAtMs, nowMs: args.tc2aStart!.getTime() });
        return eligible === 'eligible' && new Date(users.find((x) => x.id === u.id)!.createdAt).getTime() < args.tc2aStart!.getTime();
      }).length;
      print(`  Late-trial-eligible users BEFORE TC-2A start: ${lateTrialBefore} [NOT A RANDOMIZED A/B TEST]`);
      print(`  Post-TC-2A unique recap viewers (this window): ${viewedAgg.uniqueUsers} [NOT A RANDOMIZED A/B TEST]`);
      print(`  This is an observational pre/post comparison only. Known confounds: concurrent product changes,`);
      print(`  seasonality/deadline mix, traffic mix, web/native mix drift. See design doc §7.3.`);
    }
    print();

    // -----------------------------------------------------------------
    // $9.99 New Member Offer measurability
    // -----------------------------------------------------------------
    print('$9.99 NEW MEMBER OFFER MEASURABILITY');
    print('-'.repeat(78));
    const newMemberCheckouts = (byType.get('checkout_started') ?? []).filter((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return meta.offerSource === 'new_member';
    });
    const newMemberPurchases = purchaseRows.filter((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return meta.offerSource === 'new_member';
    });
    const nmCheckoutAgg = countEventsAndUniqueUsers(newMemberCheckouts.map((r) => ({ userId: r.userId, createdAt: r.createdAt })));
    const nmPurchaseAgg = countEventsAndUniqueUsers(newMemberPurchases.map((r) => ({ userId: r.userId, createdAt: r.createdAt })));
    print(`  MEASURABLE with existing data: checkout_started/purchase_completed carry metadata.offerSource='new_member'`);
    print(`  (app/api/stripe/checkout/route.ts, app/api/stripe/webhook/route.ts).`);
    print(`  New-member-offer checkout_started: unique_users=${nmCheckoutAgg.uniqueUsers} events=${nmCheckoutAgg.events}`);
    print(`  New-member-offer purchase_completed: unique_users=${nmPurchaseAgg.uniqueUsers} events=${nmPurchaseAgg.events}`);
    print(`  [INFORMATIONAL ONLY, NOT a conversion rate] Raw unattributed new-member checkout/purchase ` +
      `unique-user ratio: ${formatPercent(nmPurchaseAgg.uniqueUsers, nmCheckoutAgg.uniqueUsers)} — this does NOT prove` +
      ` any individual purchaser started from a new-member checkout; see the attributed rate below.`);
    const newMemberCheckoutEvts = newMemberCheckouts.filter((r) => r.userId).map((r) => ({ userId: r.userId as string, createdAt: r.createdAt }));
    const newMemberPurchaseEvts = newMemberPurchases.filter((r) => r.userId).map((r) => ({ userId: r.userId as string, createdAt: r.createdAt }));
    const newMemberAttributed = computeAttributedBuyers(newMemberCheckoutEvts, newMemberPurchaseEvts, CHECKOUT_ATTRIBUTION_MS);
    print(`  New-member-offer checkout -> purchase (attributed, same-user, within ${CHECKOUT_ATTRIBUTION_MS / 86_400_000}d): ` +
      `${newMemberAttributed.size} / ${nmCheckoutAgg.uniqueUsers} (${formatPercent(newMemberAttributed.size, nmCheckoutAgg.uniqueUsers)})`);
    print();

    // -----------------------------------------------------------------
    // Platform breakdown
    // -----------------------------------------------------------------
    print('PLATFORM BREAKDOWN');
    print('-'.repeat(78));
    const signupPlatformCounts = new Map<string, number>();
    for (const u of users) {
      const key = u.signupPlatform ?? 'unknown';
      signupPlatformCounts.set(key, (signupPlatformCounts.get(key) ?? 0) + 1);
    }
    print('  Signup platform (User.signupPlatform, set at signup, never updated after):');
    for (const [k, v] of [...signupPlatformCounts.entries()].sort()) {
      print(`    ${k.padEnd(10)} ${v}`);
    }
    print('  Purchase platform (AnalyticsEvent.originPlatform on purchase_completed — real, verified per event):');
    print('  (see PLAN SELECTION / CHECKOUT / PURCHASE section above, "by provider/platform")');
    print('  NOTE: originPlatform is hardcoded "unknown" on P0C activation events (vehicle_saved,');
    print('  fillup_logged, rental_setup_completed, trial_expired, Google-path signup/trial) — those');
    print('  are not reliably available for platform splitting; only payment events carry a real value.');
    print();

    // -----------------------------------------------------------------
    // Footer
    // -----------------------------------------------------------------
    print('FOOTER');
    print('-'.repeat(78));
    print('  DAY-21/DAY-28 EMAIL ATTRIBUTION: UNAVAILABLE');
    print('  (no UTM/click-tracking infrastructure exists; EmailLog has no clickedAt/openedAt;');
    print('  campaign CTAs carry no tracking param — confirmed against current lib/emailCampaign.ts');
    print('  and app/api/webhooks/ at diagnostic-build time. Not implemented here per task scope.)');
    print();
    print('LEGEND / DENOMINATOR NOTES');
    print('-'.repeat(78));
    print('  All percentages show numerator/denominator inline or in the line above. A zero');
    print('  denominator always prints "N/A", never "0%"/"Infinity"/"NaN". No statistical');
    print('  significance is claimed anywhere in this report.');
    print();
    print('PRODUCTION COHORT QUERY EXECUTION: this run DID execute read-only queries against');
    print('the database at DATABASE_URL. If that value pointed at production, this diagnostic');
    print('read production data (read-only) — it never writes.');
    print('='.repeat(78));

    if (args.json) {
      const jsonOut = {
        window: { start: start.toISOString(), end: end.toISOString() },
        attributionWindowLabel: args.attributionWindowLabel,
        cohorts: {
          reconstructed: summarizeForJson(reconstructedTrialUsers, now),
          authoritative: args.authoritativeStart ? summarizeForJson(authoritativeTrialUsers, now) : null,
          methodology: HISTORICAL_COHORT_LABEL,
        },
        cohortMaturity: {
          referenceTimestamp: end.toISOString(),
          referenceBasis: args.until ? 'until' : 'now',
          earlyInFlight: maturityBuckets.EARLY_IN_FLIGHT.length,
          lateInFlight: maturityBuckets.LATE_IN_FLIGHT.length,
          matured: maturityBuckets.MATURED.length,
          maturedTrialToPaid: maturedConv,
        },
        tc2aExposure: {
          lateTrialUsers: lateTrialCandidates.length,
          recapViewers: viewedAgg.uniqueUsers,
          recapClickers: clickedAgg.uniqueUsers,
          opportunityRateMeasurable: false,
          opportunityRateNotMeasurableReason: RECAP_OPPORTUNITY_NOT_MEASURABLE_REASON,
        },
        events: Object.fromEntries(
          FUNNEL_EVENT_TYPES.map((t) => {
            const rows = byType.get(t) ?? [];
            return [t, countEventsAndUniqueUsers(rows.map((r) => ({ userId: r.userId, createdAt: r.createdAt })))];
          })
        ),
        recap: {
          viewed: viewedAgg,
          clicked: clickedAgg,
          viewedAttributedBuyers: viewedAttributed.size,
          clickedAttributedBuyers: clickedAttributed.size,
          smallSample: isSmallSample(viewedAgg.uniqueUsers),
        },
        checkout: {
          webStarters: webStarters.size,
          nativeStarters: nativeStarters.size,
          combinedStarters: combinedStarters.size,
          webAttributedPurchases: webCheckoutAttributed.size,
          nativeAttributedPurchases: iapCheckoutAttributed.size,
          combinedAttributedPurchases: combinedCheckoutAttributed.size,
        },
        purchases: {
          byBilling: { monthly: purchaseByBilling.monthly.size, lifetime: purchaseByBilling.lifetime.size, unknown: purchaseByBilling.unknown.size },
          totalEvents: purchaseEventCount,
          uniqueBuyers: purchaseUniqueBuyers,
        },
        newMemberOffer: {
          checkoutUniqueUsers: nmCheckoutAgg.uniqueUsers,
          purchaseUniqueUsers: nmPurchaseAgg.uniqueUsers,
          attributedPurchasers: newMemberAttributed.size,
          attributedRateInformationalRawUniqueUserRatioOnly: false,
        },
        coreConversionRates: {
          trialToPaid: {
            reconstructed: reconTrialToPaid,
            authoritative: authTrialToPaid,
            combinedMixedMethodologyInformationalOnly: authTrialToPaid
              ? { numerator: authTrialToPaid.numerator + reconTrialToPaid.numerator, denominator: authTrialToPaid.denominator + reconTrialToPaid.denominator }
              : null,
          },
          activatedToPaid: {
            reconstructed: reconActivatedToPaid,
            authoritative: authActivatedToPaid,
          },
          highlyActivatedToPaid: {
            reconstructed: reconHighlyActivatedToPaid,
            authoritative: authHighlyActivatedToPaid,
          },
          planSelectedToCheckout: {
            planSelectors: planSelectedUniqueUsers,
            web: planToWebCheckout.size,
            native: planToNativeCheckout.size,
            combined: planToCombinedCheckout.size,
          },
          checkoutToPurchase: {
            webStarters: webStarters.size,
            nativeStarters: nativeStarters.size,
            combinedStarters: combinedStarters.size,
            webAttributedPurchases: webCheckoutAttributed.size,
            nativeAttributedPurchases: iapCheckoutAttributed.size,
            combinedAttributedPurchases: combinedCheckoutAttributed.size,
          },
          maturedTrialToPaid: maturedConv,
        },
        emailAttribution: 'UNAVAILABLE',
      };
      console.log(JSON.stringify(jsonOut, null, 2));
    } else {
      console.log(lines.join('\n'));
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

function summarizeForJson(group: { counts: UserActivityCounts; isProTrial: boolean; trialExpiresAt: string | null }[], now: Date) {
  const unactivated = group.filter((u) => classifyActivation(u.counts) === 'unactivated').length;
  const activeDaysDistribution: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4+': 0 };
  for (const u of group) activeDaysDistribution[activeDaysBucket(u.counts.activeDays)]++;
  return {
    cohortSize: group.length,
    activated: group.length - unactivated,
    unactivated,
    highlyActivated: group.filter((u) => classifyHighlyActivatedHypothesis(u.counts)).length,
    returnedAnotherDay: group.filter((u) => classifyReturnedAnotherDay(u.counts.activeDays)).length,
    // Explicit '0' bucket included — activeDaysBucket() never folds a
    // zero-active-day user into the "1" bucket (BLOCKER 2).
    activeDaysDistribution,
  };
}

main().catch((err) => {
  console.error('[conversion_funnel] Query failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

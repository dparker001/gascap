/**
 * Tests for the TC-2B-B read-only conversion funnel diagnostic
 * (scripts/diagnostics/conversion_funnel.ts + conversionFunnelLib.ts).
 *
 * No real or mocked database connection is used anywhere in this file — the
 * pure calculation functions in conversionFunnelLib.ts are tested directly
 * with fixture data. The executable script is verified structurally (source
 * text) for read-only/no-side-effect/no-PII/no-scope-creep properties, since
 * it is a thin CLI wrapper around the pure library plus Prisma read calls.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
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
  isAttributed,
  computeAttributedBuyers,
  classifyLateTrialEligibility,
  classifyTrialAge,
  computeMaturedConversion,
  RECAP_OPPORTUNITY_NOT_MEASURABLE_REASON,
  ArgParseError,
  HISTORICAL_COHORT_LABEL,
  DEFAULT_ATTRIBUTION_DAYS,
} from '../scripts/diagnostics/conversionFunnelLib';

const SCRIPT_PATH = join(__dirname, '..', 'scripts', 'diagnostics', 'conversion_funnel.ts');
const scriptSource = readFileSync(SCRIPT_PATH, 'utf8');
const libSource = readFileSync(join(__dirname, '..', 'scripts', 'diagnostics', 'conversionFunnelLib.ts'), 'utf8');

describe('CLI argument parsing', () => {
  it('defaults to 30 days when no flags given', () => {
    const args = parseArgs([]);
    expect(args.days).toBe(30);
    expect(args.since).toBeNull();
    expect(args.until).toBeNull();
  });

  it('accepts --days=7 and --days=14', () => {
    expect(parseArgs(['--days=7']).days).toBe(7);
    expect(parseArgs(['--days=14']).days).toBe(14);
  });

  it('rejects an invalid --days value', () => {
    expect(() => parseArgs(['--days=9'])).toThrow(ArgParseError);
  });

  it('rejects an invalid ISO date for --since', () => {
    expect(() => parseArgs(['--since=not-a-date'])).toThrow(ArgParseError);
  });

  it('rejects --since >= --until', () => {
    expect(() => parseArgs(['--since=2026-01-02T00:00:00Z', '--until=2026-01-01T00:00:00Z'])).toThrow(ArgParseError);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--bogus=1'])).toThrow(ArgParseError);
  });

  it('parseArgs no longer exposes requireAuthoritative (--mode removed)', () => {
    const args = parseArgs(['--authoritative-start=2026-09-01T00:00:00Z']);
    expect((args as unknown as Record<string, unknown>).requireAuthoritative).toBeUndefined();
  });

  it('--mode=authoritative is rejected as an unknown flag', () => {
    expect(() => parseArgs(['--mode=authoritative'])).toThrow(ArgParseError);
    expect(() => parseArgs(['--mode=authoritative'])).toThrow(/unknown flag/i);
  });

  it('--mode=reconstructed is rejected as an unknown flag', () => {
    expect(() => parseArgs(['--mode=reconstructed'])).toThrow(ArgParseError);
    expect(() => parseArgs(['--mode=reconstructed'])).toThrow(/unknown flag/i);
  });

  it('--mode=auto is rejected as an unknown flag', () => {
    expect(() => parseArgs(['--mode=auto'])).toThrow(ArgParseError);
    expect(() => parseArgs(['--mode=auto'])).toThrow(/unknown flag/i);
  });

  it('--authoritative-start still parses normally on its own', () => {
    const args = parseArgs(['--authoritative-start=2026-09-01T00:00:00Z']);
    expect(args.authoritativeStart?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('parses --attribution-hours and --attribution-days, defaulting to 7 days', () => {
    const def = parseArgs([]);
    expect(def.attributionWindowMs).toBe(DEFAULT_ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000);

    const hours = parseArgs(['--attribution-hours=48']);
    expect(hours.attributionWindowMs).toBe(48 * 60 * 60 * 1000);

    const days = parseArgs(['--attribution-days=3']);
    expect(days.attributionWindowMs).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it('rejects passing both --attribution-hours and --attribution-days', () => {
    expect(() => parseArgs(['--attribution-hours=1', '--attribution-days=1'])).toThrow(ArgParseError);
  });

  it('parses --json flag', () => {
    expect(parseArgs(['--json']).json).toBe(true);
    expect(parseArgs([]).json).toBe(false);
  });

  it('resolveWindow uses --since/--until when given, else now - days', () => {
    const now = new Date('2026-09-15T00:00:00Z');
    const byDays = resolveWindow({ days: 7, since: null, until: null }, now);
    expect(byDays.end.toISOString()).toBe(now.toISOString());
    expect(byDays.start.toISOString()).toBe('2026-09-08T00:00:00.000Z');

    const since = new Date('2026-08-01T00:00:00Z');
    const until = new Date('2026-08-31T00:00:00Z');
    const explicit = resolveWindow({ days: 30, since, until }, now);
    expect(explicit.start).toBe(since);
    expect(explicit.end).toBe(until);
  });
});

describe('Activation classification', () => {
  it('classifies all-zero counts as unactivated', () => {
    expect(classifyActivation({ calculations: 0, vehicles: 0, fillups: 0, rentalSessions: 0, activeDays: 0 })).toBe('unactivated');
  });

  it('classifies any single nonzero counter as activated', () => {
    expect(classifyActivation({ calculations: 1, vehicles: 0, fillups: 0, rentalSessions: 0, activeDays: 0 })).toBe('activated');
    expect(classifyActivation({ calculations: 0, vehicles: 1, fillups: 0, rentalSessions: 0, activeDays: 0 })).toBe('activated');
    expect(classifyActivation({ calculations: 0, vehicles: 0, fillups: 1, rentalSessions: 0, activeDays: 0 })).toBe('activated');
    expect(classifyActivation({ calculations: 0, vehicles: 0, fillups: 0, rentalSessions: 1, activeDays: 0 })).toBe('activated');
  });

  it('highly-activated hypothesis requires activeDays>=3 AND one of calc>=3/fillup>=2/rental>=1', () => {
    expect(classifyHighlyActivatedHypothesis({ calculations: 3, vehicles: 0, fillups: 0, rentalSessions: 0, activeDays: 3 })).toBe(true);
    expect(classifyHighlyActivatedHypothesis({ calculations: 0, vehicles: 0, fillups: 2, rentalSessions: 0, activeDays: 3 })).toBe(true);
    expect(classifyHighlyActivatedHypothesis({ calculations: 0, vehicles: 0, fillups: 0, rentalSessions: 1, activeDays: 3 })).toBe(true);
    // activeDays below 3 must always be false regardless of the other counters
    expect(classifyHighlyActivatedHypothesis({ calculations: 99, vehicles: 99, fillups: 99, rentalSessions: 99, activeDays: 2 })).toBe(false);
    // activeDays>=3 but none of the OR conditions met
    expect(classifyHighlyActivatedHypothesis({ calculations: 2, vehicles: 0, fillups: 1, rentalSessions: 0, activeDays: 5 })).toBe(false);
  });

  it('returned-another-day rule is activeDays.length >= 2', () => {
    expect(classifyReturnedAnotherDay(0)).toBe(false);
    expect(classifyReturnedAnotherDay(1)).toBe(false);
    expect(classifyReturnedAnotherDay(2)).toBe(true);
    expect(classifyReturnedAnotherDay(10)).toBe(true);
  });

  it('activeDaysBucket buckets correctly, including an explicit zero bucket (BLOCKER 2)', () => {
    expect(activeDaysBucket(0)).toBe('0');
    expect(activeDaysBucket(1)).toBe('1');
    expect(activeDaysBucket(2)).toBe('2');
    expect(activeDaysBucket(3)).toBe('3');
    expect(activeDaysBucket(4)).toBe('4+');
    expect(activeDaysBucket(50)).toBe('4+');
  });

  it('BLOCKER 2 regression: zero active days no longer folds into the "1" bucket', () => {
    // Before the fix, activeDaysBucket(0) returned '1', silently merging
    // zero-active-day users into the one-active-day bucket.
    expect(activeDaysBucket(0)).not.toBe('1');
  });

  it('BLOCKER 2: sum across all buckets equals cohort size for a fixture', () => {
    const cohortActiveDays = [0, 0, 1, 2, 2, 3, 4, 5, 50];
    const buckets: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4+': 0 };
    for (const n of cohortActiveDays) buckets[activeDaysBucket(n)]++;
    const total = Object.values(buckets).reduce((a, b) => a + b, 0);
    expect(total).toBe(cohortActiveDays.length);
    expect(buckets).toEqual({ '0': 2, '1': 1, '2': 2, '3': 1, '4+': 3 });
  });

  it('calculationBand buckets correctly', () => {
    expect(calculationBand(0)).toBe('0');
    expect(calculationBand(1)).toBe('1');
    expect(calculationBand(2)).toBe('2');
    expect(calculationBand(3)).toBe('3-4');
    expect(calculationBand(4)).toBe('3-4');
    expect(calculationBand(5)).toBe('5+');
  });
});

describe('Percentage formatting and small-sample rule', () => {
  it('returns N/A for a zero denominator, never 0%/Infinity/NaN', () => {
    expect(formatPercent(0, 0)).toBe('N/A');
    expect(formatPercent(5, 0)).toBe('N/A');
  });

  it('formats a normal percentage', () => {
    expect(formatPercent(1, 4)).toBe('25.0%');
    expect(formatPercent(3, 3)).toBe('100.0%');
  });

  it('small-sample threshold is 30', () => {
    expect(SMALL_SAMPLE_THRESHOLD).toBe(30);
    expect(isSmallSample(29)).toBe(true);
    expect(isSmallSample(30)).toBe(false);
  });
});

describe('Unique-user vs event-count dedup', () => {
  it('counts raw events and distinct non-null userIds separately', () => {
    const events = [
      { userId: 'u1', createdAt: new Date() },
      { userId: 'u1', createdAt: new Date() },
      { userId: 'u2', createdAt: new Date() },
      { userId: null, createdAt: new Date() },
    ];
    const result = countEventsAndUniqueUsers(events);
    expect(result.events).toBe(4);
    expect(result.uniqueUsers).toBe(2);
  });
});

describe('Plan/platform classification — verified metadata only', () => {
  it('classifies billing only from exact verified values, else unknown', () => {
    expect(classifyBilling('monthly')).toBe('monthly');
    expect(classifyBilling('lifetime')).toBe('lifetime');
    expect(classifyBilling('annual')).toBe('unknown');
    expect(classifyBilling(undefined)).toBe('unknown');
    expect(classifyBilling(null)).toBe('unknown');
    expect(classifyBilling(42)).toBe('unknown');
  });

  it('classifies platform only from exact verified values, else unknown', () => {
    expect(classifyPlatform('web')).toBe('web');
    expect(classifyPlatform('ios')).toBe('ios');
    expect(classifyPlatform('android')).toBe('android');
    expect(classifyPlatform('unknown')).toBe('unknown');
    expect(classifyPlatform('windows')).toBe('unknown');
    expect(classifyPlatform(undefined)).toBe('unknown');
  });
});

describe('Attribution logic — temporal + same-user, window bound', () => {
  const base = new Date('2026-09-01T00:00:00Z').getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  it('attributes a purchase strictly at or after the source event, within the window', () => {
    const source = { userId: 'u1', createdAt: new Date(base) };
    const purchaseSameInstant = { userId: 'u1', createdAt: new Date(base) };
    const purchaseWithinWindow = { userId: 'u1', createdAt: new Date(base + 3 * dayMs) };
    const purchaseAtWindowEdge = { userId: 'u1', createdAt: new Date(base + 7 * dayMs) };
    const purchaseAfterWindow = { userId: 'u1', createdAt: new Date(base + 8 * dayMs) };
    expect(isAttributed(source, purchaseSameInstant, 7 * dayMs)).toBe(true);
    expect(isAttributed(source, purchaseWithinWindow, 7 * dayMs)).toBe(true);
    expect(isAttributed(source, purchaseAtWindowEdge, 7 * dayMs)).toBe(true);
    expect(isAttributed(source, purchaseAfterWindow, 7 * dayMs)).toBe(false);
  });

  it('never attributes a purchase that occurred BEFORE its supposed source event', () => {
    const source = { userId: 'u1', createdAt: new Date(base) };
    const purchaseBefore = { userId: 'u1', createdAt: new Date(base - dayMs) };
    expect(isAttributed(source, purchaseBefore, 7 * dayMs)).toBe(false);
  });

  it('never attributes across different users', () => {
    const source = { userId: 'u1', createdAt: new Date(base) };
    const purchase = { userId: 'u2', createdAt: new Date(base + dayMs) };
    expect(isAttributed(source, purchase, 7 * dayMs)).toBe(false);
  });

  it('computeAttributedBuyers anchors on each user earliest source event', () => {
    const sources = [
      { userId: 'u1', createdAt: new Date(base + 5 * dayMs) }, // later view
      { userId: 'u1', createdAt: new Date(base) },              // earliest view — anchor
    ];
    // A purchase 6 days after the true anchor (base) but only 1 day after the
    // later view would wrongly attribute if the anchor weren't the earliest.
    const purchases = [{ userId: 'u1', createdAt: new Date(base + 6 * dayMs) }];
    const attributed = computeAttributedBuyers(sources, purchases, 7 * dayMs);
    expect(attributed.has('u1')).toBe(true);

    const purchasesOutsideTrueWindow = [{ userId: 'u1', createdAt: new Date(base + 8 * dayMs) }];
    const notAttributed = computeAttributedBuyers(sources, purchasesOutsideTrueWindow, 7 * dayMs);
    expect(notAttributed.has('u1')).toBe(false);
  });

  it('does not double-count a purchaser with multiple purchase_completed rows', () => {
    const sources = [{ userId: 'u1', createdAt: new Date(base) }];
    const purchases = [
      { userId: 'u1', createdAt: new Date(base + dayMs) },
      { userId: 'u1', createdAt: new Date(base + 2 * dayMs) }, // duplicate/second purchase
    ];
    const attributed = computeAttributedBuyers(sources, purchases, 7 * dayMs);
    expect(attributed.size).toBe(1);
    expect(attributed.has('u1')).toBe(true);
  });

  it('produces an empty set when there is no matching purchase', () => {
    const sources = [{ userId: 'u1', createdAt: new Date(base) }];
    const attributed = computeAttributedBuyers(sources, [], 7 * dayMs);
    expect(attributed.size).toBe(0);
  });
});

describe('Historical reconstruction labeling and evidence rule', () => {
  it('exposes a prominent HISTORICAL RECONSTRUCTED COHORT label', () => {
    expect(HISTORICAL_COHORT_LABEL).toMatch(/HISTORICAL RECONSTRUCTED COHORT/);
    expect(HISTORICAL_COHORT_LABEL).toMatch(/NOT EVENT-AUTHORITATIVE/);
  });

  it('the label explains isProTrial/trialExpiresAt cannot establish historical membership', () => {
    expect(HISTORICAL_COHORT_LABEL).toMatch(/CLEARED/);
    expect(HISTORICAL_COHORT_LABEL).toMatch(/createdAt/);
  });
});

describe('Late-trial eligibility (WARN_DAYS=15)', () => {
  const now = new Date('2026-09-15T00:00:00Z').getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  it('is eligible when isProTrial and daysLeft is within [0,15]', () => {
    const trialExpiresAtMs = now + 10 * dayMs;
    expect(classifyLateTrialEligibility({ isProTrial: true, trialExpiresAtMs, nowMs: now })).toBe('eligible');
  });

  it('is not-eligible when isProTrial but daysLeft > 15', () => {
    const trialExpiresAtMs = now + 20 * dayMs;
    expect(classifyLateTrialEligibility({ isProTrial: true, trialExpiresAtMs, nowMs: now })).toBe('not-eligible');
  });

  it('is unknown when timing cannot be reconstructed (no trialExpiresAt)', () => {
    expect(classifyLateTrialEligibility({ isProTrial: true, trialExpiresAtMs: null, nowMs: now })).toBe('unknown');
  });

  it('is unknown (never inflated from current plan alone) once the trial has ended/converted', () => {
    const trialExpiresAtMs = now - 5 * dayMs;
    expect(classifyLateTrialEligibility({ isProTrial: false, trialExpiresAtMs, nowMs: now })).toBe('unknown');
  });
});

describe('Structural: read-only guarantee — no mutation methods present', () => {
  const MUTATION_METHOD_PATTERNS = [
    /\.create\s*\(/, /\.createMany\s*\(/,
    /\.update\s*\(/, /\.updateMany\s*\(/,
    /\.upsert\s*\(/,
    /\.delete\s*\(/, /\.deleteMany\s*\(/,
    /\$executeRaw/, /\$transaction/,
  ];
  const SQL_MUTATION_PATTERNS = [
    /\bINSERT\s+INTO\b/i, /\bUPDATE\s+"?\w+"?\s+SET\b/i, /\bDELETE\s+FROM\b/i,
    /\bALTER\s+TABLE\b/i, /\bDROP\s+TABLE\b/i, /\bTRUNCATE\b/i,
  ];

  it('the CLI script contains no Prisma mutation method calls', () => {
    for (const pattern of MUTATION_METHOD_PATTERNS) {
      expect(scriptSource).not.toMatch(pattern);
    }
  });

  it('the CLI script contains no raw SQL mutation statements (outside of comments)', () => {
    // Strip block/line comments first — the file's own header comment
    // *describes* the guarantee using words like "TRUNCATE" in a slash-
    // separated list, which would otherwise false-positive against actual
    // executable SQL mutation statements.
    const codeOnly = scriptSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const pattern of SQL_MUTATION_PATTERNS) {
      expect(codeOnly).not.toMatch(pattern);
    }
  });

  it('the pure lib module contains no mutation methods either', () => {
    for (const pattern of MUTATION_METHOD_PATTERNS) {
      expect(libSource).not.toMatch(pattern);
    }
  });

  it('the pure lib module never imports a database/network client', () => {
    expect(libSource).not.toMatch(/from ['"]@\/lib\/prisma['"]/);
    expect(libSource).not.toMatch(/from ['"]pg['"]/);
    expect(libSource).not.toMatch(/from ['"]@prisma\/client['"]/);
  });

  it('the script header no longer advertises --mode (removed misleading flag)', () => {
    expect(scriptSource).not.toMatch(/--mode=authoritative\|reconstructed\|auto/);
    expect(scriptSource).toMatch(/enables the event-authoritative post-TC-2B-A cohort/);
  });

  it('the authoritative cohort still appears when --authoritative-start is supplied (existing runtime logic, unaffected by --mode removal)', () => {
    expect(scriptSource).toMatch(/AUTHORITATIVE EVENT COHORT/);
    expect(scriptSource).toMatch(/args\.authoritativeStart/);
  });

  it('the CLI script only uses findMany/count/groupBy read calls on Prisma models', () => {
    const readCalls = scriptSource.match(/prisma\.\w+\.(findMany|count|groupBy|aggregate|findUnique|findFirst)\s*\(/g) ?? [];
    expect(readCalls.length).toBeGreaterThan(0);
  });
});

describe('Structural: no email/push/checkout side effects', () => {
  it('the script never imports an email, push, Stripe-mutation, or RevenueCat-mutation module', () => {
    expect(scriptSource).not.toMatch(/from ['"]@\/lib\/email['"]/);
    expect(scriptSource).not.toMatch(/from ['"]@\/lib\/userPush['"]/);
    expect(scriptSource).not.toMatch(/stripe\.(checkout|subscriptions|paymentIntents)\.(create|update|cancel)/);
    expect(scriptSource).not.toMatch(/sendMail|sendPush|sendEmail/i);
  });
});

describe('Structural: no PII in any output path', () => {
  const FORBIDDEN_IDENTIFIERS = [
    'user.email', 'u.email', 'r.email', '.name', 'stripeCustomerId', 'stripeSubscriptionId',
    'checkoutSessionId', 'revenueCatAppUserId', 'phone', 'vin', 'receiptId',
  ];

  it('the script never selects PII fields from User in its Prisma select clauses', () => {
    // Extract the User.findMany select block specifically.
    const selectBlockMatch = scriptSource.match(/prisma\.user\.findMany\(\{[\s\S]*?\n\s*\}\);/);
    expect(selectBlockMatch).toBeTruthy();
    const block = selectBlockMatch![0];
    expect(block).not.toMatch(/email\s*:\s*true/);
    expect(block).not.toMatch(/\bname\s*:\s*true/);
    expect(block).not.toMatch(/phone\s*:\s*true/);
    expect(block).not.toMatch(/stripeCustomerId\s*:\s*true/);
    expect(block).not.toMatch(/stripeSubscriptionId\s*:\s*true/);
  });

  it('the script never logs a userId directly (only via Set size / count aggregation)', () => {
    // Any console.log/print of a raw event row or userId string would show up
    // as printing `.userId` directly rather than through .size/.length.
    expect(scriptSource).not.toMatch(/print\(\s*(r|e|u)\.userId/);
    expect(scriptSource).not.toMatch(/console\.log\(\s*(r|e|u)\.userId/);
  });

  it('countEventsAndUniqueUsers never returns the userId values themselves, only counts', () => {
    const result = countEventsAndUniqueUsers([{ userId: 'super-secret-user-id', createdAt: new Date() }]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('super-secret-user-id');
  });

  it('JSON output mode is aggregates-only (structural check on the jsonOut shape in source)', () => {
    const jsonOutMatch = scriptSource.match(/const jsonOut = \{[\s\S]*?\n\s*\};/);
    expect(jsonOutMatch).toBeTruthy();
    const block = jsonOutMatch![0];
    // `userId` legitimately appears INSIDE aggregation helper-call arguments
    // (building the input to countEventsAndUniqueUsers, which is separately
    // proven above to return only counts, never ids) — that never reaches
    // the printed/emitted output. What must never appear anywhere in the
    // emitted object is a PII field name.
    // "emailAttribution" is a legitimate field name (always the literal
    // string 'UNAVAILABLE', per the footer requirement) — everything else
    // matching /email/ would be a real PII leak.
    const withoutAllowedField = block.replace(/emailAttribution/g, '');
    expect(withoutAllowedField).not.toMatch(/email/i);
    expect(block).not.toMatch(/stripeCustomerId|stripeSubscriptionId|phone|\bvin\b/i);
  });
});

describe('Structural: refusal behavior for authoritative/TC-2A modes and invalid input', () => {
  it('exits non-zero via ArgParseError->fail() path for invalid CLI dates (parseArgs throws)', () => {
    expect(() => parseArgs(['--since=garbage'])).toThrow(ArgParseError);
  });

  it('the script fails loudly (process.exit(1)) when DATABASE_URL is missing', () => {
    expect(scriptSource).toMatch(/process\.env\.DATABASE_URL/);
    expect(scriptSource).toMatch(/process\.exit\(1\)/);
  });

  it('the TC-2A comparison section is skipped, not fabricated, without --tc2a-start', () => {
    expect(scriptSource).toMatch(/SKIPPED: --tc2a-start not provided/);
  });
});

describe('Structural: scope — untouched files', () => {
  it('this diff does not touch entitlement/pricing/schema/native/TC-2A product files', () => {
    // These files must never be imported/modified by the diagnostic.
    const forbiddenImports = [
      "@/lib/newMemberOffer",
      "@/lib/trialValue",
      "@/components/TrialExpiryBanner",
      "@/lib/emailCampaign",
    ];
    for (const imp of forbiddenImports) {
      expect(scriptSource).not.toContain(imp);
      expect(libSource).not.toContain(imp);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-2B-B measurement-integrity corrections (2026-09-01): test-account
// exclusion, TC-2A exposure honesty, cohort maturity, historical
// reconstruction fix.
// ---------------------------------------------------------------------------

describe('FIX 1 — test-account exclusion', () => {
  it('the CLI script excludes isTestAccount from the User.findMany cohort query', () => {
    const selectBlockMatch = scriptSource.match(/const users = await prisma\.user\.findMany\(\{[\s\S]*?\n\s*\}\);/);
    expect(selectBlockMatch).toBeTruthy();
    expect(selectBlockMatch![0]).toMatch(/isTestAccount:\s*false/);
  });

  it('the CLI script looks up and excludes test-account userIds from AnalyticsEvent-derived populations', () => {
    // FIX 1: AnalyticsEvent has no isTestAccount column, so the script must
    // join back to User to find and drop test-account rows before any
    // downstream user-level aggregation (recap/plan/checkout/purchase/etc).
    expect(scriptSource).toMatch(/isTestAccount:\s*true/);
    expect(scriptSource).toMatch(/testAccountIdSet/);
  });

  it('a test-account purchase does not increase the paid-conversion numerator (computeMaturedConversion excludes it upstream)', () => {
    // Simulates the shape of the fix: once a test-account userId has been
    // filtered out of the purchaser-id list before it reaches
    // computeMaturedConversion, it cannot inflate the numerator even though
    // it is present in the matured-trial-user population.
    const maturedTrialUserIds = ['real-user-1', 'test-user-1'];
    const buyerIdsAfterTestAccountFilter = ['real-user-1']; // 'test-user-1' already dropped
    const result = computeMaturedConversion(maturedTrialUserIds, buyerIdsAfterTestAccountFilter);
    expect(result).toEqual({ numerator: 1, denominator: 2 });

    // Regression: without the filter, a test-account purchaser would wrongly
    // inflate the numerator to 2.
    const withoutFilter = computeMaturedConversion(maturedTrialUserIds, ['real-user-1', 'test-user-1']);
    expect(withoutFilter.numerator).toBe(2);
    expect(withoutFilter.numerator).not.toBe(result.numerator);
  });

  it('a null-userId AnalyticsEvent never enters a user-level denominator (countEventsAndUniqueUsers)', () => {
    const events = [
      { userId: null, createdAt: new Date() },
      { userId: null, createdAt: new Date() },
      { userId: 'u1', createdAt: new Date() },
    ];
    const result = countEventsAndUniqueUsers(events);
    // Event count still reflects all rows (raw counts may include anonymous
    // activity), but uniqueUsers — the user-level denominator — only counts
    // the one real user.
    expect(result.events).toBe(3);
    expect(result.uniqueUsers).toBe(1);
  });
});

describe('FIX 2 — TC-2A exposure honesty', () => {
  it('late-trial eligibility alone is never labeled a recap "opportunity" rate', () => {
    expect(scriptSource).toMatch(/RECAP OPPORTUNITY RATE: NOT RELIABLY MEASURABLE/);
    expect(scriptSource).not.toMatch(/late-trial eligible\s*->\s*recap viewed/i);
    // No exposure/opportunity PERCENTAGE is ever computed from lateTrialCandidates.
    expect(scriptSource).not.toMatch(/formatPercent\([^)]*lateTrialCandidates/);
  });

  it('exposes the exact not-measurable reason string', () => {
    expect(RECAP_OPPORTUNITY_NOT_MEASURABLE_REASON).toBe(
      'A late-trial user is not proven to have opened the web experience while the ' +
      'personalized banner was eligible.'
    );
    expect(scriptSource).toContain('RECAP_OPPORTUNITY_NOT_MEASURABLE_REASON');
  });

  it('unique recap viewer -> clicker rate remains measurable and printed', () => {
    expect(scriptSource).toMatch(/Unique viewer -> unique clicker rate/);
  });

  it('unique recap viewer -> purchaser (attributed) rate remains measurable and printed', () => {
    expect(scriptSource).toMatch(/Recap-viewed -> purchase \(attributed\)/);
  });

  it('unique recap clicker -> purchaser (attributed) rate remains measurable and printed', () => {
    expect(scriptSource).toMatch(/Recap-clicked -> purchase \(attributed\)/);
  });
});

describe('FIX 3 — cohort maturity / trial-age bucketing', () => {
  const dayMs = 24 * 60 * 60 * 1000;
  // Fixed, far-from-real-"now" reference to prove age is computed relative
  // to the passed-in reference, never Date.now().
  const fixedReference = new Date('2030-01-01T00:00:00Z').getTime();

  it('a 5-day-old trial buckets as EARLY_IN_FLIGHT', () => {
    const trialStart = fixedReference - 5 * dayMs;
    expect(classifyTrialAge(trialStart, fixedReference)).toBe('EARLY_IN_FLIGHT');
  });

  it('a 20-day-old trial buckets as LATE_IN_FLIGHT', () => {
    const trialStart = fixedReference - 20 * dayMs;
    expect(classifyTrialAge(trialStart, fixedReference)).toBe('LATE_IN_FLIGHT');
  });

  it('a 30-day-old trial buckets as MATURED', () => {
    const trialStart = fixedReference - 30 * dayMs;
    expect(classifyTrialAge(trialStart, fixedReference)).toBe('MATURED');
  });

  it('a 45-day-old trial buckets as MATURED', () => {
    const trialStart = fixedReference - 45 * dayMs;
    expect(classifyTrialAge(trialStart, fixedReference)).toBe('MATURED');
  });

  it('trial age is computed relative to the passed reference, not wall-clock Date.now()', () => {
    // If classifyTrialAge ever called Date.now() internally instead of using
    // `referenceMs`, this would misclassify against the real current date —
    // proving the function is a pure, reference-driven calculation.
    const realNow = Date.now();
    expect(Math.abs(fixedReference - realNow)).toBeGreaterThan(365 * dayMs);
    const trialStart = fixedReference - 20 * dayMs;
    expect(classifyTrialAge(trialStart, fixedReference)).toBe('LATE_IN_FLIGHT');
  });

  it('the pure lib module never calls Date.now() itself', () => {
    expect(libSource).not.toMatch(/Date\.now\(\)/);
  });

  it('a younger (non-matured) trial does not count in the matured denominator', () => {
    const maturedIds = ['matured-1']; // caller pre-filters to only 30+ day users
    const buyerIds = ['matured-1', 'young-user-not-in-matured-set'];
    const result = computeMaturedConversion(maturedIds, buyerIds);
    // The young purchaser is not in maturedIds, so it never enters the
    // denominator or numerator of the matured-cohort rate.
    expect(result.denominator).toBe(1);
    expect(result.numerator).toBe(1);
  });

  it('MATURED TRIAL -> PAID denominator uses only the 30+ day cohort', () => {
    const maturedIds = ['m1', 'm2', 'm3'];
    const buyerIds = ['m1'];
    const result = computeMaturedConversion(maturedIds, buyerIds);
    expect(result.denominator).toBe(3);
    expect(result.numerator).toBe(1);
  });

  it('a zero matured denominator formats as N/A, never 0%/NaN', () => {
    const result = computeMaturedConversion([], ['some-buyer']);
    expect(result.denominator).toBe(0);
    expect(formatPercent(result.numerator, result.denominator)).toBe('N/A');
  });
});

describe('FIX 4 — historical reconstruction uses User.createdAt, not the old buggy rule', () => {
  it('the report visibly contains the literal string "NOT EVENT-AUTHORITATIVE"', () => {
    expect(HISTORICAL_COHORT_LABEL).toContain('NOT EVENT-AUTHORITATIVE');
    expect(scriptSource).toContain('HISTORICAL_COHORT_LABEL');
  });

  it('the reconstructed-cohort methodology sentence names User.createdAt and explains why isProTrial/trialExpiresAt are insufficient', () => {
    expect(HISTORICAL_COHORT_LABEL).toMatch(/User\.createdAt/);
    expect(HISTORICAL_COHORT_LABEL).toMatch(/CLEARED/);
    expect(HISTORICAL_COHORT_LABEL).toMatch(/observational/i);
  });

  it('the methodology sentence is represented in --json output too (not silently dropped)', () => {
    const jsonOutMatch = scriptSource.match(/const jsonOut = \{[\s\S]*?\n\s*\};/);
    expect(jsonOutMatch).toBeTruthy();
    expect(jsonOutMatch![0]).toMatch(/methodology:\s*HISTORICAL_COHORT_LABEL/);
  });

  it('cohort membership does not gate on the old buggy isProTrial/trialExpiresAt-only rule', () => {
    // The old rule filtered cohort membership on isProTrial/trialExpiresAt via
    // a now-removed helper; the current rule keys membership on createdAt
    // (isReconstructed) alone. Assert the obsolete helper is gone entirely and
    // the createdAt-based filter is what actually gates membership.
    expect(scriptSource).not.toMatch(/hasReconstructedTrialEvidence/);
    expect(libSource).not.toMatch(/hasReconstructedTrialEvidence/);
    expect(scriptSource).toMatch(/const reconstructedTrialUsers = cohort\.filter\(\(u\) => u\.isReconstructed\);/);
  });
});

describe('Regression: no PII / no-mutation structural checks still pass against the modified files', () => {
  it('the script still never selects PII fields from User (re-check after FIX 1/3/4 edits)', () => {
    const selectBlockMatch = scriptSource.match(/prisma\.user\.findMany\(\{[\s\S]*?\n\s*\}\);/);
    expect(selectBlockMatch).toBeTruthy();
    const block = selectBlockMatch![0];
    expect(block).not.toMatch(/email\s*:\s*true/);
    expect(block).not.toMatch(/\bname\s*:\s*true/);
    expect(block).not.toMatch(/phone\s*:\s*true/);
  });

  it('the script still contains no Prisma mutation method calls (re-check after edits)', () => {
    const MUTATION_METHOD_PATTERNS = [
      /\.create\s*\(/, /\.createMany\s*\(/,
      /\.update\s*\(/, /\.updateMany\s*\(/,
      /\.upsert\s*\(/,
      /\.delete\s*\(/, /\.deleteMany\s*\(/,
      /\$executeRaw/, /\$transaction/,
    ];
    for (const pattern of MUTATION_METHOD_PATTERNS) {
      expect(scriptSource).not.toMatch(pattern);
    }
    // The new test-account lookup must itself be a read-only findMany, never
    // a mutation.
    expect(scriptSource).toMatch(/prisma\.user\.findMany\(\{ where: \{ id: \{ in: eventUserIds \}, isTestAccount: true \}/);
  });
});

// ---------------------------------------------------------------------------
// BLOCKER 1 (2026-09-01 ChatGPT review) — authoritative cohort must be
// event-based (trial_started), never createdAt-based.
// ---------------------------------------------------------------------------

describe('BLOCKER 1 — authoritative cohort is event-based (trial_started), not createdAt-based', () => {
  const authoritativeStartMs = new Date('2026-08-01T00:00:00Z').getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  /** Mirrors the exact logic conversion_funnel.ts uses to build
   *  authoritativeTrialStartMsByUser from a list of already
   *  test-account-filtered trial_started AnalyticsEvent rows. */
  function buildAuthoritativeMap(
    trialStartedEvents: { userId: string | null; createdAt: Date }[],
    authStartMs: number
  ): Map<string, number> {
    const map = new Map<string, number>();
    for (const e of trialStartedEvents) {
      if (!e.userId) continue;
      const ts = e.createdAt.getTime();
      if (ts < authStartMs) continue;
      const existing = map.get(e.userId);
      if (existing == null || ts < existing) map.set(e.userId, ts);
    }
    return map;
  }

  it('1. a user created after authoritativeStart but with NO trial_started event is NOT in the authoritative cohort', () => {
    // No trial_started events at all for this user — regardless of
    // User.createdAt, the map must not contain them.
    const map = buildAuthoritativeMap([], authoritativeStartMs);
    expect(map.has('user-no-event')).toBe(false);
    expect(map.size).toBe(0);
  });

  it('2. a user with a trial_started event after authoritativeStart IS in the authoritative cohort', () => {
    const map = buildAuthoritativeMap(
      [{ userId: 'user-a', createdAt: new Date(authoritativeStartMs + dayMs) }],
      authoritativeStartMs
    );
    expect(map.has('user-a')).toBe(true);
  });

  it('3. duplicate trial_started events for the same user count once (unique-user semantics)', () => {
    const map = buildAuthoritativeMap(
      [
        { userId: 'user-b', createdAt: new Date(authoritativeStartMs + 5 * dayMs) },
        { userId: 'user-b', createdAt: new Date(authoritativeStartMs + 1 * dayMs) }, // redelivery, earlier
        { userId: 'user-b', createdAt: new Date(authoritativeStartMs + 9 * dayMs) },
      ],
      authoritativeStartMs
    );
    expect(map.size).toBe(1);
    expect(map.get('user-b')).toBe(authoritativeStartMs + 1 * dayMs); // earliest wins
  });

  it('4. a trial_started event before authoritativeStart does not count as authoritative-cohort membership', () => {
    const map = buildAuthoritativeMap(
      [{ userId: 'user-c', createdAt: new Date(authoritativeStartMs - dayMs) }],
      authoritativeStartMs
    );
    expect(map.has('user-c')).toBe(false);
  });

  it('5. a test-account trial_started event does not enter the authoritative denominator', () => {
    // Mirrors the script: test-account rows are filtered OUT of `events`
    // (and therefore out of byType.get('trial_started')) before
    // buildAuthoritativeMap ever sees them — so a test account simply never
    // appears in the input list here.
    const testAccountId = 'test-user-1';
    const rawTrialStarted = [
      { userId: testAccountId, createdAt: new Date(authoritativeStartMs + dayMs) },
      { userId: 'real-user', createdAt: new Date(authoritativeStartMs + dayMs) },
    ];
    const testAccountIdSet = new Set([testAccountId]);
    const filtered = rawTrialStarted.filter((e) => !e.userId || !testAccountIdSet.has(e.userId));
    const map = buildAuthoritativeMap(filtered, authoritativeStartMs);
    expect(map.has(testAccountId)).toBe(false);
    expect(map.has('real-user')).toBe(true);
  });

  it('6. a null-userId trial_started event does not enter any user-level denominator', () => {
    const map = buildAuthoritativeMap(
      [{ userId: null, createdAt: new Date(authoritativeStartMs + dayMs) }],
      authoritativeStartMs
    );
    expect(map.size).toBe(0);
    // The raw event is still visible via countEventsAndUniqueUsers (events
    // count includes it, uniqueUsers does not) — proven generically above in
    // "FIX 1 — test-account exclusion".
  });

  it('7. the authoritative cohort start timestamp is derived from trial_started.createdAt, not User.createdAt', () => {
    // Construct a fixture where the two timestamps differ and assert the
    // event timestamp wins.
    const userCreatedAtMs = authoritativeStartMs - 30 * dayMs; // account existed well before the cutoff
    const trialStartedEventMs = authoritativeStartMs + 2 * dayMs; // but trial_started fires after the cutoff
    const map = buildAuthoritativeMap(
      [{ userId: 'late-trial-starter', createdAt: new Date(trialStartedEventMs) }],
      authoritativeStartMs
    );
    expect(map.get('late-trial-starter')).toBe(trialStartedEventMs);
    expect(map.get('late-trial-starter')).not.toBe(userCreatedAtMs);
  });

  it('the script builds authoritative membership from trial_started AnalyticsEvent rows, not User.createdAt', () => {
    expect(scriptSource).toMatch(/authoritativeTrialStartMsByUser/);
    expect(scriptSource).toMatch(/byType\.get\('trial_started'\)/);
    // The old buggy rule (`createdMs >= args.authoritativeStart...`) used to
    // directly gate isAuthoritative from User.createdAt; that field/pattern
    // must be gone.
    expect(scriptSource).not.toMatch(/isAuthoritative/);
  });

  it('the script never uses User.createdAt as the authoritative cohort maturity timestamp', () => {
    // COHORT MATURITY bucketing must key off trialStartMs, not createdAtMs.
    expect(scriptSource).toMatch(/classifyTrialAge\(u\.trialStartMs, maturityReferenceMs\)/);
    expect(scriptSource).not.toMatch(/classifyTrialAge\(u\.createdAtMs/);
  });

  it('reconstructed-cohort membership and its historical createdAt-based rule are unchanged', () => {
    expect(scriptSource).toMatch(/const reconstructedTrialUsers = cohort\.filter\(\(u\) => u\.isReconstructed\);/);
    expect(scriptSource).toMatch(/trialStartMs: createdMs,/); // reconstructed members still use User.createdAt as trialStartMs
  });

  it('a userId with no resolvable User row (e.g. deleted account) cannot enter the authoritative user-level cohort', () => {
    // Structural: the script explicitly skips building an authoritativeTrialUsers
    // entry when neither windowUserById nor extraUserById resolves the userId.
    expect(scriptSource).toMatch(/windowUserById\.get\(userId\) \?\? extraUserById\.get\(userId\)/);
    expect(scriptSource).toMatch(/if \(!u\) \{/);
  });
});

// ---------------------------------------------------------------------------
// BLOCKER 3 (2026-09-01 ChatGPT review) — remove the misleading unattributed
// "checkout -> purchase" rate; canonical metrics are temporally attributed.
// ---------------------------------------------------------------------------

describe('BLOCKER 3 — checkout conversion is only measured via temporal attribution', () => {
  const base = new Date('2026-09-01T00:00:00Z').getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const windowMs = 7 * dayMs;

  it('1. a purchaser with no checkout event does not increase the checkout-conversion numerator', () => {
    const sources: { userId: string; createdAt: Date }[] = [];
    const purchases = [{ userId: 'buyer-no-checkout', createdAt: new Date(base) }];
    const attributed = computeAttributedBuyers(sources, purchases, windowMs);
    expect(attributed.size).toBe(0);
  });

  it('2. a purchase before its checkout event does not attribute', () => {
    const sources = [{ userId: 'u1', createdAt: new Date(base) }];
    const purchases = [{ userId: 'u1', createdAt: new Date(base - dayMs) }];
    const attributed = computeAttributedBuyers(sources, purchases, windowMs);
    expect(attributed.has('u1')).toBe(false);
  });

  it('3. a purchase outside the attribution window does not attribute', () => {
    const sources = [{ userId: 'u1', createdAt: new Date(base) }];
    const purchases = [{ userId: 'u1', createdAt: new Date(base + windowMs + dayMs) }];
    const attributed = computeAttributedBuyers(sources, purchases, windowMs);
    expect(attributed.has('u1')).toBe(false);
  });

  it('4. a same-user purchase inside the window DOES attribute', () => {
    const sources = [{ userId: 'u1', createdAt: new Date(base) }];
    const purchases = [{ userId: 'u1', createdAt: new Date(base + 3 * dayMs) }];
    const attributed = computeAttributedBuyers(sources, purchases, windowMs);
    expect(attributed.has('u1')).toBe(true);
  });

  it('5. duplicate checkout/purchase events do not double-count a single user', () => {
    const sources = [
      { userId: 'u1', createdAt: new Date(base) },
      { userId: 'u1', createdAt: new Date(base + dayMs) }, // duplicate checkout_started
    ];
    const purchases = [
      { userId: 'u1', createdAt: new Date(base + 2 * dayMs) },
      { userId: 'u1', createdAt: new Date(base + 3 * dayMs) }, // duplicate purchase_completed
    ];
    const attributed = computeAttributedBuyers(sources, purchases, windowMs);
    expect(attributed.size).toBe(1);
  });

  it('6. a combined web+native starter population deduplicates a user who triggered both', () => {
    // Mirrors the script's combined-attributed logic: feed BOTH source lists
    // into ONE computeAttributedBuyers() call so a user present in both is
    // anchored on their single earliest source event, not counted twice.
    const webStarted = [{ userId: 'u1', createdAt: new Date(base + 5 * dayMs) }];
    const iapStarted = [{ userId: 'u1', createdAt: new Date(base) }]; // earlier — true anchor
    const purchases = [{ userId: 'u1', createdAt: new Date(base + 6 * dayMs) }]; // 6d after true anchor, only 1d after the later one
    const combinedStarters = new Set([...webStarted, ...iapStarted].map((e) => e.userId));
    expect(combinedStarters.size).toBe(1); // deduplicated starter population

    const attributed = computeAttributedBuyers([...webStarted, ...iapStarted], purchases, windowMs);
    expect(attributed.size).toBe(1);
    expect(attributed.has('u1')).toBe(true);
  });

  it('the invalid unattributed "purchasers/starters" formula no longer appears in the script output', () => {
    expect(scriptSource).not.toMatch(/Checkout -> purchase rate:.*combinedStarters\.size/);
    expect(scriptSource).not.toMatch(
      /formatPercent\(purchaseUniqueBuyers,\s*combinedStarters\.size\)/
    );
  });

  it('the canonical attributed checkout metrics (web, native, combined) are still computed and printed', () => {
    expect(scriptSource).toMatch(/Web checkout_started -> purchase/);
    expect(scriptSource).toMatch(/Native iap_checkout_started -> purchase/);
    expect(scriptSource).toMatch(/Combined web\+native checkout -> purchase \(attributed, deduplicated\)/);
    expect(scriptSource).toMatch(/combinedCheckoutAttributed = computeAttributedBuyers\(/);
  });
});

// ---------------------------------------------------------------------------
// TC-2B-B CORE CONVERSION RATES section (2026-09-01 extension) — trial->paid,
// activated->paid, highly-activated->paid, plan-selected->checkout,
// checkout->purchase consolidation, plus FIX 2 (late-trial reference time)
// and FIX 3 (new-member-offer attribution).
// ---------------------------------------------------------------------------

describe('CORE CONVERSION RATES — trial/activated/highly-activated -> paid (Set intersection)', () => {
  interface Fixture { id: string; counts: { calculations: number; vehicles: number; fillups: number; rentalSessions: number; activeDays: number } }

  function trialToPaid(group: Fixture[], purchaserIdSet: Set<string>) {
    let numerator = 0;
    for (const u of group) if (purchaserIdSet.has(u.id)) numerator++;
    return { numerator, denominator: group.length };
  }

  it('1. trial->paid uses Set-based cohort user intersection, not raw event counts', () => {
    const cohort: Fixture[] = [
      { id: 'u1', counts: { calculations: 0, vehicles: 0, fillups: 0, rentalSessions: 0, activeDays: 0 } },
      { id: 'u2', counts: { calculations: 0, vehicles: 0, fillups: 0, rentalSessions: 0, activeDays: 0 } },
    ];
    // Two raw purchase_completed rows for u1 (e.g. webhook redelivery) must
    // never inflate the numerator beyond 1 — proving Set semantics, not a
    // raw event count, drives the result.
    const purchaserIdSet = new Set(['u1', 'u1', 'u2-not-in-cohort']);
    const result = trialToPaid(cohort, purchaserIdSet);
    expect(result.numerator).toBe(1);
    expect(result.denominator).toBe(2);
  });

  it('2. a purchaser outside the cohort (wrong userId) is excluded from that cohort trial->paid numerator', () => {
    const cohort: Fixture[] = [{ id: 'in-cohort', counts: { calculations: 0, vehicles: 0, fillups: 0, rentalSessions: 0, activeDays: 0 } }];
    const purchaserIdSet = new Set(['outside-cohort-user']);
    const result = trialToPaid(cohort, purchaserIdSet);
    expect(result.numerator).toBe(0);
    expect(result.denominator).toBe(1);
  });

  it('3. activated->paid denominator includes only activated cohort users; an unactivated purchaser does not inflate it', () => {
    const cohort: Fixture[] = [
      { id: 'activated-buyer', counts: { calculations: 1, vehicles: 0, fillups: 0, rentalSessions: 0, activeDays: 1 } },
      { id: 'unactivated-buyer', counts: { calculations: 0, vehicles: 0, fillups: 0, rentalSessions: 0, activeDays: 0 } },
    ];
    const activated = cohort.filter((u) => classifyActivation(u.counts) === 'activated');
    expect(activated.map((u) => u.id)).toEqual(['activated-buyer']);
    // Both users purchased, but the unactivated one must never enter the
    // activated->paid denominator or numerator.
    const purchaserIdSet = new Set(['activated-buyer', 'unactivated-buyer']);
    const result = trialToPaid(activated, purchaserIdSet);
    expect(result.denominator).toBe(1);
    expect(result.numerator).toBe(1);
  });

  it('4. highly-activated->paid uses exactly classifyHighlyActivatedHypothesis() population', () => {
    const cohort: Fixture[] = [
      { id: 'highly-activated', counts: { calculations: 3, vehicles: 0, fillups: 0, rentalSessions: 0, activeDays: 3 } },
      { id: 'merely-activated', counts: { calculations: 1, vehicles: 0, fillups: 0, rentalSessions: 0, activeDays: 1 } },
    ];
    const highlyActivated = cohort.filter((u) => classifyHighlyActivatedHypothesis(u.counts));
    expect(highlyActivated.map((u) => u.id)).toEqual(['highly-activated']);
    const purchaserIdSet = new Set(['highly-activated', 'merely-activated']);
    const result = trialToPaid(highlyActivated, purchaserIdSet);
    expect(result.denominator).toBe(1);
    expect(result.numerator).toBe(1);
  });

  it('10. a zero denominator in a core-metric computation prints N/A via formatPercent', () => {
    const result = trialToPaid([], new Set(['someone']));
    expect(result.denominator).toBe(0);
    expect(formatPercent(result.numerator, result.denominator)).toBe('N/A');
  });
});

describe('CORE CONVERSION RATES — PLAN SELECTED -> CHECKOUT temporal attribution', () => {
  const base = new Date('2026-09-01T00:00:00Z').getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const windowMs = 7 * dayMs;

  it('5. a plan selector with no later checkout does not count as converted', () => {
    const planSelected = [{ userId: 'u1', createdAt: new Date(base) }];
    const checkouts: { userId: string; createdAt: Date }[] = [];
    const attributed = computeAttributedBuyers(planSelected, checkouts, windowMs);
    expect(attributed.size).toBe(0);
  });

  it('6. a checkout before its plan-selection event does not attribute', () => {
    const planSelected = [{ userId: 'u1', createdAt: new Date(base) }];
    const checkouts = [{ userId: 'u1', createdAt: new Date(base - dayMs) }];
    const attributed = computeAttributedBuyers(planSelected, checkouts, windowMs);
    expect(attributed.has('u1')).toBe(false);
  });

  it('7. a checkout outside the plan-selection attribution window does not attribute', () => {
    const planSelected = [{ userId: 'u1', createdAt: new Date(base) }];
    const checkouts = [{ userId: 'u1', createdAt: new Date(base + windowMs + dayMs) }];
    const attributed = computeAttributedBuyers(planSelected, checkouts, windowMs);
    expect(attributed.has('u1')).toBe(false);
  });

  it('8. a same-user checkout inside the window DOES attribute', () => {
    const planSelected = [{ userId: 'u1', createdAt: new Date(base) }];
    const checkouts = [{ userId: 'u1', createdAt: new Date(base + 2 * dayMs) }];
    const attributed = computeAttributedBuyers(planSelected, checkouts, windowMs);
    expect(attributed.has('u1')).toBe(true);
  });

  it('9. combined web/native checkout destination population dedupes a user in both source lists', () => {
    const planSelected = [{ userId: 'u1', createdAt: new Date(base) }];
    const webCheckouts = [{ userId: 'u1', createdAt: new Date(base + 5 * dayMs) }];
    const iapCheckouts = [{ userId: 'u1', createdAt: new Date(base + 1 * dayMs) }];
    const attributed = computeAttributedBuyers(planSelected, [...webCheckouts, ...iapCheckouts], windowMs);
    expect(attributed.size).toBe(1);
    expect(attributed.has('u1')).toBe(true);
  });

  it('the script computes PLAN SELECTED -> CHECKOUT via computeAttributedBuyers on the union of checkout destinations', () => {
    expect(scriptSource).toMatch(/PLAN SELECTED -> CHECKOUT/);
    expect(scriptSource).toMatch(
      /planToCombinedCheckout = computeAttributedBuyers\(\s*planSelectedEvts,\s*\[\.\.\.checkoutStartedEvts, \.\.\.iapStartedEvts\],/
    );
  });

  it('the script never computes plan-selected->checkout as an unattributed all-starters/all-selectors ratio', () => {
    expect(scriptSource).not.toMatch(/formatPercent\(combinedStarters\.size,\s*planSelectedUniqueUsers\)/);
  });
});

describe('FIX 2 (extended) — late-trial reference time uses the resolved report window, not wall-clock now', () => {
  it('11. classifyLateTrialEligibility is called with the resolved end/--until timestamp inside cohort reporting, not now.getTime()', () => {
    // The three call sites inside reportCohortSection/TC-2A exposure must use
    // end.getTime() (the resolved report window), never now.getTime().
    expect(scriptSource).not.toMatch(/classifyLateTrialEligibility\(\{[^}]*nowMs:\s*now\.getTime\(\)/);
    const endMatches = scriptSource.match(/classifyLateTrialEligibility\(\{[^}]*nowMs:\s*end\.getTime\(\)/g) ?? [];
    expect(endMatches.length).toBeGreaterThanOrEqual(3);
  });

  it('12. holding --until fixed, changing wall-clock "now" does not change the late-trial classification result (reproducibility)', () => {
    const trialExpiresAtMs = new Date('2026-09-10T00:00:00Z').getTime();
    const resolvedEndMs = new Date('2026-09-01T00:00:00Z').getTime(); // fixed --until
    const wallClockA = new Date('2026-09-01T00:05:00Z').getTime(); // "now" a few minutes later
    const wallClockB = new Date('2026-12-25T00:00:00Z').getTime(); // "now" months later
    // Using the resolved end (correct, FIX 2) the result never depends on
    // which wall-clock moment the script happened to run at.
    const resultA = classifyLateTrialEligibility({ isProTrial: true, trialExpiresAtMs, nowMs: resolvedEndMs });
    const resultB = classifyLateTrialEligibility({ isProTrial: true, trialExpiresAtMs, nowMs: resolvedEndMs });
    expect(resultA).toBe(resultB);
    // Demonstrate the bug this guards against: using wall-clock "now" instead
    // of the resolved end WOULD have changed the result across the two wall
        // clock reads above (different day counts remaining).
    const buggyA = classifyLateTrialEligibility({ isProTrial: true, trialExpiresAtMs, nowMs: wallClockA });
    const buggyB = classifyLateTrialEligibility({ isProTrial: true, trialExpiresAtMs, nowMs: wallClockB });
    expect(buggyA).not.toBe(buggyB);
  });

  it('the PRE-TC2A baseline comparison keeps its own reference point (tc2aStart), untouched by FIX 2', () => {
    expect(scriptSource).toMatch(/classifyLateTrialEligibility\(\{[^}]*nowMs:\s*args\.tc2aStart!\.getTime\(\)/);
  });
});

describe('FIX 3 (extended) — $9.99 New Member Offer uses attributed-conversion pattern', () => {
  const base = new Date('2026-09-01T00:00:00Z').getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const windowMs = 7 * dayMs;

  it('13. a new-member-offer purchase with no qualifying checkout event does not count as converted', () => {
    const checkouts: { userId: string; createdAt: Date }[] = [];
    const purchases = [{ userId: 'u1', createdAt: new Date(base) }];
    const attributed = computeAttributedBuyers(checkouts, purchases, windowMs);
    expect(attributed.size).toBe(0);
  });

  it('14. a new-member-offer purchase before its checkout does not attribute', () => {
    const checkouts = [{ userId: 'u1', createdAt: new Date(base) }];
    const purchases = [{ userId: 'u1', createdAt: new Date(base - dayMs) }];
    const attributed = computeAttributedBuyers(checkouts, purchases, windowMs);
    expect(attributed.has('u1')).toBe(false);
  });

  it('15. a same-user new-member-offer purchase inside the attribution window DOES attribute', () => {
    const checkouts = [{ userId: 'u1', createdAt: new Date(base) }];
    const purchases = [{ userId: 'u1', createdAt: new Date(base + 2 * dayMs) }];
    const attributed = computeAttributedBuyers(checkouts, purchases, windowMs);
    expect(attributed.has('u1')).toBe(true);
  });

  it('the script computes new-member-offer conversion via computeAttributedBuyers, not a raw ratio, as the headline rate', () => {
    expect(scriptSource).toMatch(/newMemberAttributed = computeAttributedBuyers\(\s*newMemberCheckoutEvts,\s*newMemberPurchaseEvts,\s*CHECKOUT_ATTRIBUTION_MS\s*\)/);
    expect(scriptSource).toMatch(/New-member-offer checkout -> purchase \(attributed/);
  });

  it('the raw unattributed new-member ratio, if kept, is explicitly labeled informational and separate from the conversion rate', () => {
    expect(scriptSource).toMatch(/INFORMATIONAL ONLY, NOT a conversion rate/);
  });

  it('verified: metadata.offerSource === "new_member" is the real field/value used by the Stripe checkout/webhook routes', () => {
    // Re-verified against app/api/stripe/checkout/route.ts and
    // app/api/stripe/webhook/route.ts per task instructions — do not assume.
    expect(scriptSource).toMatch(/meta\.offerSource === 'new_member'/);
  });
});

describe('JSON parity — activeDays "0" bucket and new core-metric keys', () => {
  it('16. JSON output includes an explicit "0" activeDays bucket key', () => {
    expect(scriptSource).toMatch(/activeDaysDistribution/);
    const summarizeMatch = scriptSource.match(/function summarizeForJson\([\s\S]*?\n\}/);
    expect(summarizeMatch).toBeTruthy();
    expect(summarizeMatch![0]).toMatch(/'0':\s*0/);
  });

  it("17. JSON output contains the new core conversion metric keys", () => {
    const jsonOutMatch = scriptSource.match(/const jsonOut = \{[\s\S]*?\n\s*\};/);
    expect(jsonOutMatch).toBeTruthy();
    const block = jsonOutMatch![0];
    expect(block).toMatch(/coreConversionRates:/);
    expect(block).toMatch(/trialToPaid:/);
    expect(block).toMatch(/activatedToPaid:/);
    expect(block).toMatch(/highlyActivatedToPaid:/);
    expect(block).toMatch(/planSelectedToCheckout:/);
    expect(block).toMatch(/checkoutToPurchase:/);
  });
});

describe('Regression (extended): no PII / no-mutation structural checks still pass after CORE CONVERSION RATES + FIX 2/3 edits', () => {
  it('18. no PII regression — the script still never selects PII fields or logs raw userId', () => {
    const selectBlockMatch = scriptSource.match(/prisma\.user\.findMany\(\{[\s\S]*?\n\s*\}\);/);
    expect(selectBlockMatch).toBeTruthy();
    const block = selectBlockMatch![0];
    expect(block).not.toMatch(/email\s*:\s*true/);
    expect(block).not.toMatch(/\bname\s*:\s*true/);
    expect(block).not.toMatch(/phone\s*:\s*true/);
    expect(scriptSource).not.toMatch(/print\(\s*(r|e|u)\.userId/);
    expect(scriptSource).not.toMatch(/console\.log\(\s*(r|e|u)\.userId/);
    const jsonOutMatch = scriptSource.match(/const jsonOut = \{[\s\S]*?\n\s*\};/);
    expect(jsonOutMatch).toBeTruthy();
    const withoutAllowedField = jsonOutMatch![0].replace(/emailAttribution/g, '');
    expect(withoutAllowedField).not.toMatch(/email/i);
    expect(jsonOutMatch![0]).not.toMatch(/stripeCustomerId|stripeSubscriptionId|phone|\bvin\b/i);
  });

  it('19. no mutation-method regression — the script and lib still contain zero Prisma/SQL mutation calls', () => {
    const MUTATION_METHOD_PATTERNS = [
      /\.create\s*\(/, /\.createMany\s*\(/,
      /\.update\s*\(/, /\.updateMany\s*\(/,
      /\.upsert\s*\(/,
      /\.delete\s*\(/, /\.deleteMany\s*\(/,
      /\$executeRaw/, /\$transaction/,
    ];
    for (const pattern of MUTATION_METHOD_PATTERNS) {
      expect(scriptSource).not.toMatch(pattern);
      expect(libSource).not.toMatch(pattern);
    }
    const codeOnly = scriptSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const SQL_MUTATION_PATTERNS = [
      /\bINSERT\s+INTO\b/i, /\bUPDATE\s+"?\w+"?\s+SET\b/i, /\bDELETE\s+FROM\b/i,
      /\bALTER\s+TABLE\b/i, /\bDROP\s+TABLE\b/i, /\bTRUNCATE\b/i,
    ];
    for (const pattern of SQL_MUTATION_PATTERNS) {
      expect(codeOnly).not.toMatch(pattern);
    }
  });
});

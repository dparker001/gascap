/**
 * Phase 0.5A — engagement baseline math. Expected values are worked out by
 * hand from the fixtures below (not copied from the implementation's output).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  computeBaseline, dayNum, etDate, hasPaidEntitlement, median, rate, userDay0,
  type BaselineInput, type BaselineUser,
} from '@/lib/engagementBaseline';

const NOW = new Date('2026-10-07T16:00:00Z'); // 12:00 PM EDT, ET date 2026-10-07

const user = (id: string, createdAt: string, activeDays: string[], over: Partial<BaselineUser> = {}): BaselineUser => ({
  id, createdAt, activeDays, isProTrial: false, trialExpiresAt: null, ambassadorProForLife: false,
  stripeInterval: null, stripeSubscriptionId: null, revenueCatActive: false, revenueCatInterval: null, ...over,
});

const A = user('A', '2026-09-01T00:00:00.000Z',
  ['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-08', '2026-09-15', '2026-10-01', '2026-10-07'],
  { stripeSubscriptionId: 'sub_1' });                                   // paid; offsets 0,1,3,7,14,30,36
const B = user('B', '2026-09-20T00:00:00.000Z', ['2026-09-20', '2026-09-21'],
  { isProTrial: true, trialExpiresAt: '2026-10-20T00:00:00.000Z' });    // active trial; D1 only
const C = user('C', '2026-10-06T12:00:00.000Z', ['2026-10-06']);        // 1 day old, not back yet
const D = user('D', '2026-10-07T01:00:00.000Z', ['2026-10-07'], { isProTrial: true, trialExpiresAt: '2026-11-06T00:00:00.000Z' });
const E = user('E', '2026-08-01T00:00:00.000Z', []);                    // never came back
const G = user('G', '2026-08-15T00:00:00.000Z', ['2026-08-15'], { ambassadorProForLife: true });

const base = (over: Partial<BaselineInput> = {}): BaselineInput => ({
  now: NOW, users: [A, B, C, D, E, G],
  fillups: {
    A: { count: 3, firstAt: '2026-09-01T10:00:00.000Z' },
    B: { count: 1, firstAt: '2026-09-21T00:00:00.000Z' },
  },
  savedStationUserIds: ['A', 'ghost-not-in-population'],
  vehicleUserIds: ['A', 'B'],
  events: {},
  purchases: [],
  revenueCat: { CANCELLATION: 0, EXPIRATION: 0, REFUND: 0 },
  ...over,
});

describe('date helpers', () => {
  it('etDate follows the America/New_York calendar day, not UTC', () => {
    expect(etDate(new Date('2026-10-07T02:30:00Z'))).toBe('2026-10-06'); // 10:30 PM EDT the day before
    expect(etDate(new Date('2026-10-07T16:00:00Z'))).toBe('2026-10-07');
    expect(etDate(new Date('2026-01-15T04:59:00Z'))).toBe('2026-01-14'); // EST (UTC-5)
  });
  it('dayNum rejects malformed dates', () => {
    expect(dayNum('2026-10-07')).not.toBeNull();
    for (const bad of ['', '2026-10', 'x', '2026-13-40']) expect(dayNum(bad)).toBeNull();
  });
  it('Day 0 is the earlier of signup UTC date and first active day (client tz can be behind UTC)', () => {
    const f = user('F', '2026-09-10T02:00:00.000Z', ['2026-09-09', '2026-09-10']);
    expect(userDay0(f)).toBe(dayNum('2026-09-09'));
    expect(userDay0(user('X', '2026-09-10T02:00:00.000Z', []))).toBe(dayNum('2026-09-10'));
    expect(userDay0(user('Y', 'garbage', []))).toBeNull();
  });
  it('rate / median', () => {
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(0, 0)).toBeNull();
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('population & entitlement', () => {
  const r = computeBaseline(base());
  it('counts signups, active trials and paid correctly', () => {
    expect(r.population.signups).toBe(6);
    expect(r.population.activeTrialNow).toBe(2);   // B, D
    expect(r.population.paidNow).toBe(1);          // A only
  });
  it('Ambassador-for-life and a running trial are NOT paid', () => {
    expect(hasPaidEntitlement(G, NOW)).toBe(false);
    expect(hasPaidEntitlement(B, NOW)).toBe(false);
    expect(hasPaidEntitlement(A, NOW)).toBe(true);
    expect(hasPaidEntitlement(user('L', '2026-01-01', [], { stripeInterval: 'lifetime' }), NOW)).toBe(true);
    expect(hasPaidEntitlement(user('R', '2026-01-01', [], { revenueCatActive: true }), NOW)).toBe(true);
  });
  it('trial definition = union of the event and the trial columns', () => {
    const r2 = computeBaseline(base({
      events: { trial_started: { users: ['A', 'E', 'nobody'], total: 3, firstAt: '2026-08-20T00:00:00.000Z' } },
    }));
    expect(r2.population.trialDefinition).toEqual({ byEvent: 2, byTrialColumns: 2, union: 4 }); // A,E + B,D
    expect(r2.population.trialsEver).toBe(4);
  });
});

describe('retention — hand-computed', () => {
  const r = computeBaseline(base());
  const row = (d: number) => r.retention.find((x) => x.day === d)!;

  it('only matured users are eligible for a given day', () => {
    // today=10-07. Day0: A 09-01 (36d), B 09-20 (17d), C 10-06 (1d), D 10-07 (0d), E 08-01 (67d), G 08-15 (53d)
    expect(row(1).eligible).toBe(5);   // all but D
    expect(row(3).eligible).toBe(4);   // A,B,E,G
    expect(row(7).eligible).toBe(4);
    expect(row(14).eligible).toBe(4);
    expect(row(30).eligible).toBe(3);  // A,E,G (B is 17d)
  });
  it('exact-day activity', () => {
    expect(row(1).exactActive).toBe(2);   // A (09-02), B (09-21)
    expect(row(3).exactActive).toBe(1);   // A (09-04)
    expect(row(7).exactActive).toBe(1);   // A (09-08)
    expect(row(14).exactActive).toBe(1);  // A (09-15)
    expect(row(30).exactActive).toBe(1);  // A (10-01)
  });
  it('on-or-after activity and rates', () => {
    expect(row(1).onOrAfterActive).toBe(2);
    expect(row(1).onOrAfterRate).toBe(40);     // 2 of 5
    expect(row(30).onOrAfterActive).toBe(1);
    expect(row(30).exactRate).toBe(33.3);      // 1 of 3
  });
  it('exact never exceeds on-or-after (monotone sanity)', () => {
    for (const x of r.retention) expect(x.exactActive).toBeLessThanOrEqual(x.onOrAfterActive);
  });
});

describe('DAU / WAU / MAU', () => {
  const r = computeBaseline(base());
  it('uses the ET date as "today"', () => {
    expect(r.todayET).toBe('2026-10-07');
    expect(r.activity.dauToday).toBe(2);       // A, D
    expect(r.activity.dauYesterday).toBe(1);   // C
  });
  it('windows are rolling distinct users', () => {
    expect(r.activity.wau7d).toBe(3);          // A, C, D  (10-01 is 6 days back -> A already counted)
    expect(r.activity.mau30d).toBe(4);         // + B (09-21 is 16d back)
    expect(r.activity.dauSeries).toHaveLength(14);
    expect(r.activity.dauSeries[13]).toEqual({ date: '2026-10-07', users: 2 });
  });
  it('at midnight ET boundary "today" does not jump ahead to the UTC date', () => {
    const late = computeBaseline(base({ now: new Date('2026-10-08T02:00:00Z') })); // 10:00 PM EDT 10-07
    expect(late.todayET).toBe('2026-10-07');
    expect(late.activity.dauToday).toBe(2);
  });
});

describe('fuel actions', () => {
  const r = computeBaseline(base());
  it('first/second fill-up users, rates and volume', () => {
    expect(r.fuelActions.usersWithFirstFillup).toBe(2);
    expect(r.fuelActions.usersWithSecondFillup).toBe(1);
    expect(r.fuelActions.firstFillupRate).toBe(33.3);
    expect(r.fuelActions.totalFillups).toBe(4);
    expect(r.fuelActions.fillupsPerSignup).toBe(0.67);
    expect(r.fuelActions.fillupsPerActiveFuelUser).toBe(2);
  });
  it('median hours to first fill-up (A: 10h, B: 24h)', () => {
    expect(r.fuelActions.medianHoursToFirstFillup).toBe(17);
  });
  it('ignores users outside the population (e.g. test/admin accounts)', () => {
    expect(r.fuelActions.usersWithSavedStation).toBe(1);   // "ghost" is not a counted user
    expect(r.fuelActions.usersWithVehicle).toBe(2);
  });
});

describe('funnel', () => {
  const r = computeBaseline(base());
  it('active-step counts are monotonically non-increasing from Signups', () => {
    const active = r.funnel.filter((s) => s.step.startsWith('Active on Day')).map((s) => s.users as number);
    expect(active).toEqual([2, 1, 1, 1, 1]);
    const all = [r.funnel[0].users as number, ...active];
    for (let i = 1; i < all.length; i++) expect(all[i]).toBeLessThanOrEqual(all[i - 1]);
  });
  it('"Viewed savings" is reported as untracked — null, never a made-up number', () => {
    const s = r.funnel.find((x) => x.step === 'Viewed savings')!;
    expect(s.users).toBeNull();
    expect(s.note).toMatch(/not tracked/i);
  });
});

describe('conversion, paywall, cancellation', () => {
  const r = computeBaseline(base({
    events: {
      trial_started:      { users: ['A', 'B', 'D', 'E'], total: 4, firstAt: '2026-08-20T00:00:00.000Z' },
      paywall_viewed:     { users: ['B', 'E', 'ghost'], total: 5, firstAt: '2026-09-01T00:00:00.000Z' },
      purchase_completed: { users: ['A'], total: 1, firstAt: '2026-09-05T00:00:00.000Z' },
      trial_expired:      { users: ['E'], total: 1, firstAt: '2026-09-06T00:00:00.000Z' },
    },
    purchases: [
      { userId: 'A', at: '2026-09-11T00:00:00.000Z', provider: 'stripe', billing: 'monthly' },
      { userId: 'ghost', at: '2026-09-11T00:00:00.000Z', provider: 'stripe', billing: 'lifetime' },
    ],
    revenueCat: { CANCELLATION: 2, EXPIRATION: 1, REFUND: 0 },
  }));

  it('trials currently paid = trial population holding a paid entitlement NOW (current status, not historical conversion)', () => {
    expect(r.conversion.trialsCurrentlyPaid).toEqual({ trials: 4, paidNow: 1, rate: 25 }); // event users A,B,D,E ∪ trial columns B,D = {A,B,D,E}
  });
  it('purchase events: only in-population users, split by provider:billing, median days to pay', () => {
    expect(r.conversion.purchaseEventUsers).toBe(1);
    expect(r.conversion.purchasesByProviderBilling).toEqual({ 'stripe:monthly': 1 });
    expect(r.conversion.medianDaysSignupToFirstPurchase).toBe(10);   // 09-01 -> 09-11
    expect(r.conversion.trialToPurchaseEvent.eventsBeganAt).toBe('2026-09-05T00:00:00.000Z');
  });
  it('paywall exposure excludes out-of-population users but keeps total volume; marks client vs server trust', () => {
    expect(r.paywall.paywall_viewed).toMatchObject({ users: 2, total: 5, trust: 'client' });
    expect(r.paywall.purchase_completed.trust).toBe('server');
    expect(r.paywall.upgrade_plan_selected).toMatchObject({ users: 0, total: 0, firstAt: null }); // no data != fabricated
  });
  it('cancellation: RevenueCat counts reported, Stripe explicitly not recorded', () => {
    expect(r.cancellation.revenueCat).toEqual({ CANCELLATION: 2, EXPIRATION: 1, REFUND: 0 });
    expect(r.cancellation.stripe).toBeNull();
  });
});

describe('conversion terminology (PR #65 review correction)', () => {
  // H: started a trial, bought, later cancelled -> no paid entitlement NOW.
  const H = user('H', '2026-08-10T00:00:00.000Z', ['2026-08-10']);
  const r = computeBaseline(base({
    users: [A, H],
    events: {
      trial_started:      { users: ['A', 'H'], total: 2, firstAt: '2026-08-01T00:00:00.000Z' },
      purchase_completed: { users: ['A', 'H'], total: 2, firstAt: '2026-08-12T00:00:00.000Z' },
    },
    purchases: [
      { userId: 'A', at: '2026-09-05T00:00:00.000Z', provider: 'stripe', billing: 'monthly' },
      { userId: 'H', at: '2026-08-12T00:00:00.000Z', provider: 'stripe', billing: 'monthly' },
    ],
  }));

  it('a user who converted then cancelled is NOT in "trials currently paid" but IS in the purchase-event metric', () => {
    expect(r.conversion.trialsCurrentlyPaid).toEqual({ trials: 2, paidNow: 1, rate: 50 });
    expect(r.conversion.trialToPurchaseEvent).toMatchObject({ trials: 2, users: 2, rate: 100 });
  });

  it('the report no longer exposes a field named as historical trial->paid conversion', () => {
    expect(r.conversion).not.toHaveProperty('trialToPaid');
    expect(r.conversion).toHaveProperty('trialsCurrentlyPaid');
    expect(r.conversion).toHaveProperty('trialToPurchaseEvent');
  });

  it('definitions state the current-status semantics and that purchase-event conversion is directional', () => {
    const text = [...r.definitions, ...r.dataQuality].join(' ');
    expect(text).toMatch(/Trials currently paid .*NOW/);
    expect(text).toMatch(/converted and later cancelled is NOT counted/);
    expect(text).toMatch(/not historical or lifetime/);
    expect(text).toMatch(/directional, not definitive/);
    expect(text).toMatch(/RevenueCat purchase_completed is production-only/);
    expect(text).toMatch(/Stripe purchase_completed is NOT filtered for test mode/);
    expect(text).toMatch(/Test accounts are excluded/);
  });

  it('admin panel labels the metric as current status and flags the purchase-event metric as directional', () => {
    const src = readFileSync(path.join(__dirname, '..', 'components/admin/EngagementBaselinePanel.tsx'), 'utf8');
    expect(src).not.toMatch(/label="Trial → paid"/);
    expect(src).toMatch(/label="Trials currently paid"/);
    expect(src).toMatch(/not lifetime conversion/);
    expect(src).toMatch(/directional, not definitive/);
    expect(src).toMatch(/not test-mode filtered/);
  });
});

describe('degenerate input', () => {
  it('empty population: zeros and nulls, no NaN/Infinity anywhere', () => {
    const r = computeBaseline(base({ users: [], fillups: {}, savedStationUserIds: [], vehicleUserIds: [] }));
    expect(r.population.signups).toBe(0);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
    expect(r.retention.every((x) => x.eligible === 0 && x.exactRate === null)).toBe(true);
    expect(r.fuelActions.fillupsPerSignup).toBeNull();
  });
  it('truncation is surfaced, not hidden', () => {
    const r = computeBaseline(base({ truncated: true }));
    expect(r.truncated).toBe(true);
    expect(r.dataQuality.join(' ')).toMatch(/lower bounds/);
  });
  it('ships its definitions and data-quality caveats with the numbers', () => {
    const r = computeBaseline(base());
    expect(r.definitions.length).toBeGreaterThan(4);
    expect(r.dataQuality.join(' ')).toMatch(/Visits are not events/);
    expect(r.dataQuality.join(' ')).toMatch(/Stripe purchase_completed is NOT filtered for test mode/);
  });
});

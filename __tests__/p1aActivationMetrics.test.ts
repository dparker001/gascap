/**
 * Phase 1 P1-A — activation metrics: window boundaries, distinct local dates,
 * qualifying universe, exclusions, and that the Phase 0.5 baseline is intact.
 */
import { describe, it, expect } from 'vitest';
import {
  computeActivation, isQualifyingFuelAction, localDateOf,
  type FuelActionRecord, type ActivationUser,
} from '../lib/activationMetrics';
import { computeBaseline } from '../lib/engagementBaseline';

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T15:00:00Z');           // signup instant
const NOW = new Date(T0 + 100 * DAY);                    // everyone is matured
const iso = (ms: number) => new Date(ms).toISOString();

const user = (over: Partial<ActivationUser> = {}): ActivationUser => ({ id: 'u1', createdAt: iso(T0), ...over });
const rec = (over: Partial<FuelActionRecord> = {}): FuelActionRecord => ({
  userId: 'u1', source: 'personal', createdAt: iso(T0 + 1 * DAY),
  gallons: 10, pricePerGallon: 3.5, totalCost: 35, ...over,
});
const run = (users: ActivationUser[], fuelActions: FuelActionRecord[], vehicleUserIds: string[] = []) =>
  computeActivation({ now: NOW, users, fuelActions, vehicleUserIds });

describe('first valid fuel action <= 14 days', () => {
  it('counts an action exactly 14 days after signup (inclusive)', () => {
    expect(run([user()], [rec({ createdAt: iso(T0 + 14 * DAY) })]).firstAction14d.users).toBe(1);
  });
  it('does not count an action 1 ms past 14 days', () => {
    expect(run([user()], [rec({ createdAt: iso(T0 + 14 * DAY + 1) })]).firstAction14d.users).toBe(0);
  });
  it('does not count an action logged before signup', () => {
    expect(run([user()], [rec({ createdAt: iso(T0 - 1000) })]).firstAction14d.users).toBe(0);
  });
  it('uses logged-at, so back-dating a fill-up date changes nothing', () => {
    // A record has no user-entered date in this shape: only createdAt is read.
    expect(run([user()], [rec({ createdAt: iso(T0 + 20 * DAY) })]).firstAction14d.users).toBe(0);
  });
});

describe('Activated: two actions within 30 days on distinct local dates', () => {
  it('activates with two actions on different dates, second exactly at 30 days', () => {
    const r = run([user()], [rec({ createdAt: iso(T0 + 1 * DAY) }), rec({ createdAt: iso(T0 + 30 * DAY) })]);
    expect(r.activated30d.users).toBe(1);
  });
  it('does not activate when the second action is 1 ms past 30 days', () => {
    const r = run([user()], [rec({ createdAt: iso(T0 + 1 * DAY) }), rec({ createdAt: iso(T0 + 30 * DAY + 1) })]);
    expect(r.activated30d.users).toBe(0);
  });
  it('does not activate on two actions the same local date', () => {
    const r = run([user()], [rec({ createdAt: iso(T0 + DAY) }), rec({ createdAt: iso(T0 + DAY + 3_600_000) })]);
    expect(r.activated30d.users).toBe(0);
    expect(r.firstAction14d.users).toBe(1);
  });
  it('uses the local (America/New_York) date, not the UTC date', () => {
    // 2026-02-10 03:00Z and 2026-02-10 20:00Z are the SAME UTC date but
    // different ET dates (Feb 9 22:00 vs Feb 10 15:00).
    const a = Date.parse('2026-02-10T03:00:00Z'), b = Date.parse('2026-02-10T20:00:00Z');
    expect(localDateOf(iso(a))).toBe('2026-02-09');
    expect(localDateOf(iso(b))).toBe('2026-02-10');
    const r = run([user({ createdAt: '2026-02-09T00:00:00Z' })], [rec({ createdAt: iso(a) }), rec({ createdAt: iso(b) })]);
    expect(r.activated30d.users).toBe(1);
  });
  it('and the inverse: different UTC dates but the same ET date is NOT distinct', () => {
    const a = Date.parse('2026-02-10T20:00:00Z'), b = Date.parse('2026-02-11T03:00:00Z'); // both Feb 10 in ET
    expect(localDateOf(iso(a))).toBe(localDateOf(iso(b)));
    expect(run([user({ createdAt: '2026-02-09T00:00:00Z' })], [rec({ createdAt: iso(a) }), rec({ createdAt: iso(b) })]).activated30d.users).toBe(0);
  });
  it('honours a per-user timezone when one is provided', () => {
    const a = Date.parse('2026-02-10T20:00:00Z'), b = Date.parse('2026-02-11T03:00:00Z');
    const r = run([user({ timeZone: 'UTC', createdAt: '2026-02-09T00:00:00Z' })], [rec({ createdAt: iso(a) }), rec({ createdAt: iso(b) })]);
    expect(r.activated30d.users).toBe(1);
  });
});

describe('qualifying universe', () => {
  it('counts personal, rental and gig gallon records', () => {
    const r = run([user()], [
      rec({ source: 'personal', createdAt: iso(T0 + 1 * DAY) }),
      rec({ source: 'rental',   createdAt: iso(T0 + 2 * DAY) }),
      rec({ source: 'gig',      createdAt: iso(T0 + 3 * DAY), energyUnit: 'gal' }),
    ]);
    expect(r.activated30d.users).toBe(1);
    expect(r.firstActionBySource14d).toEqual({ personal: 1, rental: 0, gig: 0 });
  });
  it('excludes EV / kWh records (never mixed with gallons)', () => {
    const r = run([user()], [
      rec({ source: 'gig', energyUnit: 'kwh', createdAt: iso(T0 + 1 * DAY) }),
      rec({ source: 'gig', energyUnit: 'kwh', createdAt: iso(T0 + 2 * DAY) }),
    ]);
    expect(r.firstAction14d.users).toBe(0);
    expect(r.activated30d.users).toBe(0);
  });
  it('an EV record does not combine with a gallon record to activate', () => {
    const r = run([user()], [
      rec({ createdAt: iso(T0 + 1 * DAY) }),
      rec({ source: 'gig', energyUnit: 'kwh', createdAt: iso(T0 + 2 * DAY) }),
    ]);
    expect(r.firstAction14d.users).toBe(1);
    expect(r.activated30d.users).toBe(0);
  });
  it('rejects invalid / implausible records', () => {
    expect(isQualifyingFuelAction(rec({ gallons: 0 }))).toBe(false);
    expect(isQualifyingFuelAction(rec({ gallons: -1 }))).toBe(false);
    expect(isQualifyingFuelAction(rec({ totalCost: 0 }))).toBe(false);
    expect(isQualifyingFuelAction(rec({ pricePerGallon: 0.1 }))).toBe(false);
    expect(isQualifyingFuelAction(rec({ pricePerGallon: 99 }))).toBe(false);
    expect(isQualifyingFuelAction(rec({ gallons: 5000 }))).toBe(false);
    expect(isQualifyingFuelAction(rec({ gallons: NaN }))).toBe(false);
    expect(isQualifyingFuelAction(rec())).toBe(true);
  });
});

describe('population exclusions', () => {
  it('excludes test and admin accounts from cohort and numerators', () => {
    const users = [user({ id: 'real' }), user({ id: 't', isTestAccount: true }), user({ id: 'a', role: 'admin' })];
    const acts = ['real', 't', 'a'].flatMap((id) => [
      rec({ userId: id, createdAt: iso(T0 + DAY) }), rec({ userId: id, createdAt: iso(T0 + 2 * DAY) }),
    ]);
    const r = run(users, acts);
    expect(r.cohort.eligibleSignups).toBe(1);
    expect(r.activated30d).toMatchObject({ users: 1, eligible: 1 });
  });
  it('ignores records for users outside the population', () => {
    const r = run([user()], [rec({ userId: 'ghost' })]);
    expect(r.firstAction14d.users).toBe(0);
  });
});

describe('maturity and rates', () => {
  it('keeps users still inside their window out of the denominator', () => {
    const young = user({ id: 'y', createdAt: iso(NOW.getTime() - 5 * DAY) });
    const r = run([user(), young], [rec()]);
    expect(r.cohort).toMatchObject({ eligibleSignups: 2, matured14: 1, pending14: 1, matured30: 1, pending30: 1 });
    expect(r.firstAction14d).toEqual({ users: 1, eligible: 1, rate: 100 });
  });
  it('reports null (not 0%) when nobody is matured', () => {
    const r = computeActivation({ now: new Date(T0 + DAY), users: [user()], fuelActions: [], vehicleUserIds: [] });
    expect(r.firstAction14d.rate).toBeNull();
    expect(r.activated30d.rate).toBeNull();
  });
  it('computes vehicle -> first action and first action -> Activated conversions', () => {
    const users = [user({ id: 'a' }), user({ id: 'b' }), user({ id: 'c' })];
    const acts = [
      rec({ userId: 'a', createdAt: iso(T0 + DAY) }), rec({ userId: 'a', createdAt: iso(T0 + 5 * DAY) }),
      rec({ userId: 'b', createdAt: iso(T0 + 2 * DAY) }),
    ];
    const r = run(users, acts, ['a', 'b']);
    expect(r.vehicleToFirstAction14d).toMatchObject({ users: 2, eligible: 2, rate: 100 });
    expect(r.firstActionToActivated30d).toMatchObject({ users: 1, eligible: 2, rate: 50 });
  });
  it('personal second-fill diagnostic ignores rental/gig', () => {
    const r = run([user()], [
      rec({ source: 'personal', createdAt: iso(T0 + DAY) }),
      rec({ source: 'rental',   createdAt: iso(T0 + 3 * DAY) }),
    ]);
    expect(r.activated30d.users).toBe(1);
    expect(r.personalSecondFill30d.users).toBe(0);
  });
});

describe('existing Phase 0.5 baseline is intact', () => {
  it('computeBaseline still returns its report shape and does not depend on activation', () => {
    const rep = computeBaseline({
      now: NOW,
      users: [{
        id: 'u1', createdAt: iso(T0), activeDays: ['2026-01-01'], isProTrial: false, trialExpiresAt: null,
        ambassadorProForLife: false, stripeInterval: null, stripeSubscriptionId: null,
        revenueCatActive: false, revenueCatInterval: null,
      }],
      fillups: { u1: { count: 2, firstAt: iso(T0 + DAY) } },
      savedStationUserIds: [], vehicleUserIds: ['u1'], events: {}, purchases: [],
      revenueCat: { CANCELLATION: 0, EXPIRATION: 0, REFUND: 0 },
    });
    expect(rep.population.signups).toBe(1);
    expect(rep.fuelActions.usersWithSecondFillup).toBe(1);
    expect(rep.retention.map((r) => r.day)).toEqual([1, 3, 7, 14, 30]);
    expect((rep as unknown as Record<string, unknown>).activation).toBeUndefined();
  });
});

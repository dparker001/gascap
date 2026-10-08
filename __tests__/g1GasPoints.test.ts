/**
 * Gamification G1 — GasPoints ledger, Daily Fuel Check, weekly mission, levels,
 * fuel/vehicle/station awards, separation from existing systems, admin metrics,
 * and UI/copy contracts.
 *
 * DB behaviour runs against an in-memory fake of the three prisma calls the
 * module uses; the fake enforces the same unique idempotencyKey the real table does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { Prisma } from '../lib/generated/prisma/client';

// ── in-memory prisma ────────────────────────────────────────────────────────
interface Row { id: string; userId: string; action: string; points: number; idempotencyKey: string; sourceRef: string | null }
const state = {
  ledger: [] as Row[],
  users: new Map<string, { role: string; isTestAccount: boolean; streak: number }>(),
};
function dupErr() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
}
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => state.users.get(where.id) ?? null,
    },
    gasPointLedger: {
      create: async ({ data }: { data: Row }) => {
        if (!state.users.has(data.userId)) throw new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'test' });
        if (state.ledger.some((r) => r.idempotencyKey === data.idempotencyKey)) throw dupErr();
        state.ledger.push({ ...data });
        return { id: data.id };
      },
      aggregate: async ({ where }: { where: { userId: string } }) => ({
        _sum: { points: state.ledger.filter((r) => r.userId === where.userId).reduce((s, r) => s + r.points, 0) || null },
      }),
      findMany: async ({ where }: { where: { userId: string; action: string; sourceRef: { in: string[] } } }) =>
        state.ledger.filter((r) => r.userId === where.userId && r.action === where.action && r.sourceRef && where.sourceRef.in.includes(r.sourceRef))
          .map((r) => ({ sourceRef: r.sourceRef })),
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
        state.ledger.find((r) => r.idempotencyKey === where.idempotencyKey) ? { id: 'x' } : null,
    },
  },
}));

import {
  awardOnce, getBalance, getStatus, completeDailyCheck, awardFirstVehicle, awardFirstSavedStation,
  awardFuelActionIfQualifying, qualifiesForFuelPoints,
} from '../lib/gasPoints';
import { GASPOINT_RULES, GASPOINT_LEVELS, levelFor, isGasPointAction, gasPointKeys, WEEKLY_MISSION_TARGET } from '../lib/gasPointsRules';
import { gasCapDateKey, gasCapWeekKey, weekKeyForDateKey, weekDateKeys } from '../lib/gasCapCalendar';
import { buildFuelPulse } from '../lib/fuelPulse';
import { computeGasPointsReport } from '../lib/gasPointsMetrics';
import { translations } from '../lib/translations';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const code = (p: string) => read(p).split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');

const U = 'user-1';
// 2026-10-06 is a Tuesday. Noon UTC is the same ET calendar day everywhere in the year.
const at = (ymd: string, hhmmZ = '16:00') => new Date(`${ymd}T${hhmmZ}:00Z`);

beforeEach(() => {
  state.ledger = [];
  state.users = new Map([
    [U, { role: 'user', isTestAccount: false, streak: 4 }],
    ['qa', { role: 'user', isTestAccount: true, streak: 0 }],
    ['adm', { role: 'admin', isTestAccount: false, streak: 0 }],
  ]);
});

// ── calendar ────────────────────────────────────────────────────────────────
describe('GasCap calendar (America/New_York)', () => {
  it('date key follows Eastern time, not UTC', () => {
    expect(gasCapDateKey(new Date('2026-10-09T03:30:00Z'))).toBe('2026-10-08');   // 11:30 PM EDT Oct 8
    expect(gasCapDateKey(new Date('2026-10-09T04:00:00Z'))).toBe('2026-10-09');   // midnight EDT
    expect(gasCapDateKey(new Date('2026-01-15T04:59:00Z'))).toBe('2026-01-14');   // EST
    expect(gasCapDateKey(new Date('2026-01-15T05:00:00Z'))).toBe('2026-01-15');
  });
  it('weeks run Monday to Sunday', () => {
    expect(weekKeyForDateKey('2026-10-05')).toBe('2026-10-05');   // Monday
    expect(weekKeyForDateKey('2026-10-11')).toBe('2026-10-05');   // Sunday
    expect(weekKeyForDateKey('2026-10-12')).toBe('2026-10-12');   // next Monday
    expect(gasCapWeekKey(new Date('2026-10-12T03:59:00Z'))).toBe('2026-10-05');   // still Sunday night EDT
    expect(gasCapWeekKey(new Date('2026-10-12T04:00:00Z'))).toBe('2026-10-12');
  });
  it('weekDateKeys lists the seven days', () => {
    expect(weekDateKeys('2026-10-05')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(weekKeyForDateKey('not-a-date')).toBeNull();
  });
  it('the calendar is a single shared module, not re-implemented per component', () => {
    for (const f of ['lib/gasPoints.ts', 'lib/gasPointsMetrics.ts', 'components/GasCapDailyCard.tsx', 'app/api/gaspoints/route.ts']) {
      expect(code(f), f).not.toMatch(/America\/New_York|Intl\.DateTimeFormat|getTimezoneOffset/);
    }
  });
});

// ── rules + levels ──────────────────────────────────────────────────────────
describe('rules and levels', () => {
  it('exact initial point rules', () => {
    expect(GASPOINT_RULES).toEqual({
      welcome_bonus: 25, daily_fuel_check: 5, weekly_3day_check: 25, first_vehicle: 25, first_saved_station: 20, fuel_action: 50,
    });
    expect(WEEKLY_MISSION_TARGET).toBe(3);
  });
  it('level thresholds and boundaries', () => {
    const id = (n: number) => levelFor(n).id;
    expect([0, 99].map(id)).toEqual(['starter', 'starter']);
    expect([100, 249].map(id)).toEqual(['road_ready', 'road_ready']);
    expect([250, 499].map(id)).toEqual(['fuel_smart', 'fuel_smart']);
    expect([500, 999].map(id)).toEqual(['smart_saver', 'smart_saver']);
    expect([1000, 99999].map(id)).toEqual(['gascap_elite', 'gascap_elite']);
    expect(GASPOINT_LEVELS.map((l) => l.min)).toEqual([0, 100, 250, 500, 1000]);
  });
  it('progress toward the next level; no fake next threshold at the top', () => {
    expect(levelFor(0)).toMatchObject({ pointsToNext: 100, progressPct: 0, next: { id: 'road_ready', min: 100 } });
    expect(levelFor(50)).toMatchObject({ pointsToNext: 50, progressPct: 50 });
    expect(levelFor(1000)).toMatchObject({ next: null, pointsToNext: 0, progressPct: 100 });
    expect(levelFor(-5).id).toBe('starter');
    expect(levelFor(NaN).id).toBe('starter');
  });
  it('no level is named "Pro"', () => {
    expect(GASPOINT_LEVELS.map((l) => l.id).join(' ')).not.toMatch(/pro\b/i);
    for (const l of Object.values(translations.en.gasPoints.levels)) expect(l).not.toMatch(/\bPro\b/);
  });
  it('only known actions are valid; arbitrary names are not', () => {
    expect(isGasPointAction('fuel_action')).toBe(true);
    for (const bad of ['points', 'toString', '__proto__', 'bonus_500', '', null, 5]) expect(isGasPointAction(bad)).toBe(false);
  });
});

// ── ledger ──────────────────────────────────────────────────────────────────
describe('ledger', () => {
  it('awardOnce inserts, and a duplicate idempotency key awards zero', async () => {
    expect(await awardOnce(U, 'welcome_bonus', 'k1')).toBe(true);
    expect(await awardOnce(U, 'welcome_bonus', 'k1')).toBe(false);
    expect(state.ledger).toHaveLength(1);
  });
  it('balance is the SUM of the ledger (not stored)', async () => {
    await awardOnce(U, 'welcome_bonus', 'a');     // 25
    await awardOnce(U, 'daily_fuel_check', 'b');  // 5
    await awardOnce(U, 'fuel_action', 'c');       // 50
    await awardOnce('qa', 'fuel_action', 'd');    // someone else's
    expect(await getBalance(U)).toBe(80);
    expect(await getBalance('nobody')).toBe(0);
  });
  it('points always come from the server rule table — a caller cannot pass an amount', async () => {
    expect(awardOnce.length).toBeLessThanOrEqual(4);
    await awardOnce(U, 'daily_fuel_check', 'x');
    expect(state.ledger[0].points).toBe(5);
    const src = code('lib/gasPoints.ts');
    expect(src).toMatch(/points: GASPOINT_RULES\[action\]/);
    // every `points:` in the module is either the rule table, an aggregate selector, or a type annotation
    const uses = [...src.matchAll(/\bpoints\s*:\s*([A-Za-z0-9_.\[\]]+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/^(GASPOINT_RULES|true|number)/);
  });
  it('a vanished user (FK failure) awards zero instead of throwing', async () => {
    expect(await awardOnce('ghost', 'welcome_bonus', 'g')).toBe(false);
  });
  it('the ledger is append-only: no update/delete/upsert anywhere in the module', () => {
    expect(code('lib/gasPoints.ts')).not.toMatch(/gasPointLedger\.(update|updateMany|delete|deleteMany|upsert)/);
  });
});

// ── daily check ─────────────────────────────────────────────────────────────
describe('Daily Fuel Check', () => {
  it('first-ever check gives 25 welcome + 5 daily = 30', async () => {
    const r = await completeDailyCheck(U, at('2026-10-06'));
    if ('ineligible' in r) throw new Error('unexpected');
    expect(r.awards.map((a) => a.action).sort()).toEqual(['daily_fuel_check', 'welcome_bonus']);
    expect(r.totalAwarded).toBe(30);
    expect(r.alreadyChecked).toBe(false);
    expect(r.status).toMatchObject({ balance: 30, checkedToday: true });
    expect(r.status.week.checks).toBe(1);
  });
  it('repeating the same GasCap day awards zero and creates no rows', async () => {
    await completeDailyCheck(U, at('2026-10-06', '14:00'));
    const rows = state.ledger.length;
    const r = await completeDailyCheck(U, at('2026-10-06', '23:00'));
    if ('ineligible' in r) throw new Error('unexpected');
    expect(r.totalAwarded).toBe(0);
    expect(r.alreadyChecked).toBe(true);
    expect(state.ledger).toHaveLength(rows);
    expect(r.status.balance).toBe(30);
  });
  it('concurrent clicks cannot double-award', async () => {
    const rs = await Promise.all(Array.from({ length: 5 }, () => completeDailyCheck(U, at('2026-10-06'))));
    expect(state.ledger.filter((x) => x.action === 'daily_fuel_check')).toHaveLength(1);
    expect(state.ledger.filter((x) => x.action === 'welcome_bonus')).toHaveLength(1);
    expect(await getBalance(U)).toBe(30);
    expect(rs).toHaveLength(5);
  });
  it('the next GasCap day gives +5 (welcome is lifetime-once)', async () => {
    await completeDailyCheck(U, at('2026-10-06'));
    const r = await completeDailyCheck(U, at('2026-10-07'));
    if ('ineligible' in r) throw new Error('unexpected');
    expect(r.awards).toEqual([{ action: 'daily_fuel_check', points: 5 }]);
    expect(r.status.balance).toBe(35);
  });
  it('the day rolls over at midnight Eastern, not UTC', async () => {
    await completeDailyCheck(U, new Date('2026-10-07T03:30:00Z'));   // 11:30 PM EDT Oct 6
    const r = await completeDailyCheck(U, new Date('2026-10-07T04:30:00Z'));   // 12:30 AM EDT Oct 7
    if ('ineligible' in r) throw new Error('unexpected');
    expect(r.alreadyChecked).toBe(false);
  });
  it('admin accounts earn nothing; the test account may earn', async () => {
    expect(await completeDailyCheck('adm', at('2026-10-06'))).toEqual({ ineligible: true });
    expect(state.ledger.filter((r) => r.userId === 'adm')).toHaveLength(0);
    const r = await completeDailyCheck('qa', at('2026-10-06'));
    if ('ineligible' in r) throw new Error('unexpected');
    expect(r.totalAwarded).toBe(30);
  });
  it('getStatus is read-only', async () => {
    const before = state.ledger.length;
    const s = await getStatus(U, at('2026-10-06'));
    expect(state.ledger).toHaveLength(before);
    expect(s).toMatchObject({ balance: 0, checkedToday: false, streak: 4, eligible: true });
    expect(s.week).toMatchObject({ checks: 0, target: 3, complete: false });
  });
});

// ── weekly mission ──────────────────────────────────────────────────────────
describe('weekly 3-day mission', () => {
  it('several checks on the same day count once', async () => {
    for (let i = 0; i < 4; i++) await completeDailyCheck(U, at('2026-10-06', `1${i}:00`));
    const s = await getStatus(U, at('2026-10-06'));
    expect(s.week.checks).toBe(1);
    expect(state.ledger.filter((r) => r.action === 'weekly_3day_check')).toHaveLength(0);
  });
  it('3 distinct days award +25 once, on the third', async () => {
    await completeDailyCheck(U, at('2026-10-06'));
    await completeDailyCheck(U, at('2026-10-07'));
    const third = await completeDailyCheck(U, at('2026-10-08'));
    if ('ineligible' in third) throw new Error('unexpected');
    expect(third.awards.map((a) => a.action).sort()).toEqual(['daily_fuel_check', 'weekly_3day_check']);
    expect(third.totalAwarded).toBe(30);
    expect(third.status.week).toMatchObject({ checks: 3, complete: true });
  });
  it('the 4th and 7th distinct days do not re-award the weekly bonus', async () => {
    for (const d of ['06', '07', '08', '09', '10', '11']) await completeDailyCheck(U, at(`2026-10-${d}`));
    const seventh = await completeDailyCheck(U, at('2026-10-05'));   // Monday of the same week, logged late
    if ('ineligible' in seventh) throw new Error('unexpected');
    expect(state.ledger.filter((r) => r.action === 'weekly_3day_check')).toHaveLength(1);
    expect(seventh.awards.map((a) => a.action)).not.toContain('weekly_3day_check');
  });
  it('Sunday and the next Monday are different weeks; a new Monday starts a new mission', async () => {
    await completeDailyCheck(U, at('2026-10-09'));
    await completeDailyCheck(U, at('2026-10-10'));
    await completeDailyCheck(U, at('2026-10-11'));       // Sunday: week one done
    expect(state.ledger.filter((r) => r.action === 'weekly_3day_check')).toHaveLength(1);
    const mon = await completeDailyCheck(U, at('2026-10-12'));   // new week
    if ('ineligible' in mon) throw new Error('unexpected');
    expect(mon.status.week).toMatchObject({ checks: 1, complete: false });
    expect(mon.awards.map((a) => a.action)).toEqual(['daily_fuel_check']);
    await completeDailyCheck(U, at('2026-10-13'));
    const wk2 = await completeDailyCheck(U, at('2026-10-14'));
    if ('ineligible' in wk2) throw new Error('unexpected');
    expect(wk2.awards.map((a) => a.action)).toContain('weekly_3day_check');
    expect(state.ledger.filter((r) => r.action === 'weekly_3day_check')).toHaveLength(2);
  });
  it('the mission needs no purchase: it is built only from Daily Fuel Checks', () => {
    const src = code('lib/gasPoints.ts');
    const fn = src.slice(src.indexOf('async function weeklyChecks'), src.indexOf('export interface GasPointsStatus'));
    expect(fn).toMatch(/action: 'daily_fuel_check'/);
    expect(fn).not.toMatch(/fillup|fuel_action/i);
  });
});

// ── fuel action ─────────────────────────────────────────────────────────────
describe('fuel action (+50)', () => {
  const ok = { gallons: 10, pricePerGallon: 3.5, totalCost: 35 };
  it('a valid persisted gallon-based record awards +50', async () => {
    expect(await awardFuelActionIfQualifying(U, ok, at('2026-10-06'))).toEqual({ action: 'fuel_action', points: 50 });
    expect(await getBalance(U)).toBe(50);
  });
  it('a retry or a second fill the same GasCap day awards zero', async () => {
    await awardFuelActionIfQualifying(U, ok, at('2026-10-06', '13:00'));
    expect(await awardFuelActionIfQualifying(U, ok, at('2026-10-06', '13:00'))).toBeNull();
    expect(await awardFuelActionIfQualifying(U, { ...ok, gallons: 4, totalCost: 14 }, at('2026-10-06', '22:00'))).toBeNull();
    expect(state.ledger.filter((r) => r.action === 'fuel_action')).toHaveLength(1);
    expect(await awardFuelActionIfQualifying(U, ok, at('2026-10-07'))).toEqual({ action: 'fuel_action', points: 50 });
  });
  it('EV/kWh and invalid records never earn', async () => {
    expect(await awardFuelActionIfQualifying(U, { ...ok, energyUnit: 'kwh' }, at('2026-10-06'))).toBeNull();
    expect(qualifiesForFuelPoints({ ...ok, energyUnit: 'gal' })).toBe(true);
    for (const bad of [{ gallons: 0 }, { gallons: -3 }, { totalCost: 0 }, { pricePerGallon: 0.1 }, { pricePerGallon: 99 }, { gallons: 9999 }, { gallons: NaN }]) {
      expect(qualifiesForFuelPoints({ ...ok, ...bad }), JSON.stringify(bad)).toBe(false);
    }
    expect(state.ledger).toHaveLength(0);
  });
  it('admin accounts do not earn it', async () => {
    expect(await awardFuelActionIfQualifying('adm', ok, at('2026-10-06'))).toBeNull();
  });
  it('is awarded only AFTER the record persisted, from the saved values — never plans (personal route)', () => {
    const route = read('app/api/fillups/route.ts');
    expect(route.indexOf('awardFuelActionIfQualifying(')).toBeGreaterThan(route.indexOf('await addFillup('));
    expect(route).toMatch(/gallons: entry\.gallonsPumped, pricePerGallon: entry\.pricePerGallon, totalCost: entry\.totalCost/);
    for (const f of ['app/api/fillups/route.ts', 'lib/gasPoints.ts']) expect(code(f), f).not.toMatch(/calculatedGallons|planGallons|planPrice|prefill/);
    // every early-return error path (validation 400, plan cap 403, warning 409/422) precedes the award
    const award = route.indexOf('awardFuelActionIfQualifying(');
    for (const needle of ["{ status: 400 }", "{ status: 403 }", "{ status: 409 }", "{ status: 422 }"]) {
      expect(route.lastIndexOf(needle, award)).toBeGreaterThan(-1);
    }
  });
  it('gig: awarded after the transaction, from the stored row, and kWh is excluded', () => {
    const gig = read('app/api/gig/fillups/route.ts');
    expect(gig.indexOf('awardFuelActionIfQualifying(')).toBeGreaterThan(gig.indexOf('prisma.$transaction'));
    expect(gig).toMatch(/energyUnit: record\.energyUnit/);
  });
  it('rental: awarded after the fill-up transaction committed', () => {
    const rental = read('lib/rentalFillups.ts');
    expect(rental.indexOf('awardFuelActionIfQualifying(')).toBeGreaterThan(rental.indexOf("result.kind === 'not_found'"));
  });
});

// ── first vehicle / station ─────────────────────────────────────────────────
describe('first vehicle and first station (once per lifetime)', () => {
  it('first successful vehicle creation awards +25 once; later creations do not', async () => {
    expect(await awardFirstVehicle(U)).toEqual({ action: 'first_vehicle', points: 25 });
    expect(await awardFirstVehicle(U)).toBeNull();            // second vehicle / delete + recreate
    expect(state.ledger.filter((r) => r.action === 'first_vehicle')).toHaveLength(1);
  });
  it('first saved station awards +20 once; more stations do not', async () => {
    expect(await awardFirstSavedStation(U)).toEqual({ action: 'first_saved_station', points: 20 });
    expect(await awardFirstSavedStation(U)).toBeNull();
    expect(await getBalance(U)).toBe(20);
  });
  it('admins earn neither', async () => {
    expect(await awardFirstVehicle('adm')).toBeNull();
    expect(await awardFirstSavedStation('adm')).toBeNull();
  });
  it('awarded only from the authoritative server create paths, after the row exists', () => {
    const veh = read('app/api/vehicles/route.ts');
    expect(veh.indexOf('awardFirstVehicle(')).toBeGreaterThan(veh.indexOf('await addVehicle('));
    const fav = read('app/api/favorites/route.ts');
    expect(fav.indexOf('awardFirstSavedStation(')).toBeGreaterThan(fav.indexOf('prisma.favoriteStation.upsert'));
    expect(fav).toMatch(/existing \? null : await awardFirstSavedStation\(userId\)/);   // never on an update
    const imp = read('app/api/vehicles/import/route.ts');
    expect(imp).toMatch(/if \(created > 0\) await awardFirstVehicle\(userId\)/);
  });
  it('there are no historical backfills (no script awards points)', () => {
    expect(read('scripts/add-gaspoint-ledger.mjs')).not.toMatch(/INSERT INTO "GasPointLedger"/);
  });
});

// ── fuel pulse ──────────────────────────────────────────────────────────────
describe('fuel pulse (real EIA data only)', () => {
  const now = new Date('2026-10-08T15:00:00Z');
  it('latest price, real survey week, week-over-week change', () => {
    const p = buildFuelPulse('regular', [{ observedOn: '2026-09-28', price: 4.30 }, { observedOn: '2026-10-05', price: 4.354 }], now);
    expect(p).toMatchObject({ grade: 'regular', price: 4.354, period: '2026-10-05', change: 0.054, direction: 'up', stale: false });
    expect(buildFuelPulse('diesel', [{ observedOn: '2026-10-05', price: 4.2 }, { observedOn: '2026-09-28', price: 4.5 }], now))
      .toMatchObject({ change: -0.3, direction: 'down' });
    expect(buildFuelPulse('regular', [{ observedOn: '2026-10-05', price: 4.3 }, { observedOn: '2026-09-28', price: 4.3 }], now).direction).toBe('flat');
  });
  it('no change is shown unless the prior observation is really the prior week', () => {
    const p = buildFuelPulse('regular', [{ observedOn: '2026-10-05', price: 4.35 }, { observedOn: '2026-09-14', price: 4.0 }], now);
    expect(p).toMatchObject({ price: 4.35, change: null, direction: null });
    expect(buildFuelPulse('regular', [{ observedOn: '2026-10-05', price: 4.35 }], now)).toMatchObject({ change: null, direction: null });
  });
  it('says so when there is no data, and flags a stale observation', () => {
    expect(buildFuelPulse('premium', [], now)).toMatchObject({ price: null, period: null, change: null, stale: true });
    expect(buildFuelPulse('regular', [{ observedOn: '2026-09-01', price: 4.0 }], now).stale).toBe(true);
  });
  it('is read from FuelPriceSnapshot (national, EIA) — no live fetch, no prediction', () => {
    const src = code('lib/fuelPulse.ts');
    expect(src).toMatch(/prisma\.fuelPriceSnapshot\.findMany/);
    expect(src).not.toMatch(/fetch\(|forecast|predict|BUY|WAIT/);
  });
});

// ── admin metrics ───────────────────────────────────────────────────────────
describe('admin GasPoints metrics', () => {
  const now = new Date('2026-10-08T16:00:00Z');
  const rows = [
    { userId: 'a', action: 'daily_fuel_check', points: 5, sourceRef: '2026-10-08' },
    { userId: 'a', action: 'daily_fuel_check', points: 5, sourceRef: '2026-10-07' },
    { userId: 'a', action: 'daily_fuel_check', points: 5, sourceRef: '2026-10-06' },
    { userId: 'a', action: 'weekly_3day_check', points: 25, sourceRef: '2026-10-05' },
    { userId: 'a', action: 'welcome_bonus', points: 25, sourceRef: null },
    { userId: 'b', action: 'daily_fuel_check', points: 5, sourceRef: '2026-09-20' },     // outside 7 days
    { userId: 'qa', action: 'daily_fuel_check', points: 5, sourceRef: '2026-10-08' },    // test acct — not in population
    { userId: 'adm', action: 'fuel_action', points: 50, sourceRef: '2026-10-08' },       // admin — not in population
  ];
  const rep = computeGasPointsReport({ now, userIds: ['a', 'b', 'c'], rows });
  it('counts only the real-user population', () => {
    expect(rep.participants).toBe(2);                       // a, b — qa/adm excluded, c has none
    expect(rep.dailyChecksLast7).toBe(3);
    expect(rep.distinctCheckersLast7).toBe(1);
    expect(rep.avgChecksPerChecker7).toBe(3);
  });
  it('weekly mission and level distribution', () => {
    expect(rep.weeklyMissionCompletedEver).toBe(1);
    expect(rep.weeklyMissionCompletedThisWeek).toBe(1);
    expect(rep.levelDistribution).toEqual({ starter: 2, road_ready: 0, fuel_smart: 0, smart_saver: 0, gascap_elite: 0 });
  });
  it('average is null when nobody checked', () => {
    expect(computeGasPointsReport({ now, userIds: ['x'], rows: [] }).avgChecksPerChecker7).toBeNull();
  });
  it('is read-only and admins cannot edit GasPoints', () => {
    expect(code('lib/gasPointsMetrics.ts')).not.toMatch(/prisma|create\(|update\(|delete/);
    expect(code('lib/engagementBaselineLoader.ts')).not.toMatch(/gasPointLedger\.(create|update|delete|upsert)/);
  });
});

// ── separation from existing systems ────────────────────────────────────────
describe('separation from giveaway entries, streak and badges', () => {
  const gpFiles = ['lib/gasPoints.ts', 'lib/gasPointsRules.ts', 'lib/gasPointsMetrics.ts', 'lib/gasCapCalendar.ts', 'lib/fuelPulse.ts',
    'app/api/gaspoints/route.ts', 'app/api/gaspoints/daily-check/route.ts'];
  it('no GasPoints module writes or calls anything giveaway/streak/badge', () => {
    for (const f of gpFiles) {
      expect(code(f), f).not.toMatch(/giveaway|recordActivity|awardStreak|badges|gigLogEntries|bonusEntries|activeDays|amoe/i);
    }
  });
  it('the only streak access is a READ for display', () => {
    const src = code('lib/gasPoints.ts');
    expect(src.match(/streak/g)?.length).toBeGreaterThan(0);
    expect(src).toMatch(/select: \{ streak: true \}/);
    expect(src).not.toMatch(/streak\s*:\s*\{\s*(increment|set)|data:\s*\{[^}]*streak/);
  });
  it('existing systems are not touched by this change (their sources do not mention GasPoints)', () => {
    for (const f of ['lib/giveaway.ts', 'lib/badges.ts', 'lib/streakTiers.ts', 'lib/amoeEntries.ts', 'app/api/giveaway/daily-bonus/route.ts', 'app/api/activity/route.ts']) {
      expect(read(f), f).not.toMatch(/GasPoint|gaspoints/i);
    }
  });
  it('the Gig route still awards its existing giveaway entries unchanged', () => {
    expect(read('app/api/gig/fillups/route.ts')).toMatch(/gigLogEntries: \{ increment: GIG_LOG_ENTRIES \}/);
  });
});

// ── API contract ────────────────────────────────────────────────────────────
const getServerSession = vi.fn(async (..._a: unknown[]) => null as unknown);
const completeDailyCheckMock = vi.fn(async (..._a: unknown[]) => ({} as unknown));
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/rateLimitDb', () => ({
  checkRateLimitDb: async () => ({ allowed: true, remaining: 9, resetInSeconds: 60 }),
  hashRateLimitIdentifier: (s: string) => `h:${s}`,
}));

describe('POST /api/gaspoints/daily-check contract', () => {
  async function post(body: unknown, raw?: string) {
    vi.resetModules();
    vi.doMock('@/lib/gasPoints', () => ({ completeDailyCheck: (...a: unknown[]) => completeDailyCheckMock(...(a as [])) }));
    vi.doMock('@/lib/fuelPulse', () => ({
      PULSE_GRADES: ['regular', 'midgrade', 'premium', 'diesel'],
      defaultPulseGrade: async () => 'regular',
      loadFuelPulse: async (g: string) => ({ grade: g, price: 4.35, period: '2026-10-05', change: null, direction: null, stale: false, ageDays: 3 }),
    }));
    const { POST } = await import('../app/api/gaspoints/daily-check/route');
    return POST(new Request('https://www.gascap.app/api/gaspoints/daily-check', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }));
  }
  beforeEach(() => {
    completeDailyCheckMock.mockReset();
    completeDailyCheckMock.mockResolvedValue({ awards: [], totalAwarded: 0, alreadyChecked: true, status: { balance: 30 } });
    getServerSession.mockResolvedValue({ user: { id: 'session-user' } });
  });

  it('requires authentication', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await post({})).status).toBe(401);
    expect(completeDailyCheckMock).not.toHaveBeenCalled();
  });
  it('rejects every client attempt to choose points, action, key or user', async () => {
    for (const body of [{ points: 500 }, { action: 'fuel_action' }, { idempotencyKey: 'x' }, { userId: 'victim' }, { amount: 1 }, { grade: 'regular', points: 5 }]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(completeDailyCheckMock).not.toHaveBeenCalled();
  });
  it('rejects a bad grade, non-object bodies and bad JSON', async () => {
    expect((await post({ grade: 'e85' })).status).toBe(400);
    expect((await post(['regular'])).status).toBe(400);
    expect((await post(undefined, '{not json')).status).toBe(400);
  });
  it('accepts an empty body or a valid display grade, using the SESSION user id only', async () => {
    expect((await post(undefined, '')).status).toBe(200);
    expect((await post({ grade: 'diesel' })).status).toBe(200);
    expect(completeDailyCheckMock.mock.calls.every((c) => c[0] === 'session-user')).toBe(true);
    const body = await (await post({})).json();
    expect(body.pulse).toMatchObject({ price: 4.35 });
  });
  it('admin accounts get 403', async () => {
    completeDailyCheckMock.mockResolvedValue({ ineligible: true });
    expect((await post({})).status).toBe(403);
  });
});

describe('GET /api/gaspoints contract', () => {
  it('is session-only, validates the grade, never awards', () => {
    const src = read('app/api/gaspoints/route.ts');
    expect(src).toMatch(/Invalid grade/);
    expect(src).toMatch(/getServerSession\(authOptions\)/);
    expect(code('app/api/gaspoints/route.ts')).not.toMatch(/completeDailyCheck|awardOnce|award[A-Z]/);
  });
});

// ── UI / copy ───────────────────────────────────────────────────────────────
describe('UI and copy', () => {
  const card = read('components/GasCapDailyCard.tsx');
  const cardCode = code('components/GasCapDailyCard.tsx');
  it('shows the CTA, balance, level, progress and weekly x/3', () => {
    expect(card).toMatch(/g\.checkCta/);
    expect(card).toMatch(/status\.balance/);
    expect(card).toMatch(/g\.levelLabel/);
    expect(card).toMatch(/level\.progressPct/);
    expect(card).toMatch(/g\.weekly\(Math\.min\(status\.week\.checks, status\.week\.target\), status\.week\.target\)/);
    expect(translations.en.gasPoints.checkCta).toBe("Check today's fuel pulse");
    expect(translations.en.gasPoints.weekly(2, 3)).toBe('Weekly mission: 2 / 3 checks');
  });
  it('the card never computes or requests a point amount', () => {
    expect(cardCode).not.toMatch(/points\s*[:=]\s*\d|\+\s*\d+\s*GasPoints/);
    expect(cardCode).toMatch(/body: JSON\.stringify\(grade \? \{ grade \} : \{\}\)/);
  });
  it('the GasPoints / giveaway separation line is shown, EN and ES', () => {
    expect(card).toMatch(/g\.separation/);
    expect(translations.en.gasPoints.separation).toBe('GasPoints are separate from giveaway entries and currently have no cash or redemption value.');
    expect(translations.es.gasPoints.separation).toMatch(/independientes de las participaciones del sorteo/);
  });
  it('EN and ES define exactly the same GasPoints keys', () => {
    const keys = (o: unknown, p = ''): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
    expect(keys(translations.es.gasPoints)).toEqual(keys(translations.en.gasPoints));
    for (const lang of ['en', 'es'] as const) {
      const gp = translations[lang].gasPoints;
      expect(Object.keys(gp.awardLabels).sort()).toEqual(Object.keys(GASPOINT_RULES).sort());
      expect(Object.keys(gp.levels)).toEqual(GASPOINT_LEVELS.map((l) => l.id));
    }
  });
  it('no BUY/WAIT/prediction language in the feature (code or copy)', () => {
    const copy = JSON.stringify([translations.en.gasPoints, translations.es.gasPoints], (_k, v) => (typeof v === 'function' ? v(1, 'x') : v));
    expect(copy).not.toMatch(/\b(buy now|buy|wait|predict|forecast|will rise|will fall|comprar|esperar|pronóstico)\b/i);
    for (const f of ['components/GasCapDailyCard.tsx', 'components/GasPointsToast.tsx', 'lib/fuelPulse.ts']) {
      expect(code(f), f).not.toMatch(/\b(buy now|predict|forecast)\b/i);
    }
  });
  it('no casino mechanics: no randomness, wheels, loot boxes or countdown timers', () => {
    for (const f of ['components/GasCapDailyCard.tsx', 'components/GasPointsToast.tsx', 'lib/gasPoints.ts', 'lib/gasPointsRules.ts', 'lib/fuelPulse.ts']) {
      expect(code(f), f).not.toMatch(/Math\.random|crypto\.getRandomValues|spin|wheel|loot|jackpot|setInterval|countdown/i);
    }
  });
  it('reward feedback respects reduced motion', () => {
    expect(read('app/globals.css')).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.animate-fade-in[^}]*animation: none/);
  });
  it('mounted on web and native; toast mounted on both; fill-up reward line present', () => {
    expect(read('app/page.tsx')).toMatch(/<GasCapDailyCard \/>/);
    expect(read('app/page.tsx')).toMatch(/<GasPointsToast \/>/);
    expect(read('components/native/NativeAppShell.tsx')).toMatch(/<GasCapDailyCard \/>/);
    expect(read('components/native/NativeAppShell.tsx')).toMatch(/<GasPointsToast \/>/);
    const logger = read('components/FillupLogger.tsx');
    expect(logger).toMatch(/t\.gasPoints\.fillupReward\(gpAwarded\)/);
    expect(translations.en.gasPoints.fillupReward(50)).toBe("+50 GasPoints for logging today's fill-up");
    expect(translations.en.gasPoints.fillupReward(50)).not.toMatch(/\$|save|saving/i);
  });
  it('the P1-B fuel feedback and plan-vs-actual integrity are unchanged', () => {
    const logger = read('components/FillupLogger.tsx');
    expect(logger).toMatch(/const \[gallons,\s+setGallons\]\s+=\s+useState\(''\)/);
    expect(logger).toMatch(/buildFuelFeedback\(savedJson\)/);
  });
  it('help page and the AI feature block describe GasPoints and the separation', () => {
    const help = read('app/help/page.tsx');
    expect(help).toMatch(/What are GasPoints and the Daily Fuel Check\?/);
    expect(help).toMatch(/separate from giveaway entries and from your visit streak/);
    expect(help).toMatch(/no cash value and cannot be redeemed/);
    const ai = read('app/api/ai/chat/route.ts');
    expect(ai).toMatch(/GasPoints \+ Daily Fuel Check \(Gamification G1\)/);
    expect(ai).toMatch(/NO cash value, no redemption/);
  });
  it('the migration is additive and idempotent, with a cascade FK, unique key and the required indexes', () => {
    const m = read('scripts/add-gaspoint-ledger.mjs');
    expect(m).toMatch(/CREATE TABLE IF NOT EXISTS "GasPointLedger"/);
    expect(m).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "GasPointLedger_idempotencyKey_key"/);
    expect(m).toMatch(/"GasPointLedger"\("userId", "createdAt"\)/);
    expect(m).toMatch(/"GasPointLedger"\("userId", "action"\)/);
    expect(m).toMatch(/ON DELETE CASCADE/);
    expect(m).not.toMatch(/DROP |TRUNCATE|DELETE FROM|ALTER TABLE "User"|db push/i);
    const schema = read('prisma/schema.prisma');
    expect(schema).toMatch(/model GasPointLedger \{[\s\S]*?idempotencyKey String\s+@unique[\s\S]*?onDelete: Cascade[\s\S]*?@@index\(\[userId, createdAt\]\)[\s\S]*?@@index\(\[userId, action\]\)/);
    expect(schema).not.toMatch(/gasPoints\s+Int/);   // no stored balance on User
  });
  it('gasPointKeys are deterministic identities', () => {
    expect(gasPointKeys.dailyCheck('u', '2026-10-08')).toBe('daily_fuel_check:u:2026-10-08');
    expect(gasPointKeys.weekly('u', '2026-10-05')).toBe('weekly_3day_check:u:2026-10-05');
    expect(gasPointKeys.welcome('u')).toBe('welcome_bonus:u');
  });
});

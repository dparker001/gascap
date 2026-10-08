/**
 * Gamification G2-B — server-authoritative weekly challenge rewards, the Fuel
 * Explorer endpoint, the launch-week boundary, the read model after rewards,
 * the "This Week" UI/copy contract, admin reporting and separation from G1.
 *
 * Runs against an in-memory ledger that enforces the real unique idempotencyKey.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { Prisma } from '../lib/generated/prisma/client';

interface Row { id: string; userId: string; action: string; points: number; idempotencyKey: string; sourceRef: string | null }
const state = {
  ledger: [] as Row[],
  users: new Map<string, { role: string; isTestAccount: boolean; streak: number }>(),
  vehicles: new Map<string, number>(),
  fillups: [] as { userId: string; fuelGrade: string; createdAt: string }[],
  failVehicleCount: false,                                  // simulates the challenge step erroring (only the G2 state loader counts vehicles)
};
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: async ({ where }: { where: { id: string } }) => state.users.get(where.id) ?? null },
    vehicle: { count: async ({ where }: { where: { userId: string } }) => { if (state.failVehicleCount) throw new Error('boom'); return state.vehicles.get(where.userId) ?? 0; } },
    fillup: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        state.fillups.filter((f) => f.userId === where.userId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((f) => ({ fuelGrade: f.fuelGrade })),
    },
    gasPointLedger: {
      create: async ({ data }: { data: Row }) => {
        if (!state.users.has(data.userId)) throw new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'test' });
        if (state.ledger.some((r) => r.idempotencyKey === data.idempotencyKey)) throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
        state.ledger.push({ ...data });
        return { id: data.id };
      },
      aggregate: async ({ where }: { where: { userId: string } }) => ({
        _sum: { points: state.ledger.filter((r) => r.userId === where.userId).reduce((s, r) => s + r.points, 0) || null },
      }),
      findMany: async ({ where }: { where: { userId: string; action: string | { in: string[] }; sourceRef: { in: string[] } } }) => {
        const acts = typeof where.action === 'string' ? [where.action] : where.action.in;
        return state.ledger
          .filter((r) => r.userId === where.userId && acts.includes(r.action) && r.sourceRef && where.sourceRef.in.includes(r.sourceRef))
          .map((r) => ({ action: r.action, sourceRef: r.sourceRef }));
      },
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
        state.ledger.find((r) => r.idempotencyKey === where.idempotencyKey) ? { id: 'x' } : null,
    },
  },
}));

// Mocks for the explore route contract tests (module scope so the hoisted factories can see them).
const getServerSession = vi.fn(async (..._a: unknown[]) => null as unknown);
const explore = vi.fn(async (..._a: unknown[]) => ({ outcome: 'awarded', award: { action: 'challenge_fuel_explorer', points: 15 } }));
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/rateLimitDb', () => ({ checkRateLimitDb: async () => ({ allowed: true, remaining: 9, resetInSeconds: 60 }), hashRateLimitIdentifier: (s: string) => `h:${s}` }));

import { completeDailyCheck, awardFuelActionIfQualifying, getBalance } from '../lib/gasPoints';
import {
  awardWeekendCheckIfEligible, awardFuelExplorerIfEligible, awardPumpTrackerIfEligible, awardChallengesAfterFuelAction, completeDailyCheckWithChallenges,
} from '../lib/gasChallengeAwards';
import { getWeeklyChallenges } from '../lib/gasChallenges';
import { selectWeeklyChallenges, G2_REWARDS_START_WEEK, isG2Active, challengeIdempotencyKey, MPG_BUILDER_SELECTABLE, AWARDABLE_CHALLENGES } from '../lib/gasChallengesRules';
import { GASPOINT_RULES, isGasPointAction } from '../lib/gasPointsRules';
import { computeGasPointsReport } from '../lib/gasPointsMetrics';
import { translations } from '../lib/translations';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const code = (p: string) => read(p).split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
const at = (ymd: string, hhmm = '16:00') => new Date(`${ymd}T${hhmm}:00Z`);

const W1 = '2026-10-12';                               // first rewardable week (Monday)
const TUE = '2026-10-13', WED = '2026-10-14', SAT = '2026-10-17', SUN = '2026-10-18';
const OLD_SAT = '2026-10-10';                          // Saturday of the pre-launch week (week 2026-10-05)

/** Find a synthetic user whose authoritative slot 2 / slot 3 for the week matches. */
function userWith(weekKey: string, slot2?: string, hasVehicle = true): string {
  for (let i = 0; i < 400; i++) {
    const id = `cand-${i}`;
    const s = selectWeeklyChallenges({ userId: id, weekKey, hasVehicle, pumpTrackerComplete: false, mpgBuilderAvailable: false });
    if (!slot2 || s.slot2 === slot2) { state.users.set(id, { role: 'user', isTestAccount: false, streak: 0 }); if (hasVehicle) state.vehicles.set(id, 1); return id; }
  }
  throw new Error('no candidate user');
}
const rowsFor = (u: string, action: string) => state.ledger.filter((r) => r.userId === u && r.action === action);
const ok = { gallons: 10, pricePerGallon: 3.5, totalCost: 35 };

beforeEach(() => {
  state.ledger = []; state.fillups = []; state.vehicles = new Map(); state.failVehicleCount = false;
  state.users = new Map([['adm', { role: 'admin', isTestAccount: false, streak: 0 }], ['qa', { role: 'user', isTestAccount: true, streak: 0 }]]);
});

// ── launch boundary ─────────────────────────────────────────────────────────
describe('launch boundary (no partial first week)', () => {
  it('starts the week of 2026-10-12 in the canonical calendar', () => {
    expect(G2_REWARDS_START_WEEK).toBe('2026-10-12');
    expect(isG2Active('2026-10-05')).toBe(false);
    expect(isG2Active('2026-10-12')).toBe(true);
    expect(isG2Active('2026-10-19')).toBe(true);
    expect(isG2Active('garbage')).toBe(false);
  });
  it('the pre-launch week can write NO G2 challenge reward, whatever the user does', async () => {
    const u = userWith('2026-10-05', 'weekend_check');
    await completeDailyCheck(u, at(OLD_SAT));                                       // a Saturday check in the old week
    expect(await awardWeekendCheckIfEligible(u, at(OLD_SAT))).toBeNull();
    expect((await completeDailyCheckWithChallenges(u, at(OLD_SAT)) as { awards: { action: string }[] }).awards.some((a) => a.action.startsWith('challenge_'))).toBe(false);
    await awardFuelActionIfQualifying(u, ok, at('2026-10-08'));
    expect(await awardPumpTrackerIfEligible(u, at('2026-10-08'))).toBeNull();
    expect(await awardChallengesAfterFuelAction(u, ok, at('2026-10-08'))).toEqual([]);
    expect((await awardFuelExplorerIfEligible(u, 'premium', at('2026-10-08'))).outcome).toBe('not_active');
    expect(state.ledger.filter((r) => r.action.startsWith('challenge_'))).toHaveLength(0);
  });
  it('the launch week can', async () => {
    const u = userWith(W1, 'weekend_check');
    await completeDailyCheck(u, at(SAT));
    expect(await awardWeekendCheckIfEligible(u, at(SAT))).toEqual({ action: 'challenge_weekend_check', points: 10 });
  });
  it('G1 awards continue normally before the launch week', async () => {
    const u = userWith('2026-10-05', undefined);
    const r = await completeDailyCheckWithChallenges(u, at('2026-10-06')) as { awards: { action: string; points: number }[]; totalAwarded: number };
    expect(r.awards.map((a) => a.action).sort()).toEqual(['daily_fuel_check', 'welcome_bonus']);
    expect(r.totalAwarded).toBe(30);
    expect(await awardFuelActionIfQualifying(u, ok, at('2026-10-06'))).toEqual({ action: 'fuel_action', points: 50 });
  });
  it('the challenges read model hides everything before the launch week', async () => {
    const r = await getWeeklyChallenges(userWith('2026-10-05'), at('2026-10-08'));
    expect(r).toMatchObject({ g2Active: false, startsOn: '2026-10-12', challenges: [] });
  });
});

// ── weekend check ───────────────────────────────────────────────────────────
describe('Weekend Check (+10)', () => {
  it('selected + Saturday daily check = +10, on top of G1 (+5, +25 welcome)', async () => {
    const u = userWith(W1, 'weekend_check');
    const r = await completeDailyCheckWithChallenges(u, at(SAT)) as { awards: { action: string; points: number }[]; totalAwarded: number; status: { balance: number } };
    expect(r.awards.map((a) => `${a.action}:${a.points}`).sort()).toEqual(['challenge_weekend_check:10', 'daily_fuel_check:5', 'welcome_bonus:25']);
    expect(r.totalAwarded).toBe(40);
    expect(r.status.balance).toBe(40);                       // status refreshed AFTER the challenge award
  });
  it('Sunday works', async () => {
    const u = userWith(W1, 'weekend_check');
    const r = await completeDailyCheckWithChallenges(u, at(SUN)) as { awards: { action: string }[] };
    expect(r.awards.map((a) => a.action)).toContain('challenge_weekend_check');
  });
  it('a weekday check does not earn it', async () => {
    const u = userWith(W1, 'weekend_check');
    for (const d of [W1, TUE, WED]) await completeDailyCheckWithChallenges(u, at(d));
    expect(rowsFor(u, 'challenge_weekend_check')).toHaveLength(0);
  });
  it('NOT selected = no +10 (a Fuel Explorer user gets nothing on Saturday)', async () => {
    const u = userWith(W1, 'fuel_explorer');
    const r = await completeDailyCheckWithChallenges(u, at(SAT)) as { awards: { action: string }[] };
    expect(r.awards.map((a) => a.action)).not.toContain('challenge_weekend_check');
    expect(rowsFor(u, 'challenge_weekend_check')).toHaveLength(0);
  });
  it('a repeat request awards zero more; G1 +5 behaves independently', async () => {
    const u = userWith(W1, 'weekend_check');
    await completeDailyCheckWithChallenges(u, at(SAT, '14:00'));
    const again = await completeDailyCheckWithChallenges(u, at(SAT, '20:00')) as { awards: unknown[]; totalAwarded: number };
    expect(again.awards).toEqual([]);
    expect(again.totalAwarded).toBe(0);
    expect(rowsFor(u, 'challenge_weekend_check')).toHaveLength(1);
    expect(rowsFor(u, 'daily_fuel_check')).toHaveLength(1);
    expect(await getBalance(u)).toBe(40);
  });
  it('needs the G1 daily check for today to exist first', async () => {
    const u = userWith(W1, 'weekend_check');
    expect(await awardWeekendCheckIfEligible(u, at(SAT))).toBeNull();     // no daily row persisted yet
  });
  it('admin accounts earn nothing', async () => {
    expect(await awardWeekendCheckIfEligible('adm', at(SAT))).toBeNull();
  });
  it('an award failure never fails or alters the G1 daily check', async () => {
    const u = userWith(W1, 'weekend_check');
    state.failVehicleCount = true;                                     // the challenge step now throws internally
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await completeDailyCheckWithChallenges(u, at(SAT)) as { awards: { action: string; points: number }[]; totalAwarded: number };
    spy.mockRestore();
    expect(r.awards.map((a) => a.action).sort()).toEqual(['daily_fuel_check', 'welcome_bonus']);   // G1 result intact
    expect(r.totalAwarded).toBe(30);
    expect(rowsFor(u, 'challenge_weekend_check')).toHaveLength(0);
    expect(rowsFor(u, 'daily_fuel_check')).toHaveLength(1);            // the check itself persisted
  });
});

// ── fuel explorer ───────────────────────────────────────────────────────────
describe('Fuel Explorer (+15) — authoritative explore', () => {
  it('must be the selected challenge', async () => {
    const u = userWith(W1, 'weekend_check');
    await completeDailyCheck(u, at(WED));
    expect(await awardFuelExplorerIfEligible(u, 'premium', at(WED))).toEqual({ outcome: 'not_selected', award: null });
  });
  it('requires a Daily Fuel Check this week', async () => {
    const u = userWith(W1, 'fuel_explorer');
    expect(await awardFuelExplorerIfEligible(u, 'premium', at(WED))).toEqual({ outcome: 'no_daily_check', award: null });
    await completeDailyCheck(u, at('2026-10-06'));                       // a check LAST week does not count
    expect((await awardFuelExplorerIfEligible(u, 'premium', at(WED))).outcome).toBe('no_daily_check');
  });
  it('a supported alternate grade completes it once a check exists this week', async () => {
    const u = userWith(W1, 'fuel_explorer');
    await completeDailyCheck(u, at(TUE));
    const r = await awardFuelExplorerIfEligible(u, 'premium', at(WED));
    expect(r).toEqual({ outcome: 'awarded', award: { action: 'challenge_fuel_explorer', points: 15 } });
    expect(rowsFor(u, 'challenge_fuel_explorer')[0]).toMatchObject({ points: 15, sourceRef: W1, idempotencyKey: challengeIdempotencyKey('fuel_explorer', u, W1) });
  });
  it('the SAME as the server-derived default grade does not (Regular when there is no fill-up)', async () => {
    const u = userWith(W1, 'fuel_explorer');
    await completeDailyCheck(u, at(TUE));
    expect((await awardFuelExplorerIfEligible(u, 'regular', at(WED))).outcome).toBe('same_grade');
    expect(rowsFor(u, 'challenge_fuel_explorer')).toHaveLength(0);
  });
  it("the default comes from the user's latest priceable fill-up, derived server-side", async () => {
    const u = userWith(W1, 'fuel_explorer');
    state.fillups.push({ userId: u, fuelGrade: 'diesel', createdAt: '2026-10-01T00:00:00Z' });
    await completeDailyCheck(u, at(TUE));
    expect((await awardFuelExplorerIfEligible(u, 'diesel', at(WED))).outcome).toBe('same_grade');
    expect((await awardFuelExplorerIfEligible(u, 'regular', at(WED))).outcome).toBe('awarded');
  });
  it('invalid grades are rejected', async () => {
    const u = userWith(W1, 'fuel_explorer');
    await completeDailyCheck(u, at(TUE));
    for (const g of ['e85', 'PREMIUM', '', null, 5, undefined, { a: 1 }]) expect((await awardFuelExplorerIfEligible(u, g, at(WED))).outcome, String(g)).toBe('invalid_grade');
  });
  it('repeated posts and grade-switching add nothing', async () => {
    const u = userWith(W1, 'fuel_explorer');
    await completeDailyCheck(u, at(TUE));
    await awardFuelExplorerIfEligible(u, 'premium', at(WED));
    for (const g of ['midgrade', 'diesel', 'premium', 'midgrade']) expect((await awardFuelExplorerIfEligible(u, g, at(WED))).award).toBeNull();
    expect(rowsFor(u, 'challenge_fuel_explorer')).toHaveLength(1);
  });
  it('concurrent completions cannot duplicate the reward', async () => {
    const u = userWith(W1, 'fuel_explorer');
    await completeDailyCheck(u, at(TUE));
    const rs = await Promise.all(Array.from({ length: 6 }, () => awardFuelExplorerIfEligible(u, 'premium', at(WED))));
    expect(rs.filter((r) => r.award).length).toBeLessThanOrEqual(1);
    expect(rowsFor(u, 'challenge_fuel_explorer')).toHaveLength(1);
  });
  it('admins are not eligible', async () => {
    expect((await awardFuelExplorerIfEligible('adm', 'premium', at(WED))).outcome).toBe('ineligible');
  });
  it('an arbitrary GET never completes it (no award call in any read path)', () => {
    for (const f of ['app/api/gaspoints/route.ts', 'app/api/gaspoints/challenges/route.ts', 'lib/gasChallenges.ts', 'lib/fuelPulse.ts']) {
      expect(code(f), f).not.toMatch(/awardFuelExplorer|awardOnce|awardChallenge/);
    }
  });
});

describe('POST /api/gaspoints/explore contract', () => {
  async function post(body: unknown, raw?: string) {
    vi.resetModules();
    vi.doMock('@/lib/gasChallengeAwards', () => ({ awardFuelExplorerIfEligible: (...a: unknown[]) => explore(...(a as [])) }));
    const { POST } = await import('../app/api/gaspoints/explore/route');
    return POST(new Request('https://www.gascap.app/api/gaspoints/explore', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body),
    }));
  }
  beforeEach(() => { explore.mockClear(); getServerSession.mockResolvedValue({ user: { id: 'session-user' } }); });

  it('requires authentication', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await post({ grade: 'premium' })).status).toBe(401);
    expect(explore).not.toHaveBeenCalled();
  });
  it('rejects every client attempt to name the user, points, action, challenge, key or completion', async () => {
    for (const extra of [{ userId: 'victim' }, { points: 500 }, { action: 'challenge_pump_tracker' }, { challengeId: 'pump_tracker' }, { idempotencyKey: 'k' }, { completed: true }]) {
      const res = await post({ grade: 'premium', ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect(explore).not.toHaveBeenCalled();
  });
  it('rejects a missing/unsupported grade, arrays and bad JSON', async () => {
    for (const body of [{}, { grade: 'e85' }, { grade: 5 }, { grade: null }]) expect((await post(body)).status).toBe(400);
    expect((await post(['premium'])).status).toBe(400);
    expect((await post(undefined, '{nope')).status).toBe(400);
    expect(explore).not.toHaveBeenCalled();
  });
  it('uses the SESSION user and returns the award list', async () => {
    const res = await post({ grade: 'premium' });
    expect(res.status).toBe(200);
    expect(explore.mock.calls[0][0]).toBe('session-user');
    expect(explore.mock.calls[0][1]).toBe('premium');
    expect(await res.json()).toMatchObject({ awards: [{ action: 'challenge_fuel_explorer', points: 15 }], totalAwarded: 15, outcome: 'awarded' });
  });
  it('admins get 403', async () => {
    explore.mockResolvedValueOnce({ outcome: 'ineligible', award: null } as never);
    expect((await post({ grade: 'premium' })).status).toBe(403);
  });
});

// ── pump tracker ────────────────────────────────────────────────────────────
describe('Pump Tracker (+25)', () => {
  async function fill(u: string, ymd: string, rec: Parameters<typeof awardChallengesAfterFuelAction>[1] = ok) {
    const g1 = await awardFuelActionIfQualifying(u, rec, at(ymd));
    const ch = await awardChallengesAfterFuelAction(u, rec, at(ymd));
    return { g1, ch };
  }
  it('selected + a persisted qualifying fuel action = +25, listed separately from the +50', async () => {
    const u = userWith(W1, undefined, true);
    const { g1, ch } = await fill(u, WED);
    expect(g1).toEqual({ action: 'fuel_action', points: 50 });
    expect(ch).toEqual([{ action: 'challenge_pump_tracker', points: 25 }]);
    expect(await getBalance(u)).toBe(75);
    expect(rowsFor(u, 'challenge_pump_tracker')[0].idempotencyKey).toBe(challengeIdempotencyKey('pump_tracker', u, W1));
  });
  it('NOT selected (no vehicle -> add_vehicle guidance) = no challenge reward, G1 +50 unaffected', async () => {
    const u = userWith(W1, undefined, false);
    const { g1, ch } = await fill(u, WED);
    expect(g1).toEqual({ action: 'fuel_action', points: 50 });
    expect(ch).toEqual([]);
    expect(rowsFor(u, 'challenge_pump_tracker')).toHaveLength(0);
  });
  it('requires the persisted G1 fuel_action row (no row, no reward)', async () => {
    const u = userWith(W1, undefined, true);
    expect(await awardPumpTrackerIfEligible(u, at(WED))).toBeNull();
  });
  it('only once per week; the G1 +50 stays once per GasCap day', async () => {
    const u = userWith(W1, undefined, true);
    await fill(u, WED);
    const sameDay = await fill(u, WED);
    expect(sameDay).toEqual({ g1: null, ch: [] });
    const nextDay = await fill(u, '2026-10-15');
    expect(nextDay.g1).toEqual({ action: 'fuel_action', points: 50 });
    expect(nextDay.ch).toEqual([]);                                       // Pump Tracker already earned this week
    expect(rowsFor(u, 'challenge_pump_tracker')).toHaveLength(1);
    expect(rowsFor(u, 'fuel_action')).toHaveLength(2);
    const nextWeek = await fill(u, '2026-10-20');
    expect(nextWeek.ch).toEqual([{ action: 'challenge_pump_tracker', points: 25 }]);   // a new week can earn again
  });
  it('EV/kWh and invalid records cannot satisfy it', async () => {
    const u = userWith(W1, undefined, true);
    expect(await awardChallengesAfterFuelAction(u, { ...ok, energyUnit: 'kwh' }, at(WED))).toEqual([]);
    for (const bad of [{ gallons: 0 }, { totalCost: 0 }, { pricePerGallon: 99 }]) expect(await awardChallengesAfterFuelAction(u, { ...ok, ...bad }, at(WED))).toEqual([]);
    expect(state.ledger).toHaveLength(0);
  });
  it('concurrent saves cannot duplicate it', async () => {
    const u = userWith(W1, undefined, true);
    await awardFuelActionIfQualifying(u, ok, at(WED));
    await Promise.all(Array.from({ length: 6 }, () => awardChallengesAfterFuelAction(u, ok, at(WED))));
    expect(rowsFor(u, 'challenge_pump_tracker')).toHaveLength(1);
  });
  it('wired into personal, gig and rental paths AFTER the persisted record and the G1 award', () => {
    const personal = read('app/api/fillups/route.ts');
    expect(personal.indexOf('awardChallengesAfterFuelAction(')).toBeGreaterThan(personal.indexOf('awardFuelActionIfQualifying('));
    expect(personal.indexOf('awardFuelActionIfQualifying(')).toBeGreaterThan(personal.indexOf('await addFillup('));
    const gig = read('app/api/gig/fillups/route.ts');
    expect(gig.indexOf('awardChallengesAfterFuelAction(')).toBeGreaterThan(gig.indexOf('awardFuelActionIfQualifying('));
    expect(gig).toMatch(/energyUnit: record\.energyUnit/);
    const rental = read('lib/rentalFillups.ts');
    expect(rental.indexOf('awardChallengesAfterFuelAction(')).toBeGreaterThan(rental.indexOf('awardFuelActionIfQualifying('));
  });
  it('a failed fill-up save never reaches an award (every error return precedes it)', () => {
    const route = read('app/api/fillups/route.ts');
    const award = route.indexOf('awardChallengesAfterFuelAction(');
    for (const needle of ['{ status: 400 }', '{ status: 403 }', '{ status: 409 }', '{ status: 422 }', '{ status: 413 }']) {
      expect(route.lastIndexOf(needle, award), needle).toBeGreaterThan(-1);
    }
  });
  it('editing or deleting a fill-up never awards or re-awards (PATCH/DELETE have no award path)', () => {
    const route = read('app/api/fillups/route.ts');
    const patchAt = route.indexOf('export async function PATCH');
    expect(patchAt).toBeGreaterThan(route.indexOf('awardChallengesAfterFuelAction('));
    expect(route.slice(patchAt)).not.toMatch(/award/i);
    expect(code('lib/gasChallengeAwards.ts')).not.toMatch(/updateFillup|deleteFillup/);
  });
  it('the P1-B plan-vs-actual integrity and fuel feedback are unchanged', () => {
    const logger = read('components/FillupLogger.tsx');
    expect(logger).toMatch(/const \[gallons,\s+setGallons\]\s+=\s+useState\(''\)/);
    expect(logger).toMatch(/buildFuelFeedback\(savedJson\)/);
  });
});

// ── state-sensitive slot 3 + read model after rewards ───────────────────────
describe('slot 3 and the read model after G2-B rewards', () => {
  it('no vehicle = guidance (no second reward); after a vehicle it becomes Pump Tracker', async () => {
    const u = userWith(W1, undefined, false);
    const before = await getWeeklyChallenges(u, at(WED));
    expect(before.challenges[2]).toMatchObject({ id: 'add_vehicle', status: 'guidance', proposedReward: null, rewardAction: 'first_vehicle', rewardIsExistingG1: true });
    state.vehicles.set(u, 1);
    expect((await getWeeklyChallenges(u, at(WED))).challenges[2]).toMatchObject({ id: 'pump_tracker', status: 'available', progress: 0, trackingCapability: 'server_authoritative' });
  });
  it('a completed Pump Tracker stays represented even if the vehicle is later removed', async () => {
    const u = userWith(W1, undefined, true);
    await awardFuelActionIfQualifying(u, ok, at(WED));
    await awardChallengesAfterFuelAction(u, ok, at(WED));
    state.vehicles.set(u, 0);
    expect((await getWeeklyChallenges(u, at(SAT))).challenges[2]).toMatchObject({ id: 'pump_tracker', status: 'complete', progress: 1 });
  });
  it('a fuel action logged BEFORE Pump Tracker was selected does not count as the challenge', async () => {
    const u = userWith(W1, undefined, false);
    await fill0(u, WED);                                                  // no vehicle -> slot 3 was add_vehicle
    state.vehicles.set(u, 1);
    expect((await getWeeklyChallenges(u, at(SAT))).challenges[2]).toMatchObject({ id: 'pump_tracker', status: 'available', progress: 0 });
    async function fill0(id: string, d: string) { await awardFuelActionIfQualifying(id, ok, at(d)); await awardChallengesAfterFuelAction(id, ok, at(d)); }
  });
  it('selected challenge progress comes from the award rows; Fuel Explorer is no longer tracking_unavailable', async () => {
    const u = userWith(W1, 'fuel_explorer');
    await completeDailyCheck(u, at(TUE));
    let r = await getWeeklyChallenges(u, at(WED));
    expect(r.challenges[1]).toMatchObject({ id: 'fuel_explorer', status: 'available', progress: 0, target: 1, trackingCapability: 'server_authoritative' });
    await awardFuelExplorerIfEligible(u, 'premium', at(WED));
    r = await getWeeklyChallenges(u, at(WED));
    expect(r.challenges[1]).toMatchObject({ id: 'fuel_explorer', status: 'complete', progress: 1 });
  });
  it('weekend qualifying action WITHOUT its award row: the read model stays available 0/1 (G1 activity exists, challenge not complete)', async () => {
    const u = userWith(W1, 'weekend_check');
    await completeDailyCheck(u, at(SAT));                                  // plain G1 check: a Saturday daily row, no challenge award
    expect(rowsFor(u, 'daily_fuel_check')).toHaveLength(1);
    expect(rowsFor(u, 'challenge_weekend_check')).toHaveLength(0);
    const before = state.ledger.length;
    const r = await getWeeklyChallenges(u, at(SAT));
    expect(r.challenges[1]).toMatchObject({ id: 'weekend_check', status: 'available', progress: 0, target: 1 });
    expect(state.ledger).toHaveLength(before);                              // reading never repairs or writes
  });
  it('a best-effort award failure leaves the read model truthful, and a later retry completes it', async () => {
    const u = userWith(W1, 'weekend_check');
    state.failVehicleCount = true;                                          // the challenge step throws internally
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await completeDailyCheckWithChallenges(u, at(SAT)) as { awards: { action: string }[] };
    spy.mockRestore();
    expect(failed.awards.map((a) => a.action)).not.toContain('challenge_weekend_check');
    state.failVehicleCount = false;
    expect(rowsFor(u, 'daily_fuel_check')).toHaveLength(1);                 // underlying G1 activity exists
    expect((await getWeeklyChallenges(u, at(SAT))).challenges[1]).toMatchObject({ status: 'available', progress: 0 });   // not complete
    const retry = await completeDailyCheckWithChallenges(u, at(SAT, '20:00')) as { awards: { action: string }[] };
    expect(retry.awards.map((a) => a.action)).toEqual(['challenge_weekend_check']);       // the retry awards the missed +10 (no duplicate G1)
    expect((await getWeeklyChallenges(u, at(SAT))).challenges[1]).toMatchObject({ status: 'complete', progress: 1 });
    expect(rowsFor(u, 'challenge_weekend_check')).toHaveLength(1);
  });
  it('normal weekend path: G1 awards + exactly one +10 returned separately, then reads back complete; repeats stay complete', async () => {
    const u = userWith(W1, 'weekend_check');
    const r = await completeDailyCheckWithChallenges(u, at(SUN)) as { awards: { action: string; points: number }[] };
    expect(r.awards.map((a) => `${a.action}:${a.points}`).sort()).toEqual(['challenge_weekend_check:10', 'daily_fuel_check:5', 'welcome_bonus:25']);
    expect((await getWeeklyChallenges(u, at(SUN))).challenges[1]).toMatchObject({ status: 'complete', progress: 1, target: 1 });
    const again = await completeDailyCheckWithChallenges(u, at(SUN, '22:00')) as { awards: unknown[] };
    expect(again.awards).toEqual([]);
    expect(rowsFor(u, 'challenge_weekend_check')).toHaveLength(1);
    expect((await getWeeklyChallenges(u, at(SUN, '22:00'))).challenges[1]).toMatchObject({ status: 'complete', progress: 1 });
  });
  it('the weekend award row alone is what completes it (no award row -> not complete, even with Sat/Sun checks)', () => {
    const src = code('lib/gasChallengesRules.ts');
    const weekend = src.slice(src.indexOf("case 'weekend_check': {"), src.indexOf("case 'pump_tracker': {"));
    expect(weekend).toMatch(/const done = ctx\.challengeAwards\.includes\('challenge_weekend_check'\);/);
    expect(weekend).not.toMatch(/checkDates|isWeekendDateKey/);
  });
  it('Weekend Check shows complete after its award', async () => {
    const u = userWith(W1, 'weekend_check');
    await completeDailyCheckWithChallenges(u, at(SAT));
    expect((await getWeeklyChallenges(u, at(SUN))).challenges[1]).toMatchObject({ id: 'weekend_check', status: 'complete', progress: 1 });
  });
  it('MPG Builder stays non-selectable and has no award path in g2_v1', async () => {
    expect(MPG_BUILDER_SELECTABLE).toBe(false);
    expect(AWARDABLE_CHALLENGES).not.toContain('mpg_builder');
    for (let i = 0; i < 100; i++) {
      const u = userWith(W1, undefined, true);
      expect((await getWeeklyChallenges(u, at(WED))).challenges.map((c) => c.id)).not.toContain('mpg_builder');
    }
  });
  it('always exactly three rows', async () => {
    for (const v of [true, false]) expect((await getWeeklyChallenges(userWith(W1, undefined, v), at(WED))).challenges).toHaveLength(3);
  });
});

// ── UI / copy ───────────────────────────────────────────────────────────────
describe('"This Week" UI and copy', () => {
  const card = read('components/GasCapDailyCard.tsx');
  const ids = ['fuel_check_3day', 'weekend_check', 'fuel_explorer', 'pump_tracker', 'mpg_builder', 'add_vehicle'] as const;
  const en = translations.en.gasChallenges, es = translations.es.gasChallenges;

  it('renders a compact "This Week" section inside the Daily Fuel Check card, only in an active week', () => {
    expect(card).toMatch(/t\.gasChallenges\.heading/);
    expect(card).toMatch(/\{ch\?\.g2Active && ch\.challenges\.length > 0 && \(/);
    expect(en.heading).toBe('This Week');
    expect(es.heading).toBe('Esta semana');
  });
  it('before launch it shows only a "starts Monday" notice and the unchanged G1 weekly mission', () => {
    expect(card).toMatch(/g2-starts-notice/);
    expect(card).toMatch(/\{!ch\?\.g2Active && \(/);          // G1 weekly-mission presentation only before G2 is live
    expect(en.startsMonday('Oct 12')).toBe('Weekly Challenges start Monday, Oct 12.');
  });
  it('shows name, purpose, progress, reward and completion for every row', () => {
    for (const k of ['names', 'descriptions', 'progressDays', 'rewardLine', 'complete']) expect(card).toMatch(new RegExp(`t\\.gasChallenges\\.${k}`));
    expect(en.progressDays(1, 3)).toBe('1 / 3 days');
    expect(en.rewardLine(25)).toBe('+25 GasPoints');
  });
  it('the owner-specified English names and descriptions', () => {
    expect(en.names).toMatchObject({ fuel_check_3day: 'Fuel Check Regular', weekend_check: 'Weekend Check', fuel_explorer: 'Fuel Explorer', pump_tracker: 'Pump Tracker', mpg_builder: 'MPG Builder', add_vehicle: 'Add Your Vehicle' });
    expect(en.descriptions.fuel_check_3day).toBe('Check the Daily Fuel Pulse on 3 different days this week.');
    expect(en.descriptions.weekend_check).toBe('Check the fuel pulse on Saturday or Sunday.');
    expect(en.descriptions.fuel_explorer).toBe("Compare another fuel grade after today's Fuel Check.");
    expect(en.descriptions.pump_tracker).toBe('Log one qualifying fill-up this week.');
    expect(en.descriptions.add_vehicle).toBe('Set up your vehicle to unlock personalized fuel tracking.');
  });
  it('EN and ES define identical keys and every challenge id', () => {
    const keys = (o: unknown, p = ''): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
    expect(keys(es)).toEqual(keys(en));
    for (const id of ids) { expect(en.names[id]).toBeTruthy(); expect(es.names[id]).toBeTruthy(); expect(es.descriptions[id]).toBeTruthy(); }
    for (const lang of ['en', 'es'] as const) {
      const labels = translations[lang].gasPoints.awardLabels;
      for (const a of ['challenge_weekend_check', 'challenge_fuel_explorer', 'challenge_pump_tracker', 'challenge_mpg_builder'] as const) expect(labels[a]).toBeTruthy();
    }
  });
  it('guidance never implies a second reward', () => {
    expect(en.g1RewardNote(25)).toBe('+25 GasPoints already available through GasCap');
    expect(card).toMatch(/c\.status === 'guidance'\s*\? <p[^>]*>\{t\.gasChallenges\.g1RewardNote\(GASPOINT_RULES\.first_vehicle\)\}<\/p>\s*: c\.proposedReward !== null && /);
  });
  it('a completion shows the banner; multiple awards are listed one by one, never merged', () => {
    expect(en.completeBanner).toBe('Weekly Challenge Complete!');
    expect(card).toMatch(/awards\.map\(\(a\) => \(\s*<li key=\{a\.action\}/);
    const logger = read('components/FillupLogger.tsx');
    expect(logger).toMatch(/gpChallenges\.map\(\(a\) => \(/);
    expect(logger).toMatch(/t\.gasPoints\.fillupReward\(gpAwarded\)/);       // the +50 line is separate
    expect(translations.en.gasPoints.awardLine(25, translations.en.gasPoints.awardLabels.challenge_pump_tracker)).toBe('+25 GasPoints — Pump Tracker');
  });
  it('Fuel Explorer is completed only via the explicit POST, only when open, never for ordinary switching', () => {
    expect(card).toMatch(/explorerOpen/);
    expect(card).toMatch(/fetch\('\/api\/gaspoints\/explore', \{\s*method: 'POST'/);
    expect(card).toMatch(/if \(explorerOpen && defaultGrade\.current !== null && next !== defaultGrade\.current\)/);
    expect(card).toMatch(/body: JSON\.stringify\(\{ grade: next \}\)/);
  });
  it('no pressure, countdown or casino language in the new copy (EN + ES)', () => {
    const flat = JSON.stringify([en, es], (_k, v) => (typeof v === 'function' ? v('x', 3) : v));
    expect(flat).not.toMatch(/hurry|don'?t lose|hours? left|countdown|expires?|last chance|only \d|prisa|no pierdas|horas restantes|última oportunidad|expira/i);
    expect(code('components/GasCapDailyCard.tsx')).not.toMatch(/Math\.random|spin|wheel|loot|jackpot|setInterval|countdown/i);
  });
  it('respects reduced motion', () => {
    expect(read('app/globals.css')).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.animate-fade-in[^}]*animation: none/);
  });
  it('help page and AI block document the weekly challenges and the launch date', () => {
    expect(read('app/help/page.tsx')).toMatch(/Starting the week of Monday, October 12, 2026/);
    expect(read('app/api/ai/chat/route.ts')).toMatch(/Weekly challenges \(start Monday, October 12, 2026/);
  });
});

// ── admin reporting ─────────────────────────────────────────────────────────
describe('admin GasPoints report — G2 section', () => {
  const now = new Date('2026-10-15T16:00:00Z');
  const wk = '2026-10-12';
  const rows = [
    { userId: 'a', action: 'weekly_3day_check', points: 25, sourceRef: wk },
    { userId: 'a', action: 'challenge_weekend_check', points: 10, sourceRef: wk },
    { userId: 'b', action: 'challenge_pump_tracker', points: 25, sourceRef: wk },
    { userId: 'b', action: 'challenge_fuel_explorer', points: 15, sourceRef: '2026-10-05' },     // last week
    { userId: 'qa', action: 'challenge_pump_tracker', points: 25, sourceRef: wk },                // test account
    { userId: 'adm', action: 'challenge_weekend_check', points: 10, sourceRef: wk },              // admin
  ];
  const rep = computeGasPointsReport({ now, userIds: ['a', 'b', 'c'], rows });
  it('counts this-week completions by challenge for real users only', () => {
    expect(rep.g2.completionsThisWeek).toEqual({ fuel_check_3day: 1, weekend_check: 1, fuel_explorer: 0, pump_tracker: 1 });
    expect(rep.g2.usersCompletingAnyThisWeek).toBe(2);
  });
  it('totals challenge points (all time) for real users only', () => {
    expect(rep.g2.challengePointsAwardedTotal).toBe(10 + 25 + 15);
  });
  it('the existing G1 report fields are unchanged', () => {
    expect(rep.participants).toBe(2);
    expect(rep.weeklyMissionCompletedThisWeek).toBe(1);
  });
});

// ── separation / no schema ──────────────────────────────────────────────────
describe('separation, security and no schema work', () => {
  const NEW = ['lib/gasChallengeAwards.ts', 'lib/gasChallenges.ts', 'lib/gasChallengesRules.ts', 'app/api/gaspoints/explore/route.ts'];
  it('no giveaway, streak or badge code is touched by the challenge modules', () => {
    for (const f of NEW) expect(code(f), f).not.toMatch(/giveaway|badges|BadgeShelf|activeDays|gigLogEntries|bonusEntries|recordActivity|streak\s*:\s*\{/i);
    for (const f of ['lib/badges.ts', 'components/BadgeShelf.tsx', 'lib/giveaway.ts', 'lib/streakTiers.ts']) expect(read(f), f).not.toMatch(/gasChallenge|challenge_/i);
  });
  it('the client can never choose a challenge, points or a key anywhere', () => {
    expect(code('app/api/gaspoints/explore/route.ts')).toMatch(/ALLOWED_KEYS = new Set\(\['grade'\]\)/);
    expect(code('app/api/gaspoints/daily-check/route.ts')).toMatch(/ALLOWED_KEYS = new Set\(\['grade'\]\)/);
    expect(code('lib/gasChallengeAwards.ts')).not.toMatch(/req\.|request\.|searchParams|body\./);
  });
  it('rewards come from the server rule table; only challenge-selection-gated helpers write them', () => {
    for (const a of ['challenge_weekend_check', 'challenge_fuel_explorer', 'challenge_pump_tracker', 'challenge_mpg_builder']) expect(isGasPointAction(a)).toBe(true);
    expect(GASPOINT_RULES.challenge_weekend_check + GASPOINT_RULES.challenge_fuel_explorer + GASPOINT_RULES.challenge_pump_tracker).toBe(50);
    expect(code('lib/gasChallengeAwards.ts')).toMatch(/\.slot2 !== 'weekend_check'/);
    expect(code('lib/gasChallengeAwards.ts')).toMatch(/\.slot2 !== 'fuel_explorer'/);
    expect(code('lib/gasChallengeAwards.ts')).toMatch(/\.slot3 !== 'pump_tracker'/);
    expect(code('lib/gasChallengeAwards.ts')).toMatch(/isG2Active\(weekKey\)/);
  });
  it('no schema, migration or challenge table; no gating by browser time', () => {
    expect(read('prisma/schema.prisma')).not.toMatch(/model\s+\w*Challenge\w*/i);
    expect(read('lib/gasChallengesRules.ts')).not.toMatch(/localStorage|navigator|Intl\./);
  });
  it('G1 daily-check and fuel-action rules are untouched', () => {
    expect(GASPOINT_RULES).toMatchObject({ welcome_bonus: 25, daily_fuel_check: 5, weekly_3day_check: 25, first_vehicle: 25, first_saved_station: 20, fuel_action: 50 });
    expect(read('lib/gasPoints.ts')).not.toMatch(/gasChallenge|challenge_/i);
  });
});

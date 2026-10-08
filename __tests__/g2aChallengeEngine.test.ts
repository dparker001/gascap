/**
 * Gamification G2-A — weekly challenge selection + progress engine (READ-ONLY).
 * Covers deterministic selection, the three slots, authoritative progress, the
 * honest "tracking unavailable" boundary, the read-only/session-only API, G1
 * separation and canonical-calendar reuse.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

// ── read-only in-memory prisma (NO write methods exist: a write would throw) ──
interface Row { userId: string; action: string; sourceRef: string | null; idempotencyKey: string }
const state = {
  ledger: [] as Row[],
  users: new Map<string, { role: string; isTestAccount: boolean }>(),
  vehicles: new Map<string, number>(),
  queries: [] as { model: string; userId?: string }[],
};
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: async ({ where }: { where: { id: string } }) => state.users.get(where.id) ?? null },
    gasPointLedger: {
      findMany: async ({ where }: { where: { userId: string; action: { in: string[] }; sourceRef: { in: string[] } } }) => {
        state.queries.push({ model: 'ledger', userId: where.userId });
        return state.ledger
          .filter((r) => r.userId === where.userId && where.action.in.includes(r.action) && r.sourceRef && where.sourceRef.in.includes(r.sourceRef))
          .map((r) => ({ action: r.action, sourceRef: r.sourceRef }));
      },
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
        state.ledger.find((r) => r.idempotencyKey === where.idempotencyKey) ? { id: 'x' } : null,
    },
    vehicle: { count: async ({ where }: { where: { userId: string } }) => state.vehicles.get(where.userId) ?? 0 },
    fillup: { count: async () => 0 },
  },
}));

import {
  G2_CHALLENGE_VERSION, SLOT2_POOL, MPG_BUILDER_SELECTABLE, PLANNED_REWARDS, PLANNED_G2B_HOOKS, AWARDABLE_CHALLENGES,
  selectWeeklyChallenges, buildWeeklyChallengeViews, challengeView, isWeekendDateKey, stableHash32, challengeIdempotencyKey,
  type ProgressContext, type SelectionInput,
} from '../lib/gasChallengesRules';
import { getWeeklyChallenges } from '../lib/gasChallenges';
import { GASPOINT_RULES, GASPOINT_LEVELS, isGasPointAction, gasPointKeys } from '../lib/gasPointsRules';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const code = (p: string) => read(p).split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
const NEW_FILES = ['lib/gasChallengesRules.ts', 'lib/gasChallenges.ts', 'app/api/gaspoints/challenges/route.ts'];

const W = '2026-10-05';                       // Monday
const sel = (over: Partial<SelectionInput> = {}) =>
  selectWeeklyChallenges({ userId: 'u1', weekKey: W, hasVehicle: true, pumpTrackerComplete: false, mpgBuilderAvailable: false, ...over });
const ctx = (over: Partial<ProgressContext> = {}): ProgressContext => ({ weekKey: W, checkDates: [], weeklyMissionAwarded: false, challengeAwards: [], ...over });
const ids = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

beforeEach(() => {
  state.ledger = []; state.queries = [];
  state.users = new Map([['u1', { role: 'user', isTestAccount: false }], ['adm', { role: 'admin', isTestAccount: false }], ['qa', { role: 'user', isTestAccount: true }]]);
  state.vehicles = new Map();
});

// ── deterministic selection ─────────────────────────────────────────────────
describe('deterministic selection', () => {
  it('same user + week + version gives the same set, every time', () => {
    const a = sel(); for (let i = 0; i < 50; i++) expect(sel()).toEqual(a);
    expect(a.version).toBe(G2_CHALLENGE_VERSION);
    expect(G2_CHALLENGE_VERSION).toBe('g2_v1');
  });
  it('slot 2 is stable for the week regardless of the user state', () => {
    const base = sel({ hasVehicle: false }).slot2;
    for (const s of [{ hasVehicle: true }, { pumpTrackerComplete: true }, { mpgBuilderAvailable: true }]) expect(sel(s).slot2).toBe(base);
  });
  it('slot 2 comes only from the pool and the hash is a pure function', () => {
    expect(SLOT2_POOL).toEqual(['weekend_check', 'fuel_explorer']);
    expect(stableHash32('a', 'b')).toBe(stableHash32('a', 'b'));
    expect(stableHash32('a', 'b')).not.toBe(stableHash32('a', 'c'));
    for (let i = 0; i < 200; i++) expect(SLOT2_POOL).toContain(sel({ userId: `user-${i}` }).slot2);
  });
  it('a new Monday changes the selection input (some users re-roll)', () => {
    const users = ids(300, (i) => `u${i}`);
    const changed = users.filter((u) => sel({ userId: u, weekKey: '2026-10-05' }).slot2 !== sel({ userId: u, weekKey: '2026-10-12' }).slot2);
    expect(changed.length).toBeGreaterThan(60);
    expect(changed.length).toBeLessThan(240);
  });
  it('a different version is a different deterministic namespace', () => {
    const users = ids(300, (i) => `u${i}`);
    const changed = users.filter((u) => sel({ userId: u, version: 'g2_v1' }).slot2 !== sel({ userId: u, version: 'g2_v2' }).slot2);
    expect(changed.length).toBeGreaterThan(60);
    expect(sel({ version: 'g2_v2' }).version).toBe('g2_v2');
  });
  it('the pool is split roughly evenly across users', () => {
    const n = ids(1000, (i) => `user-${i}`).filter((u) => sel({ userId: u }).slot2 === 'weekend_check').length;
    expect(n).toBeGreaterThan(400); expect(n).toBeLessThan(600);
  });
  it('no randomness, client storage or assignment table anywhere in the engine', () => {
    for (const f of NEW_FILES) expect(code(f), f).not.toMatch(/Math\.random|getRandomValues|randomUUID|localStorage|sessionStorage|document\./);
  });
});

// ── slot 1 ──────────────────────────────────────────────────────────────────
describe('slot 1 — the existing G1 weekly mission', () => {
  it('is always fuel_check_3day and returns exactly three slots', () => {
    for (const s of [{ hasVehicle: false }, { hasVehicle: true }, { pumpTrackerComplete: true }]) {
      expect(sel(s).slot1).toBe('fuel_check_3day');
      expect(buildWeeklyChallengeViews(sel(s), ctx())).toHaveLength(3);
    }
    expect(buildWeeklyChallengeViews(sel(), ctx()).map((v) => v.slot)).toEqual([1, 2, 3]);
  });
  it('progress counts DISTINCT daily-check dates, capped at 3', () => {
    const v = (c: Partial<ProgressContext>) => challengeView(1, 'fuel_check_3day', ctx(c));
    expect(v({})).toMatchObject({ status: 'available', progress: 0, target: 3 });
    expect(v({ checkDates: ['2026-10-06'] })).toMatchObject({ progress: 1 });
    expect(v({ checkDates: ['2026-10-06', '2026-10-06', '2026-10-06'] })).toMatchObject({ progress: 1, status: 'available' });
    expect(v({ checkDates: ['2026-10-06', '2026-10-07'] })).toMatchObject({ progress: 2 });
    expect(v({ checkDates: ['2026-10-06', '2026-10-07', '2026-10-08'] })).toMatchObject({ status: 'complete', progress: 3 });
    expect(v({ checkDates: ids(7, (i) => `2026-10-0${5 + i > 9 ? 9 : 5 + i}-${i}`) }).progress).toBe(3);
  });
  it('is complete once the G1 weekly_3day_check row exists, even if dates are missing', () => {
    expect(challengeView(1, 'fuel_check_3day', ctx({ weeklyMissionAwarded: true }))).toMatchObject({ status: 'complete', progress: 3 });
  });
  it('reuses the existing G1 reward — no second 3-day mission or new action', () => {
    const v = challengeView(1, 'fuel_check_3day', ctx());
    expect(v).toMatchObject({ rewardAction: 'weekly_3day_check', proposedReward: 25, rewardIsExistingG1: true, trackingCapability: 'ledger_derived' });
    expect(isGasPointAction('weekly_3day_check')).toBe(true);
    expect(GASPOINT_RULES.weekly_3day_check).toBe(25);
  });
});

// ── weekend check ───────────────────────────────────────────────────────────
describe('Weekend Check', () => {
  it('the weekend date helper recognises Saturday/Sunday (the QUALIFICATION rule, not the completion record)', () => {
    expect(isWeekendDateKey('2026-10-10')).toBe(true);    // Saturday
    expect(isWeekendDateKey('2026-10-11')).toBe(true);    // Sunday
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) expect(isWeekendDateKey(d)).toBe(false);
    expect(isWeekendDateKey('garbage')).toBe(false);
  });
  it('a Sat/Sun daily check WITHOUT the award row is NOT complete — only the challenge award row is', () => {
    const v = (dates: string[], awards: string[] = []) => challengeView(2, 'weekend_check', ctx({ checkDates: dates, challengeAwards: awards }));
    expect(v(['2026-10-06', '2026-10-07', '2026-10-09'])).toMatchObject({ status: 'available', progress: 0, target: 1 });
    expect(v(['2026-10-06', '2026-10-10'])).toMatchObject({ status: 'available', progress: 0, target: 1 });   // Saturday check, no award
    expect(v(['2026-10-11'])).toMatchObject({ status: 'available', progress: 0, target: 1 });                // Sunday check, no award
    expect(v(['2026-10-06'], ['challenge_weekend_check'])).toMatchObject({ status: 'complete', progress: 1, target: 1 });   // award row alone completes it
  });
  it('+10 via its own award action; server-authoritative; the award row completes it', () => {
    expect(challengeView(2, 'weekend_check', ctx())).toMatchObject({ proposedReward: 10, rewardAction: 'challenge_weekend_check', rewardIsExistingG1: false, trackingCapability: 'server_authoritative' });
    expect(challengeView(2, 'weekend_check', ctx({ challengeAwards: ['challenge_weekend_check'] }))).toMatchObject({ status: 'complete', progress: 1 });
  });
});

// ── fuel explorer (G2-B: server-authoritative once its hook exists) ─────────
describe('Fuel Explorer — authoritative via POST /api/gaspoints/explore', () => {
  it('is available/0-of-1 until its award row exists, then complete — never inferred from GETs', () => {
    expect(challengeView(2, 'fuel_explorer', ctx({ checkDates: ['2026-10-06', '2026-10-07', '2026-10-08'] })))
      .toMatchObject({ status: 'available', progress: 0, target: 1, trackingCapability: 'server_authoritative', proposedReward: 15 });
    expect(challengeView(2, 'fuel_explorer', ctx({ challengeAwards: ['challenge_fuel_explorer'] }))).toMatchObject({ status: 'complete', progress: 1 });
  });
  it('slot 2 can select it', () => {
    const user = ids(200, (i) => `x${i}`).find((u) => sel({ userId: u }).slot2 === 'fuel_explorer') as string;
    expect(buildWeeklyChallengeViews(sel({ userId: user }), ctx())[1]).toMatchObject({ id: 'fuel_explorer', status: 'available' });
  });
  it('the hook is implemented as the reviewed authoritative POST route', () => {
    expect(PLANNED_G2B_HOOKS.find((h) => h.challenge === 'fuel_explorer')?.trigger).toMatch(/POST \/api\/gaspoints\/explore/);
    expect(read('app/api/gaspoints/explore/route.ts')).toMatch(/export async function POST/);
    // the read model and the GET route still never complete anything
    expect(code('lib/gasChallenges.ts') + code('app/api/gaspoints/challenges/route.ts')).not.toMatch(/awardFuelExplorer|awardOnce/);
  });
});

// ── slot 3 ──────────────────────────────────────────────────────────────────
describe('slot 3 — state-sensitive', () => {
  it('no vehicle -> add_vehicle guidance with NO new reward (existing G1 first_vehicle only)', () => {
    const s = sel({ hasVehicle: false });
    expect(s.slot3).toBe('add_vehicle');
    const v = buildWeeklyChallengeViews(s, ctx())[2];
    expect(v).toMatchObject({ id: 'add_vehicle', status: 'guidance', progress: null, proposedReward: null, rewardAction: 'first_vehicle', rewardIsExistingG1: true, trackingCapability: 'guidance' });
    expect(Object.keys(PLANNED_REWARDS)).not.toContain('add_vehicle');
  });
  it('vehicle -> Pump Tracker (+25); its award row completes it', () => {
    expect(sel({ hasVehicle: true }).slot3).toBe('pump_tracker');
    expect(challengeView(3, 'pump_tracker', ctx())).toMatchObject({ status: 'available', progress: 0, target: 1, proposedReward: 25, rewardAction: 'challenge_pump_tracker', trackingCapability: 'server_authoritative' });
    expect(challengeView(3, 'pump_tracker', ctx({ challengeAwards: ['challenge_pump_tracker'] }))).toMatchObject({ status: 'complete', progress: 1 });
    expect(challengeView(3, 'pump_tracker', ctx({ challengeAwards: ['challenge_pump_tracker', 'challenge_pump_tracker'] }))).toMatchObject({ progress: 1 });   // capped at the target
  });
  it('slot 3 may change when the real state changes (owner-approved), no persistence', () => {
    expect(sel({ hasVehicle: false }).slot3).toBe('add_vehicle');
    expect(sel({ hasVehicle: true }).slot3).toBe('pump_tracker');
  });
  it('a completed Pump Tracker never disappears, even if the vehicle is later removed', () => {
    expect(sel({ hasVehicle: false, pumpTrackerComplete: true }).slot3).toBe('pump_tracker');
  });
  it('slots 1 and 2 never need a fuel purchase', () => {
    for (const hasVehicle of [false, true]) {
      const v = buildWeeklyChallengeViews(sel({ hasVehicle }), ctx());
      expect(['fuel_check_3day']).toContain(v[0].id);
      expect(['weekend_check', 'fuel_explorer']).toContain(v[1].id);
    }
  });
});

// ── MPG Builder ─────────────────────────────────────────────────────────────
describe('MPG Builder — tracking decision', () => {
  it('cannot be derived authoritatively, so it is never offered in g2_v1', () => {
    expect(MPG_BUILDER_SELECTABLE).toBe(false);
    for (const u of ids(100, (i) => `m${i}`)) expect(sel({ userId: u, mpgBuilderAvailable: true }).slot3).not.toBe('mpg_builder');
  });
  it('the catalog understands it but reports tracking unavailable, never a guessed completion', () => {
    expect(challengeView(3, 'mpg_builder', ctx({ challengeAwards: ['challenge_pump_tracker'] }))).toMatchObject({
      status: 'tracking_unavailable', progress: null, trackingCapability: 'requires_g2b_hook', proposedReward: 30, rewardAction: 'challenge_mpg_builder',
    });
  });
  it('the reason is documented in the engine and the hook is designed for CREATE time only', () => {
    expect(read('lib/gasChallengesRules.ts')).toMatch(/back-dated, edited \(PATCH\) or deleted/);
    expect(PLANNED_G2B_HOOKS.find((h) => h.challenge === 'mpg_builder')?.note).toMatch(/CREATE-time check/);
  });
});

// ── read model (fake read-only prisma) ──────────────────────────────────────
const led = (userId: string, action: string, sourceRef: string | null, key?: string): Row =>
  ({ userId, action, sourceRef, idempotencyKey: key ?? `${action}:${userId}:${sourceRef}` });

describe('getWeeklyChallenges (authoritative reads, G2-active weeks)', () => {
  // The first rewardable GasCap week is Monday 2026-10-12.
  const MON = new Date('2026-10-12T16:00:00Z');
  const FRI = new Date('2026-10-16T16:00:00Z');
  const WK = '2026-10-12';

  it('derives progress from the ledger for the CURRENT GasCap week only', async () => {
    state.vehicles.set('u1', 1);
    state.ledger.push(
      led('u1', 'daily_fuel_check', '2026-10-13'), led('u1', 'daily_fuel_check', '2026-10-14'),
      led('u1', 'daily_fuel_check', '2026-10-07'),                 // previous week — ignored
      led('u1', 'challenge_pump_tracker', WK),
    );
    const r = await getWeeklyChallenges('u1', FRI);
    expect(r).toMatchObject({ eligible: true, g2Active: true, weekKey: WK, version: 'g2_v1' });
    expect(r.challenges[0]).toMatchObject({ id: 'fuel_check_3day', progress: 2, status: 'available' });
    expect(r.challenges[2]).toMatchObject({ id: 'pump_tracker', status: 'complete', progress: 1 });
  });
  it('the weekly_3day_check row marks slot 1 complete', async () => {
    state.ledger.push(led('u1', 'weekly_3day_check', WK, gasPointKeys.weekly('u1', WK)));
    expect((await getWeeklyChallenges('u1', FRI)).challenges[0]).toMatchObject({ status: 'complete', progress: 3 });
  });
  it('slot 3 follows the real vehicle state within the same week', async () => {
    expect((await getWeeklyChallenges('u1', MON)).challenges[2].id).toBe('add_vehicle');
    state.vehicles.set('u1', 1);
    expect((await getWeeklyChallenges('u1', FRI)).challenges[2].id).toBe('pump_tracker');
  });
  it('uses the canonical GasCap week: Sunday night is still last week, Eastern midnight rolls over', async () => {
    state.ledger.push(led('u1', 'daily_fuel_check', '2026-10-13'));
    const sunNight = await getWeeklyChallenges('u1', new Date('2026-10-19T03:59:00Z'));     // Sun Oct 18 11:59 PM EDT
    const monMidnight = await getWeeklyChallenges('u1', new Date('2026-10-19T04:00:00Z'));  // Mon Oct 19 midnight EDT
    expect(sunNight.weekKey).toBe(WK);
    expect(sunNight.challenges[0].progress).toBe(1);
    expect(monMidnight.weekKey).toBe('2026-10-19');
    expect(monMidnight.challenges[0].progress).toBe(0);          // a new Monday starts fresh
  });
  it('is stable across repeated reads (same set all week)', async () => {
    const a = await getWeeklyChallenges('u1', MON); const b = await getWeeklyChallenges('u1', FRI);
    expect(a.challenges[1].id).toBe(b.challenges[1].id);
  });
  it('admin accounts are not eligible; the test account is', async () => {
    expect(await getWeeklyChallenges('adm', MON)).toMatchObject({ eligible: false, g2Active: false, challenges: [] });
    expect((await getWeeklyChallenges('qa', MON)).eligible).toBe(true);
  });
  it('reads only the requested user (no cross-user data)', async () => {
    state.ledger.push(led('qa', 'daily_fuel_check', '2026-10-13'));
    state.queries = [];
    const r = await getWeeklyChallenges('u1', MON);
    expect(r.challenges[0].progress).toBe(0);
    expect(state.queries.every((q) => q.userId === 'u1')).toBe(true);
  });
  it('BEFORE the launch week nothing is active: no challenges are returned (G1 unaffected)', async () => {
    state.vehicles.set('u1', 1);
    const r = await getWeeklyChallenges('u1', new Date('2026-10-09T16:00:00Z'));
    expect(r).toMatchObject({ eligible: true, g2Active: false, startsOn: '2026-10-12', weekKey: '2026-10-05', challenges: [] });
    expect(state.queries).toHaveLength(0);           // no week state was even loaded
  });
});

// ── API ─────────────────────────────────────────────────────────────────────
const getServerSession = vi.fn(async (..._a: unknown[]) => null as unknown);
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

describe('GET /api/gaspoints/challenges', () => {
  async function get() {
    vi.resetModules();
    const { GET } = await import('../app/api/gaspoints/challenges/route');
    return GET();
  }
  it('requires authentication', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(state.queries).toHaveLength(0);
  });
  it('uses the SESSION user only and returns the week, version and three challenges', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T16:00:00Z'));       // inside the first G2-active week
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    state.vehicles.set('u1', 1);
    const res = await get();
    vi.useRealTimers();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ eligible: true, g2Active: true, version: 'g2_v1', startsOn: '2026-10-12' });
    expect(body.weekKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.challenges).toHaveLength(3);
    expect(state.queries.every((q) => q.userId === 'u1')).toBe(true);
  });
  it('accepts no client input: the handler takes no request and the client cannot pick challenges', () => {
    const src = code('app/api/gaspoints/challenges/route.ts');
    expect(src).toMatch(/export async function GET\(\)/);
    expect(src).not.toMatch(/searchParams|req\.|request\.|\.json\(\)|\.text\(\)/);
    expect(src).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });
  it('admin sessions get eligible:false', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'adm' } });
    expect((await (await get()).json())).toMatchObject({ eligible: false, challenges: [] });
  });
  it('makes no writes: the fake prisma has no write methods, and the sources contain none', () => {
    for (const f of NEW_FILES) {
      // any prisma write (the SHA-256 `.update()` used for hashing is not a database call)
      expect(code(f), f).not.toMatch(/prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$queryRaw|\$transaction/);
      expect(code(f), f).not.toMatch(/awardOnce|completeDailyCheck|award[A-Z]\w*\(|recordAnalyticsEvent|recordActivity|trackClientEvent/);
    }
  });
});

// ── separation / G1 preserved ───────────────────────────────────────────────
describe('G1 preserved, no new schema, no parallel systems', () => {
  it('G1 rules and levels are unchanged (G2-B only ADDED four challenge actions)', () => {
    expect(GASPOINT_RULES).toMatchObject({ welcome_bonus: 25, daily_fuel_check: 5, weekly_3day_check: 25, first_vehicle: 25, first_saved_station: 20, fuel_action: 50 });
    expect(GASPOINT_LEVELS.map((l) => [l.id, l.min])).toEqual([['starter', 0], ['road_ready', 100], ['fuel_smart', 250], ['smart_saver', 500], ['gascap_elite', 1000]]);
  });
  it('challenge rewards match the rule table; MPG Builder has a rule but NO award path', () => {
    expect(GASPOINT_RULES).toMatchObject({ challenge_weekend_check: 10, challenge_fuel_explorer: 15, challenge_pump_tracker: 25, challenge_mpg_builder: 30 });
    for (const [id, r] of Object.entries(PLANNED_REWARDS)) expect(GASPOINT_RULES[r.action as keyof typeof GASPOINT_RULES], id).toBe(r.points);
    expect(AWARDABLE_CHALLENGES).toEqual(['weekend_check', 'fuel_explorer', 'pump_tracker']);
    expect(MPG_BUILDER_SELECTABLE).toBe(false);
    expect(code('lib/gasChallengeAwards.ts')).not.toMatch(/awardChallenge\(userId, 'mpg_builder'/);
  });
  it('no engine file touches badges, streak, giveaway or the badge shelf', () => {
    for (const f of NEW_FILES) expect(code(f), f).not.toMatch(/badges|BadgeShelf|giveaway|activeDays|gigLogEntries|bonusEntries|Entries\b|streak\s*:\s*\{|recordActivity/i);
    for (const f of ['lib/badges.ts', 'components/BadgeShelf.tsx']) expect(read(f), f).not.toMatch(/challenge|gasChallenge/i);
  });
  it('no schema or migration changes, and no challenge table', () => {
    expect(read('prisma/schema.prisma')).not.toMatch(/model\s+\w*Challenge\w*/i);
    expect(readdirSync(path.join(root, 'scripts')).filter((f) => /challenge/i.test(f))).toEqual([]);
  });
  it('the G1 award modules are untouched by challenge logic (it lives in its own module)', () => {
    expect(read('lib/gasPoints.ts')).not.toMatch(/gasChallenge|challenge_/i);
  });
  it('the calendar is the canonical GasCap module, not re-implemented', () => {
    expect(read('lib/gasChallenges.ts')).toMatch(/from '\.\/gasCapCalendar'/);
    for (const f of NEW_FILES) expect(code(f), f).not.toMatch(/America\/New_York|Intl\.DateTimeFormat|getTimezoneOffset|toLocale(Date|Time)String/);
  });
  it('the future idempotency identity cannot collide with any G1 key and fits the global unique column', () => {
    const k = challengeIdempotencyKey('pump_tracker', 'user-1', '2026-10-05');
    expect(k).toBe('challenge:pump_tracker:user-1:2026-10-05');
    const g1 = [gasPointKeys.welcome('u'), gasPointKeys.dailyCheck('u', '2026-10-05'), gasPointKeys.weekly('u', '2026-10-05'),
      gasPointKeys.firstVehicle('u'), gasPointKeys.firstStation('u'), gasPointKeys.fuelAction('u', '2026-10-05')];
    for (const key of g1) expect(key.startsWith('challenge:')).toBe(false);
    expect(new Set([...g1, k]).size).toBe(g1.length + 1);
    expect(k.length).toBeLessThan(200);
  });
});

/**
 * PR #62 finding 2 — derived lifecycle states refresh at their time
 * boundaries and on foreground resume, without polling or network calls.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { resolveRentalLifecycle, nextRentalBoundaryMs, type RentalLifecycle } from '@/lib/rentalCalculations';
import { nextWakeMs, MAX_TIMER_MS, SLACK_MS, createRentalClock } from '@/lib/rentalClockController';
import type { RentalSession } from '@/lib/rentalSessions';

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const P = Date.parse('2026-10-10T14:00:00Z');
const R = P + 72 * H;
const input = (over: Record<string, unknown> = {}) => ({
  status: 'active', pickupDateTime: null, returnDateTime: null,
  pickupDateTimeUtc: iso(P), returnDateTimeUtc: iso(R), setupComplete: false, ...over,
}) as Parameters<typeof resolveRentalLifecycle>[0];

describe('nextRentalBoundaryMs', () => {
  it('walks the six boundaries in order, then returns null', () => {
    const b = [P - 3 * H, P, P + 6 * H, R - 24 * H, R, R + 72 * H];
    let now = P - 100 * H;
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) { const n = nextRentalBoundaryMs(input(), now); if (n === null) break; seen.push(n); now = n; }
    expect(seen).toEqual(b);
    expect(nextRentalBoundaryMs(input(), R + 72 * H)).toBeNull();
  });
  it('is strictly after `now` (an instant exactly on a boundary advances to the next one)', () => {
    expect(nextRentalBoundaryMs(input(), P - 3 * H)).toBe(P);
    expect(nextRentalBoundaryMs(input(), P - 3 * H - 1)).toBe(P - 3 * H);
  });
  it('closed rentals and malformed schedules never schedule anything', () => {
    expect(nextRentalBoundaryMs(input({ status: 'completed' }), P - 100 * H)).toBeNull();
    expect(nextRentalBoundaryMs(input({ status: 'cancelled' }), P - 100 * H)).toBeNull();
    expect(nextRentalBoundaryMs(input({ returnDateTimeUtc: iso(P - H) }), P - 100 * H)).toBeNull();   // inconsistent
    expect(nextRentalBoundaryMs(input({ returnDateTimeUtc: 'garbage' }), P - 100 * H)).toBeNull();     // invalid
  });
  it('missing times schedule only what is known', () => {
    expect(nextRentalBoundaryMs(input({ returnDateTimeUtc: null }), P - 100 * H)).toBe(P - 3 * H);
    expect(nextRentalBoundaryMs(input({ pickupDateTimeUtc: null }), P - 100 * H)).toBe(R - 24 * H);
    expect(nextRentalBoundaryMs(input({ pickupDateTimeUtc: null, returnDateTimeUtc: null }), 0)).toBeNull();
  });

  // The property that makes timers sufficient: between two consecutive
  // boundaries the lifecycle state NEVER changes, so re-evaluating only at
  // boundaries can never miss a transition.
  it('PROPERTY: the state is constant between boundaries, for both setup states and a short rental', () => {
    for (const over of [{ setupComplete: false }, { setupComplete: true }, { setupComplete: undefined },
      { setupComplete: false, returnDateTimeUtc: iso(P + 2 * H) }, { setupComplete: true, returnDateTimeUtc: iso(P + 23 * H) }]) {
      const inp = input(over);
      let now = P - 10 * H;
      const stateAt = (t: number): RentalLifecycle => resolveRentalLifecycle({ ...inp, now: t });
      for (let guard = 0; guard < 12; guard++) {
        const next = nextRentalBoundaryMs(inp, now);
        if (next === null) break;
        const before = stateAt(now);
        // sample the whole open interval [now, next): first ms, a few interior points, last ms
        for (const t of [now, now + 1, now + Math.floor((next - now) / 3), now + Math.floor((next - now) / 2), next - 1]) {
          if (t >= now && t < next) expect(stateAt(t), `over=${JSON.stringify(over)} t=${t - P}`).toBe(before);
        }
        now = next;
      }
    }
  });
  it('PROPERTY: the state can only change AT a boundary (the new state is already in force at it)', () => {
    const inp = input();
    const bounds = [P - 3 * H, P, P + 6 * H, R - 24 * H, R, R + 72 * H];
    const st = (t: number) => resolveRentalLifecycle({ ...inp, now: t });
    expect(bounds.map((b) => [st(b - 1), st(b)])).toEqual([
      ['upcoming', 'pickup'], ['pickup', 'pickup'], ['pickup', 'active'], ['active', 'near_return'], ['near_return', 'overdue'], ['overdue', 'stale'],
    ]);
  });
});

describe('nextWakeMs across several rentals', () => {
  const mk = (id: string, p: number, r: number): RentalSession => ({
    id, status: 'active', pickupDateTime: null, returnDateTime: null, pickupDateTimeUtc: iso(p), returnDateTimeUtc: iso(r),
    vehicleMake: null, vehicleModel: null, fuelTankCapacityGallons: null, pickupFuelGallons: null, currentFuelGallons: null,
    requiredReturnFuelGallons: null, pickupTimeZone: null, returnTimeZone: null, timeZone: null,
  } as unknown as RentalSession);
  it('wakes for the EARLIEST boundary of any rental, null when none remain', () => {
    const a = mk('a', P, R), b = mk('b', P + 500 * H, P + 600 * H);
    expect(nextWakeMs([b, a], P - 50 * H)).toBe(P - 3 * H);
    expect(nextWakeMs([a, b], R + 100 * H)).toBe(P + 500 * H - 3 * H);
    expect(nextWakeMs([a], R + 100 * H)).toBeNull();
    expect(nextWakeMs([], 0)).toBeNull();
  });
  it('the timer cap is setTimeout’s 32-bit limit', () => { expect(MAX_TIMER_MS).toBe(2 ** 31 - 1); });
});

describe('createRentalClock — the controller behind the hook (fake clock + fake timers)', () => {
  const mk = (id: string, p: number, r: number): RentalSession => ({
    id, status: 'active', pickupDateTime: null, returnDateTime: null, pickupDateTimeUtc: iso(p), returnDateTimeUtc: iso(r),
    vehicleMake: null, vehicleModel: null, fuelTankCapacityGallons: null, pickupFuelGallons: null, currentFuelGallons: null,
    requiredReturnFuelGallons: null, pickupTimeZone: null, returnTimeZone: null, timeZone: null,
  } as unknown as RentalSession);

  function harness(start: number, sessions: RentalSession[]) {
    const h = { t: start, sessions, nowSeen: [] as number[], timers: new Map<number, { fn: () => void; ms: number }>(), nextId: 1, cleared: 0 };
    const clock = createRentalClock({
      now: () => h.t, setNow: (n) => h.nowSeen.push(n), getSessions: () => h.sessions,
      setTimer: (fn, ms) => { const id = h.nextId++; h.timers.set(id, { fn, ms }); return id; },
      clearTimer: (id) => { if (h.timers.delete(id as number)) h.cleared += 1; },
    });
    return { h, clock };
  }

  it('start() refreshes now immediately and arms exactly one timer for the earliest boundary (+ slack)', () => {
    const { h, clock } = harness(P - 50 * H, [mk('a', P, R)]);
    clock.start();
    expect(h.nowSeen).toEqual([P - 50 * H]);
    expect([...h.timers.values()].map((t) => t.ms)).toEqual([47 * H + SLACK_MS]);
  });
  it('a fired timer refreshes now and re-arms for the NEXT boundary', () => {
    const { h, clock } = harness(P - 50 * H, [mk('a', P, R)]);
    clock.start();
    h.t = P - 3 * H + SLACK_MS;
    const [firedId, fired] = [...h.timers.entries()][0];
    h.timers.delete(firedId);                                         // a timer that fires is consumed
    fired.fn();
    expect(h.nowSeen.at(-1)).toBe(P - 3 * H + SLACK_MS);
    expect(h.timers.size).toBe(1);                                    // exactly one new timer…
    expect([...h.timers.values()][0].ms).toBe(3 * H - SLACK_MS + SLACK_MS);   // …for pickup (3h − 250ms away, + slack)
  });
  it('EDIT AFTER A LONG IDLE: timers never fired (frozen), the clock jumped 10 days, then the schedule is edited — now refreshes immediately and re-arms from the CURRENT time', () => {
    const edited = mk('a', P + 15 * 24 * H, P + 18 * 24 * H);          // moved well into the future
    const { h, clock } = harness(P - 50 * H, [mk('a', P, R)]);
    clock.start();
    const staleTimer = [...h.timers.keys()][0];
    h.t = P - 50 * H + 10 * 24 * H;                                    // 10 days later; nothing fired
    h.sessions = [edited];
    // what the hook's effect does when scheduleKey changes: stop the old clock, start a new one
    clock.stop();
    expect(h.timers.has(staleTimer)).toBe(false);                      // the stale timer is gone
    const next = createRentalClock({
      now: () => h.t, setNow: (n) => h.nowSeen.push(n), getSessions: () => h.sessions,
      setTimer: (fn, ms) => { const id = h.nextId++; h.timers.set(id, { fn, ms }); return id; }, clearTimer: (id) => { h.timers.delete(id as number); },
    });
    next.start();
    expect(h.nowSeen.at(-1)).toBe(h.t);                                // refreshed IMMEDIATELY, not at the next boundary
    // armed relative to the new "now": the edited pickup − 3h is 15d − 3h − (10d − 50h) ahead
    const expectedMs = (P + 15 * 24 * H - 3 * H) - h.t + SLACK_MS;
    expect([...h.timers.values()].map((t) => t.ms)).toEqual([expectedMs]);
  });
  it('PROPERTY: for any "now" and any edited schedule the delay is always within [slack, 32-bit max] — never negative or stale', () => {
    const { h, clock } = harness(0, [mk('a', P, R)]);
    for (const now of [P - 400 * H, P - 3 * H - 1, P - 3 * H, P, P + 6 * H, R - 24 * H, R - 1, R, R + 72 * H - 1, P - 5000 * 24 * H]) {
      for (const edit of [mk('a', P, R), mk('a', P - 10 * H, R), mk('a', P + 15 * 24 * H, R + 18 * 24 * H), mk('a', P, R + 400 * H)]) {
        h.t = now; h.sessions = [edit]; h.timers.clear();
        clock.start();
        for (const t of h.timers.values()) { expect(t.ms).toBeGreaterThanOrEqual(SLACK_MS); expect(t.ms).toBeLessThanOrEqual(MAX_TIMER_MS); }
      }
    }
  });
  it('a schedule edit replaces the timer: one timer at a time, the previous one cleared', () => {
    const { h, clock } = harness(P - 50 * H, [mk('a', P, R)]);
    clock.start(); clock.start(); clock.start();
    expect(h.timers.size).toBe(1);
    expect(h.cleared).toBe(2);
  });
  it('nothing to flip (closed rental / none left) → no timer at all', () => {
    const { h, clock } = harness(R + 100 * H, [mk('a', P, R)]);
    clock.start();
    expect(h.timers.size).toBe(0);
  });
  it('refresh() on resume re-reads the clock and re-arms; stop() silences everything', () => {
    const { h, clock } = harness(P - 50 * H, [mk('a', P, R)]);
    clock.start();
    h.t += 2 * H;
    clock.refresh();
    expect(h.nowSeen.at(-1)).toBe(h.t);
    clock.stop();
    const before = h.nowSeen.length;
    clock.refresh(); clock.start();
    expect(h.nowSeen.length).toBe(before);                              // stopped: no more updates
    expect(h.timers.size).toBe(0);
  });
  it('a far-future boundary is clamped to the 32-bit timer limit', () => {
    const { h, clock } = harness(P - 5000 * 24 * H, [mk('a', P, R)]);
    clock.start();
    expect([...h.timers.values()][0].ms).toBe(MAX_TIMER_MS);
  });
});

describe('hook wiring (source guards): no polling, no network, immediate refresh on schedule change', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
  const hook = read('hooks/useRentalClock.ts');
  const core = read('lib/rentalClockController.ts');
  it('one setTimeout re-armed per boundary — never setInterval, never fetch', () => {
    expect(core).toContain('d.setTimer(');
    expect(hook).toContain('setTimeout(fn, ms)');
    for (const src of [hook, core]) expect(src).not.toMatch(/setInterval\(|fetch\(|XMLHttpRequest|axios/);
  });
  it('clamps the delay to the 32-bit limit and schedules nothing when no boundary remains', () => {
    expect(core).toMatch(/Math\.min\(MAX_TIMER_MS/);
    expect(core).toMatch(/if \(boundary === null\) return;/);
  });
  it('the effect restarts on every schedule change and start() refreshes now immediately', () => {
    expect(hook).toMatch(/\}, \[scheduleKey\]\);/);
    expect(hook).toContain('clock.start();');
    expect(core).toMatch(/start\(\) \{ if \(stopped\) return; d\.setNow\(d\.now\(\)\); arm\(\); \}/);
  });
  it('re-reads the clock on foreground resume (visibilitychange, pageshow, focus) and cleans up', () => {
    for (const ev of ["'visibilitychange'", "'pageshow'", "'focus'"]) expect(hook).toContain(ev);
    expect(hook).toContain("removeEventListener('visibilitychange'");
    expect(hook).toContain('clock.stop();');
  });
  it('the dashboard, My Rentals list and the sessions hook all derive from the clock', () => {
    expect(read('components/rental-return/RentalDashboard.tsx')).toMatch(/useRentalClock\(session \? \[session\] : \[\]\)/);
    expect(read('app/rental-return/page.tsx')).toMatch(/groupRentals\(sessions, clock\)/);
    const h = read('hooks/useRentalSessions.ts');
    expect(h).toMatch(/useRentalClock\(all\)/);
    expect(h).toMatch(/groupRentals\(all, now\)/);
  });
});

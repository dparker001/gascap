/**
 * PR #62 finding 2 — derived lifecycle states refresh at their time
 * boundaries and on foreground resume, without polling or network calls.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { resolveRentalLifecycle, nextRentalBoundaryMs, type RentalLifecycle } from '@/lib/rentalCalculations';
import { nextWakeMs, MAX_TIMER_MS } from '@/hooks/useRentalClock';
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

describe('hook wiring (source guards): no polling, no network', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
  const hook = read('hooks/useRentalClock.ts');
  it('one setTimeout re-armed per boundary — never setInterval, never fetch', () => {
    expect(hook).toContain('setTimeout(');
    expect(hook).not.toMatch(/setInterval\(|fetch\(|XMLHttpRequest|axios/);
  });
  it('clamps the delay to the 32-bit limit and schedules nothing when no boundary remains', () => {
    expect(hook).toMatch(/Math\.min\(MAX_TIMER_MS/);
    expect(hook).toMatch(/if \(boundary === null\) return;/);
  });
  it('re-reads the clock on foreground resume (visibilitychange, pageshow, focus) and cleans up', () => {
    for (const ev of ["'visibilitychange'", "'pageshow'", "'focus'"]) expect(hook).toContain(ev);
    expect(hook).toContain('removeEventListener(\'visibilitychange\'');
    expect(hook).toContain('clearTimeout(timer)');
  });
  it('the dashboard, My Rentals list and the sessions hook all derive from the clock', () => {
    expect(read('components/rental-return/RentalDashboard.tsx')).toMatch(/useRentalClock\(session \? \[session\] : \[\]\)/);
    expect(read('app/rental-return/page.tsx')).toMatch(/groupRentals\(sessions, clock\)/);
    const h = read('hooks/useRentalSessions.ts');
    expect(h).toMatch(/useRentalClock\(all\)/);
    expect(h).toMatch(/groupRentals\(all, now\)/);
  });
});

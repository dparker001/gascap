/**
 * The framework-free core of hooks/useRentalClock.ts, so the timing rules are
 * unit-testable with a fake clock. One timer, armed for the earliest upcoming
 * lifecycle boundary across the given rentals; `start()` is also what runs when
 * the schedules change (an edit, a new rental), and it refreshes `now`
 * IMMEDIATELY — a screen left idle for hours or days (timers frozen or
 * throttled, no foreground event) must not keep deriving states from a stale
 * `now` just because nothing fired yet.
 */
import { nextRentalBoundaryMs, rentalLifecycleInput } from './rentalCalculations';
import type { RentalSession } from './rentalSessions';

/** setTimeout stores a signed 32-bit delay; longer ones fire immediately. */
export const MAX_TIMER_MS = 2_147_483_647;
/** Wake a hair AFTER the boundary so `now >= boundary` is true when it fires. */
export const SLACK_MS = 250;

export function nextWakeMs(sessions: RentalSession[], now: number): number | null {
  let next: number | null = null;
  for (const s of sessions) {
    const b = nextRentalBoundaryMs(rentalLifecycleInput(s), now);
    if (b !== null && (next === null || b < next)) next = b;
  }
  return next;
}

export interface RentalClockDeps {
  now: () => number;
  setNow: (n: number) => void;
  getSessions: () => RentalSession[];
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export function createRentalClock(d: RentalClockDeps) {
  let timer: unknown = null;
  let stopped = false;

  function clear() { if (timer !== null) { d.clearTimer(timer); timer = null; } }

  function arm() {
    clear();
    if (stopped) return;
    const t = d.now();
    const boundary = nextWakeMs(d.getSessions(), t);
    if (boundary === null) return;                          // nothing left to flip — no timer
    timer = d.setTimer(() => {
      timer = null;
      if (stopped) return;
      d.setNow(d.now());
      arm();                                                // next boundary (or a clamped remainder)
    }, Math.min(MAX_TIMER_MS, Math.max(0, boundary - t) + SLACK_MS));
  }

  return {
    /** First run AND every schedule change: refresh `now` right away, then re-arm. */
    start() { if (stopped) return; d.setNow(d.now()); arm(); },
    /** Foreground resume (visibilitychange / pageshow / focus). */
    refresh() { if (stopped) return; d.setNow(d.now()); arm(); },
    stop() { stopped = true; clear(); },
  };
}

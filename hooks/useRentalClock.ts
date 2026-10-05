'use client';

/**
 * A "now" for the derived rental lifecycle that is correct WITHOUT polling and
 * WITHOUT any network call. Lifecycle states are computed from the clock, so
 * a screen left open (or a phone locked and unlocked) must re-evaluate at the
 * moment a state flips:
 *  - ONE timer, armed for the earliest upcoming boundary across the given
 *    rentals (lib/rentalCalculations.ts nextRentalBoundaryMs), re-armed after
 *    it fires; clamped to setTimeout's 32-bit limit and re-armed if it wakes
 *    early; nothing is scheduled when no boundary remains;
 *  - re-reads the clock on foreground resume (visibilitychange / pageshow /
 *    focus) — timers are throttled or frozen while backgrounded.
 * It only updates a number in React state; it never fetches.
 */
import { useEffect, useRef, useState } from 'react';
import { nextRentalBoundaryMs, rentalLifecycleInput } from '@/lib/rentalCalculations';
import type { RentalSession } from '@/lib/rentalSessions';

/** setTimeout stores a signed 32-bit delay; longer ones fire immediately. */
export const MAX_TIMER_MS = 2_147_483_647;
/** Wake a hair AFTER the boundary so `now >= boundary` is true when it fires. */
const SLACK_MS = 250;

export function nextWakeMs(sessions: RentalSession[], now: number): number | null {
  let next: number | null = null;
  for (const s of sessions) {
    const b = nextRentalBoundaryMs(rentalLifecycleInput(s), now);
    if (b !== null && (next === null || b < next)) next = b;
  }
  return next;
}

export function useRentalClock(sessions: RentalSession[]): number {
  const [now, setNow] = useState(() => Date.now());
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  // Re-arm whenever the set of schedules changes (an edit moves a boundary).
  const scheduleKey = sessions
    .map((s) => `${s.id}|${s.status}|${s.pickupDateTimeUtc}|${s.returnDateTimeUtc}|${s.pickupDateTime}|${s.returnDateTime}`)
    .join(';');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function arm() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (cancelled) return;
      const t = Date.now();
      const boundary = nextWakeMs(sessionsRef.current, t);
      if (boundary === null) return;                       // nothing left to flip — no timer
      timer = setTimeout(() => {
        timer = null;
        if (cancelled) return;
        setNow(Date.now());
        arm();                                             // next boundary (or a clamped remainder)
      }, Math.min(MAX_TIMER_MS, Math.max(0, boundary - t) + SLACK_MS));
    }

    function refresh() { if (!cancelled) { setNow(Date.now()); arm(); } }
    function onVisibility() { if (document.visibilityState === 'visible') refresh(); }

    arm();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [scheduleKey]);

  return now;
}

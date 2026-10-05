'use client';

/**
 * A "now" for the derived rental lifecycle that is correct WITHOUT polling and
 * WITHOUT any network call. Lifecycle states are computed from the clock, so
 * a screen left open (or a phone locked and unlocked) must re-evaluate at the
 * moment a state flips:
 *  - ONE timer for the earliest upcoming boundary, re-armed after it fires;
 *  - `now` is refreshed IMMEDIATELY whenever the schedules change (an edit, a
 *    new rental) — even after a long idle — and on foreground resume
 *    (visibilitychange / pageshow / focus), since timers are throttled or
 *    frozen while backgrounded.
 * It only updates a number in React state; it never fetches. The timing rules
 * live in lib/rentalClockController.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { createRentalClock } from '@/lib/rentalClockController';
import type { RentalSession } from '@/lib/rentalSessions';

export function useRentalClock(sessions: RentalSession[]): number {
  const [now, setNow] = useState(() => Date.now());
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  // Changes whenever any schedule (or the set of rentals) changes.
  const scheduleKey = sessions
    .map((s) => `${s.id}|${s.status}|${s.pickupDateTimeUtc}|${s.returnDateTimeUtc}|${s.pickupDateTime}|${s.returnDateTime}`)
    .join(';');

  useEffect(() => {
    const clock = createRentalClock({
      now: () => Date.now(), setNow, getSessions: () => sessionsRef.current,
      setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    clock.start();                                         // refreshes `now` immediately, then arms
    const onVisibility = () => { if (document.visibilityState === 'visible') clock.refresh(); };
    const onResume = () => clock.refresh();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onResume);
    window.addEventListener('focus', onResume);
    return () => {
      clock.stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onResume);
      window.removeEventListener('focus', onResume);
    };
  }, [scheduleKey]);

  return now;
}

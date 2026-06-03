'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Animates a giveaway entry count upward when the daily gift box is opened.
 *
 * Pass the server's current entryCount (or null while loading). Returns the
 * displayed (animated) value plus a `flash` flag for a brief highlight. Listens
 * for the window `gascap:entries-earned` event that DailyBonus dispatches after
 * a successful claim, then ticks the number up from its current value.
 */
export function useEntryCountUp(baseCount: number | null) {
  const [count, setCount] = useState<number | null>(baseCount);
  const [flash, setFlash] = useState(false);

  const countRef = useRef<number>(baseCount ?? 0);
  const rafRef    = useRef<number | null>(null);
  const seeded    = useRef(false);

  // Seed the displayed value from the server count once it arrives (no animation).
  useEffect(() => {
    if (baseCount === null || seeded.current) return;
    seeded.current   = true;
    countRef.current = baseCount;
    setCount(baseCount);
  }, [baseCount]);

  useEffect(() => {
    function onEarned(e: Event) {
      const won = (e as CustomEvent<{ entriesWon?: number }>).detail?.entriesWon ?? 0;
      if (won <= 0) return;

      const from = countRef.current;
      const to   = from + won;
      const dur  = 900;
      const start = performance.now();

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const step = (now: number) => {
        const p     = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        const v     = Math.round(from + (to - from) * eased);
        countRef.current = v;
        setCount(v);
        if (p < 1) rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);

      setFlash(true);
      window.setTimeout(() => setFlash(false), 1300);
    }

    window.addEventListener('gascap:entries-earned', onEarned);
    return () => {
      window.removeEventListener('gascap:entries-earned', onEarned);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { count, flash };
}

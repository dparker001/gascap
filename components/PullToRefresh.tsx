'use client';

/**
 * PullToRefresh — adds a native-feeling pull-to-refresh gesture for the
 * installed PWA on iOS/Android where there's no browser chrome or refresh button.
 *
 * Pull down from the top of any page → spinner appears → release at 100% → reload.
 */
import { useEffect, useState, useRef } from 'react';

const THRESHOLD   = 72;  // px of pull needed to trigger refresh
const MAX_PULL    = 96;  // px — caps the visual drag distance

export default function PullToRefresh() {
  const [pullY,      setPullY]      = useState(0);   // 0–MAX_PULL
  const [releasing,  setReleasing]  = useState(false);
  const startYRef   = useRef<number | null>(null);
  const pullingRef  = useRef(false);

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      // Only start tracking if at the very top of the page
      if (window.scrollY === 0) {
        startYRef.current = e.touches[0].clientY;
        pullingRef.current = false;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (startYRef.current === null) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy > 0) {
        pullingRef.current = true;
        setPullY(Math.min(MAX_PULL, dy));
      } else {
        setPullY(0);
      }
    }

    function onTouchEnd() {
      if (pullingRef.current && pullY >= THRESHOLD) {
        setReleasing(true);
        // Brief pause so the spinner shows before reload
        setTimeout(() => window.location.reload(), 300);
      } else {
        setPullY(0);
      }
      startYRef.current = null;
      pullingRef.current = false;
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove',  onTouchMove,  { passive: true });
    window.addEventListener('touchend',   onTouchEnd);

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove',  onTouchMove);
      window.removeEventListener('touchend',   onTouchEnd);
    };
  }, [pullY]);

  // Nothing visible until the user starts pulling
  if (pullY === 0 && !releasing) return null;

  const progress  = Math.min(1, pullY / THRESHOLD);
  const triggered = pullY >= THRESHOLD || releasing;

  return (
    <div
      className="fixed top-0 left-0 right-0 flex justify-center pointer-events-none z-50"
      style={{ paddingTop: Math.min(pullY * 0.5, 40) }}
      aria-hidden="true"
    >
      <div
        className="flex items-center gap-2 bg-navy-700 text-white text-xs font-bold
                   rounded-full px-4 py-2 shadow-lg"
        style={{ opacity: progress, transform: `scale(${0.8 + progress * 0.2})` }}
      >
        {/* Spinner or arrow */}
        <svg
          viewBox="0 0 24 24"
          className={`w-4 h-4 ${triggered ? 'animate-spin' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          style={!triggered ? { transform: `rotate(${progress * 180}deg)` } : undefined}
        >
          {triggered ? (
            // Spinning circle when triggered
            <path d="M12 2a10 10 0 1 0 10 10" strokeOpacity="0.3" />
          ) : (
            // Down arrow while pulling
            <path d="M12 5v14M5 12l7 7 7-7" />
          )}
        </svg>
        <span>{triggered ? 'Refreshing…' : 'Pull to refresh'}</span>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

const INTERVAL_MS  = 6000;   // time each tip is shown
const FADE_MS      = 400;    // cross-fade duration

export default function TipsTicker() {
  const { t }                 = useTranslation();
  const TIPS                  = t.tips as readonly string[];
  const [idx,     setIdx]     = useState(0);
  const [visible, setVisible] = useState(true);
  const pausedRef             = useRef(false);
  const timerRef              = useRef<ReturnType<typeof setInterval> | null>(null);

  function advance() {
    if (pausedRef.current) return;
    setVisible(false);
    setTimeout(() => {
      setIdx((i) => (i + 1) % TIPS.length);
      setVisible(true);
    }, FADE_MS);
  }

  useEffect(() => {
    timerRef.current = setInterval(advance, INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMouseEnter() {
    pausedRef.current = true;
  }
  function handleMouseLeave() {
    pausedRef.current = false;
  }

  return (
    <div
      className="mt-3 flex items-start gap-2 bg-white/8 border border-white/15 rounded-2xl px-3.5 py-2.5 cursor-default"
      style={{ minHeight: '52px' }}   /* always tall enough for 2 lines — prevents layout jump */
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="text-amber-400 text-xs mt-0.5 flex-shrink-0" aria-hidden="true">💡</span>
      <p
        className="text-white/75 text-xs leading-relaxed"
        style={{
          opacity:    visible ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease`,
          /* Reserve exactly 2 lines so container never resizes */
          minHeight:  'calc(2 * 1.625em)',
        }}
        aria-live="polite"
        aria-atomic="true"
      >
        {TIPS[idx]}
      </p>
    </div>
  );
}

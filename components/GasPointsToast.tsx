'use client';

/**
 * Gamification G1 — lightweight "+N GasPoints — <what>" toast for awards the
 * server made on another surface (first vehicle, first saved station). It only
 * DISPLAYS an award announced via lib/gasPointsClient; it cannot grant points.
 * No wheel, no random amounts, no confetti: a plain, brief status line. The
 * fade-in is disabled under prefers-reduced-motion (app/globals.css), so
 * reduced-motion users see it appear/disappear without animation.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { GASPOINTS_AWARDED_EVENT } from '@/lib/gasPointsClient';
import { isGasPointAction, type GasPointAction } from '@/lib/gasPointsRules';

export default function GasPointsToast() {
  const { t } = useTranslation();
  const [award, setAward] = useState<{ action: GasPointAction; points: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onAward = (e: Event) => {
      const d = (e as CustomEvent<{ action?: unknown; points?: unknown }>).detail;
      if (!d || !isGasPointAction(d.action) || typeof d.points !== 'number' || !(d.points > 0)) return;
      setAward({ action: d.action, points: d.points });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setAward(null), 3500);
    };
    window.addEventListener(GASPOINTS_AWARDED_EVENT, onAward);
    return () => {
      window.removeEventListener(GASPOINTS_AWARDED_EVENT, onAward);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!award) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[60] rounded-full bg-slate-900 text-white text-xs font-bold px-4 py-2 shadow-lg animate-fade-in"
    >
      {t.gasPoints.awardLine(award.points, t.gasPoints.awardLabels[award.action])}
    </div>
  );
}

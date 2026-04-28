'use client';

import { useEffect, useState, useCallback } from 'react';
import { type BadgeDef } from '@/lib/badges';
import { useTranslation } from '@/contexts/LanguageContext';

interface CatalogueBadge extends BadgeDef {
  earned: boolean;
}

interface ActivityData {
  badges:    string[];
  streak:    number;
  stats:     {
    calcCount:       number;
    budgetCalcCount: number;
    locationLookups: number;
    daysActive:      number;
    vehicleCount:    number;
  };
  catalogue: CatalogueBadge[];
}

/** Animated "new badge!" toast */
function BadgeToast({ badges, onDone }: { badges: BadgeDef[]; onDone: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(onDone, 4000);
    return () => clearTimeout(timer);
  }, [onDone]);

  if (badges.length === 0) return null;

  return (
    <div className="animate-fade-in fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                    bg-slate-900 text-white rounded-2xl px-4 py-3 shadow-xl
                    flex items-center gap-3 max-w-xs w-full mx-4">
      <span className="text-2xl">{badges[0].emoji}</span>
      <div>
        <p className="text-xs font-bold text-amber-400 leading-tight">{t.badges.badgeUnlocked}</p>
        <p className="text-sm font-semibold leading-tight">{badges[0].name}</p>
        <p className="text-[11px] text-slate-400 leading-tight mt-0.5">{badges[0].description}</p>
      </div>
    </div>
  );
}

/** Individual badge chip */
function BadgeChip({ badge, isNew }: { badge: CatalogueBadge; isNew?: boolean }) {
  const [tip, setTip] = useState(false);

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setTip((v) => !v)}
        onBlur={() => setTip(false)}
        className={[
          'w-11 h-11 rounded-full flex items-center justify-center text-xl',
          'border-2 transition-all duration-300 focus:outline-none',
          badge.earned
            ? isNew
              ? 'bg-amber-100 border-amber-400 scale-110 shadow-md shadow-amber-200 animate-pulse-once'
              : 'bg-white border-amber-300 shadow-sm hover:scale-105'
            : 'bg-slate-100 border-slate-200 opacity-40 grayscale',
        ].join(' ')}
        title={badge.earned ? badge.description : badge.hint}
        aria-label={badge.name}
      >
        {badge.earned ? badge.emoji : '🔒'}
      </button>

      {/* Tooltip */}
      {tip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10
                        bg-slate-800 text-white text-[11px] rounded-lg px-2.5 py-1.5
                        w-36 text-center shadow-lg pointer-events-none">
          <p className="font-bold">{badge.name}</p>
          <p className="text-slate-300 mt-0.5">
            {badge.earned ? badge.description : badge.hint}
          </p>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface BadgeShelfProps {
  /** Trigger a refresh (e.g. pass a counter that increments on each calculate) */
  refreshKey?: number;
  /** Called with newly-earned badge defs so parent can show toasts */
  onNewBadges?: (badges: BadgeDef[]) => void;
}

export default function BadgeShelf({ refreshKey, onNewBadges }: BadgeShelfProps) {
  const { t } = useTranslation();
  const [data,    setData]    = useState<ActivityData | null>(null);
  const [newIds,  setNewIds]  = useState<string[]>([]);
  const [toast,   setToast]   = useState<BadgeDef[]>([]);

  const load = useCallback(async () => {
    const ld  = new Date().toLocaleDateString('en-CA');
    const res = await fetch(`/api/activity?localDate=${ld}`);
    if (!res.ok) return;
    setData(await res.json() as ActivityData);
  }, []);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Re-fetch when refreshKey changes (i.e. after a calculate)
  useEffect(() => {
    if (refreshKey === undefined || refreshKey === 0) return;

    fetch(`/api/activity?localDate=${new Date().toLocaleDateString('en-CA')}`)
      .then((r) => r.ok ? r.json() as Promise<ActivityData> : null)
      .then((fresh) => {
        if (!fresh) return;
        // Compare with previous to find genuinely new badges
        const prevIds = data?.badges ?? [];
        const justEarned = fresh.badges.filter((id) => !prevIds.includes(id));
        if (justEarned.length > 0) {
          setNewIds(justEarned);
          const defs = fresh.catalogue
            .filter((b) => justEarned.includes(b.id))
            .map(({ earned: _e, ...rest }) => rest);
          setToast(defs);
          onNewBadges?.(defs);
          setTimeout(() => setNewIds([]), 5000);
        }
        setData(fresh);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (!data) return null;

  const earned  = data.badges.length;
  const total   = data.catalogue.length;
  const pct     = Math.round((earned / total) * 100);

  return (
    <>
      {/* ── Shelf ── */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">🏅</span>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              {t.badges.achievements}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data.streak > 1 && (
              <span className="text-[10px] font-bold bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">
                {t.badges.dayStreak(data.streak)}
              </span>
            )}
            <span className="text-[10px] text-slate-400 font-medium">
              {earned}/{total}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-slate-100 rounded-full mb-3 overflow-hidden">
          <div
            className="h-full bg-amber-400 rounded-full transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Badge chips — horizontal scroll */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {data.catalogue.map((badge) => (
            <BadgeChip
              key={badge.id}
              badge={badge}
              isNew={newIds.includes(badge.id)}
            />
          ))}
        </div>

        {earned === 0 && (
          <p className="text-[11px] text-slate-400 text-center mt-2">
            {t.badges.runCalcToEarn}
          </p>
        )}
      </div>

      {/* Toast */}
      {toast.length > 0 && (
        <BadgeToast badges={toast} onDone={() => setToast([])} />
      )}
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';

interface ActivityResponse {
  streak: number;
}

export default function StreakCounter() {
  const { data: session } = useSession();
  const { t }             = useTranslation();
  const [streak, setStreak]   = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    // POST a 'visit' event — this records today in activeDays (idempotent)
    // and returns the freshly-calculated streak including today.
    fetch('/api/activity', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'visit' }),
    })
      .then((r) => r.ok ? r.json() as Promise<ActivityResponse> : Promise.reject())
      .then((d) => setStreak(d.streak ?? 0))
      .catch(() => setStreak(0))
      .finally(() => setLoading(false));
  }, [session]);

  if (!session) return null;
  if (loading || streak === null) {
    return (
      <div className="max-w-lg mx-auto w-full px-4 pb-2">
        <div className="h-12 bg-slate-100 rounded-2xl animate-pulse" />
      </div>
    );
  }

  const hasStreak = streak >= 2;

  return (
    <div className="max-w-lg mx-auto w-full px-4 pt-3 pb-2">
      <div className="bg-navy-700 rounded-2xl px-4 py-3 flex items-center gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">⚡</span>
        <div className="flex-1 min-w-0">
          {hasStreak ? (
            <>
              <p className="text-sm font-black text-amber-400 leading-tight">
                {t.streak.active(streak)}
              </p>
              <p className="text-[10px] text-white/50 mt-0.5">
                {t.streak.activeSub}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-black text-white leading-tight">
                {t.streak.start}
              </p>
              <p className="text-[10px] text-white/50 mt-0.5">
                {t.streak.startSub}
              </p>
            </>
          )}
        </div>
        {hasStreak && (
          <div className="flex-shrink-0 bg-amber-500/20 border border-amber-400/30 rounded-xl px-3 py-1.5 text-center">
            <p className="text-lg font-black text-amber-400 leading-none">{streak}</p>
            <p className="text-[9px] text-amber-300/60 font-bold uppercase tracking-wide mt-0.5">{t.streak.daysLabel}</p>
          </div>
        )}
      </div>
    </div>
  );
}

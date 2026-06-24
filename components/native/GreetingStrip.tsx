'use client';

/**
 * GreetingStrip — slim personalized bar directly under the native title bar, shown on
 * the Calculator tab for signed-in users: "👋 Hi {name} · 🔥 N-day streak · 🎟️ N entries".
 * Taps through to the Rewards tab. Reinforces the daily-return + giveaway-entry loop
 * (the retention hook). Hidden for guests — they see the "Sign up" pill in the title bar.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';

export default function GreetingStrip({ onOpenRewards }: { onOpenRewards: () => void }) {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  const [stats, setStats] = useState<{ streak: number; entries: number } | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    fetch('/api/user/giveaway-entries', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !cancelled) setStats({ streak: d.streak ?? 0, entries: d.entryCount ?? 0 }); })
      .catch(() => { /* ignore — strip just shows the greeting */ });
    return () => { cancelled = true; };
  }, [status]);

  if (status !== 'authenticated') return null;

  const firstName = (session?.user?.name ?? '').trim().split(' ')[0];

  return (
    <button
      type="button"
      onClick={onOpenRewards}
      aria-label={`${t.greetingStrip.hi}${firstName ? ` ${firstName}` : ''} — ${t.nav.rewards}`}
      className="w-full bg-[#1e3a5f] text-white px-4 py-2 flex items-center gap-2
                 border-t border-white/10 active:bg-[#24456e] transition-colors"
    >
      <span className="text-sm font-bold truncate">
        👋 {t.greetingStrip.hi}{firstName ? ` ${firstName}` : ''}
      </span>
      {stats && (
        <span className="ml-auto flex-shrink-0 flex items-center gap-2 text-xs font-semibold whitespace-nowrap">
          <span>🔥 {t.greetingStrip.dayStreak(stats.streak)}</span>
          <span className="text-white/30" aria-hidden="true">·</span>
          <span>🎟️ {t.greetingStrip.entries(stats.entries)}</span>
          <span className="text-white/60 text-sm" aria-hidden="true">›</span>
        </span>
      )}
    </button>
  );
}

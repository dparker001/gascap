'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

/**
 * Displays a contextual pill in the hero section:
 *  - Signed out       → nothing (handled by hero guest strip)
 *  - Free plan        → "Free plan · Upgrade"
 *  - Pro Trial        → "⭐ Pro Trial · X days left" + "Upgrade to keep Pro →"
 *  - Pro (paid)       → "⭐ GasCap Pro"  (amber)
 *  - Fleet plan       → "🚛 GasCap Fleet" (blue)
 *
 * Always fetches fresh trial/plan state from the server so the badge stays
 * accurate even when the session JWT is stale (e.g. installed PWA).
 */

interface LivePlanData {
  plan:          string;
  isProTrial:    boolean;
  betaProExpiry: string | null;
}

export default function PlanBadge() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  const [liveData, setLiveData] = useState<LivePlanData | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch('/api/vehicles')
      .then((r) => r.json())
      .then((d: LivePlanData) => { if (d.plan) setLiveData(d); })
      .catch(() => {});
  }, [session]);

  if (status === 'loading') {
    return <div className="mt-4 h-7 w-52 rounded-full bg-white/10 animate-pulse" />;
  }

  // Live server data takes priority over JWT — always reflects current billing state
  const jwtUser      = session?.user as { plan?: string; isProTrial?: boolean; betaProExpiry?: string | null } | undefined;
  const plan         = liveData?.plan         ?? jwtUser?.plan         ?? null;
  const isProTrial   = liveData?.isProTrial   ?? jwtUser?.isProTrial   ?? false;
  const betaProExpiry = liveData?.betaProExpiry ?? jwtUser?.betaProExpiry ?? null;

  /* ── Pro Trial ── */
  if (plan === 'pro' && isProTrial && betaProExpiry) {
    const msRemaining = new Date(betaProExpiry).getTime() - Date.now();
    const daysLeft    = Math.max(0, Math.ceil(msRemaining / 86_400_000));

    const isUrgent  = daysLeft <= 2;
    const isWarning = daysLeft <= 7;

    const pillColors = isUrgent
      ? 'bg-red-500/25 border-red-400/50'
      : isWarning
      ? 'bg-orange-500/25 border-orange-400/50'
      : 'bg-amber-500/20 border-amber-400/40';

    const textColor  = isUrgent ? 'text-red-200'    : 'text-amber-200';
    const countColor = isUrgent ? 'text-red-300'     : isWarning ? 'text-orange-300' : 'text-amber-300';
    const icon       = isUrgent ? '⏰'               : isWarning ? '⚡' : '⭐';

    const daysLabel  = daysLeft <= 0 ? 'Expires today'
                     : daysLeft === 1 ? '1 day left'
                     : `${daysLeft} days left`;

    return (
      <div className="mt-4 flex flex-col items-center gap-1.5">
        {/* Main pill */}
        <div className={`inline-flex items-center gap-2 border rounded-full px-3.5 py-1.5 ${pillColors}`}>
          <span className="text-xs" aria-hidden="true">{icon}</span>
          <span className={`text-xs font-bold tracking-wide ${textColor}`}>Pro Trial</span>
          <span className="text-white/25 mx-0.5">·</span>
          <span className={`text-xs font-black ${countColor}`}>{daysLabel}</span>
        </div>

        {/* Upgrade nudge below the pill */}
        <a
          href="/upgrade"
          className="text-amber-400/80 text-[11px] font-bold hover:text-amber-300
                     transition-colors underline-offset-2 hover:underline"
        >
          Upgrade to keep Pro →
        </a>
      </div>
    );
  }

  /* ── Pro (paid, not trial) ── */
  if (plan === 'pro') {
    return (
      <div className="mt-4 inline-flex items-center gap-2 bg-amber-500/20 border border-amber-400/40
                      rounded-full px-3.5 py-1.5">
        <span className="text-amber-300 text-xs" aria-hidden="true">⭐</span>
        <span className="text-amber-200 text-xs font-bold tracking-wide">{t.plan.gascapPro}</span>
      </div>
    );
  }

  /* ── Fleet ── */
  if (plan === 'fleet') {
    return (
      <div className="mt-4 inline-flex items-center gap-2 bg-blue-500/20 border border-blue-400/40
                      rounded-full px-3.5 py-1.5">
        <span className="text-blue-300 text-xs" aria-hidden="true">🚛</span>
        <span className="text-blue-200 text-xs font-bold tracking-wide">{t.plan.gascapFleet}</span>
      </div>
    );
  }

  /* ── Free signed-in ── */
  if (session) {
    return (
      <div className="mt-4 inline-flex items-center gap-1.5 bg-white/10 border border-white/20
                      rounded-full px-3.5 py-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" aria-hidden="true" />
        <span className="text-white/80 text-xs font-medium">{t.plan.freePlan}</span>
        <span className="mx-1 text-white/30">·</span>
        <a href="/upgrade" className="text-amber-400 text-xs font-bold hover:text-amber-300 transition-colors">
          {t.plan.upgrade}
        </a>
      </div>
    );
  }

  /* ── Signed out — hero guest strip handles messaging ── */
  return null;
}

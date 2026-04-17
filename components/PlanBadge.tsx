'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

/**
 * Displays a contextual pill in the header:
 *  - Signed out  → "Free · No account needed · Works offline"
 *  - Free plan   → "Free plan · Works offline"
 *  - Pro plan    → "⭐ GasCap Pro"  (amber)
 *  - Fleet plan  → "🚛 GasCap Fleet" (blue)
 *
 * Uses a live server fetch so the badge is always accurate even when
 * the session JWT is stale (e.g. after a plan upgrade in the installed PWA).
 */
export default function PlanBadge() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  const [livePlan, setLivePlan] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch('/api/vehicles')
      .then((r) => r.json())
      .then((d: { plan?: string }) => { if (d.plan) setLivePlan(d.plan); })
      .catch(() => {});
  }, [session]);

  if (status === 'loading') {
    return <div className="mt-4 h-7 w-52 rounded-full bg-white/10 animate-pulse" />;
  }

  // Live plan takes priority over JWT plan — always reflects current billing state
  const jwtPlan = session?.user?.plan ?? null;
  const plan    = livePlan ?? jwtPlan;

  /* ── Pro ── */
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

  /* ── Signed out — hero offer strip handles the guest messaging ── */
  return null;
}

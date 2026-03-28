'use client';

import { useSession } from 'next-auth/react';

/**
 * Displays a contextual pill in the header:
 *  - Signed out  → "Free · No account needed · Works offline"
 *  - Free plan   → "Free plan · Works offline"
 *  - Pro plan    → "⭐ GasCap Pro"  (amber)
 *  - Fleet plan  → "🚛 GasCap Fleet" (blue)
 */
export default function PlanBadge() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return <div className="mt-4 h-7 w-52 rounded-full bg-white/10 animate-pulse" />;
  }

  const plan = (session?.user as { plan?: string })?.plan ?? null;

  /* ── Pro ── */
  if (plan === 'pro') {
    return (
      <div className="mt-4 inline-flex items-center gap-2 bg-amber-500/20 border border-amber-400/40
                      rounded-full px-3.5 py-1.5">
        <span className="text-amber-300 text-xs" aria-hidden="true">⭐</span>
        <span className="text-amber-200 text-xs font-bold tracking-wide">GasCap Pro</span>
      </div>
    );
  }

  /* ── Fleet ── */
  if (plan === 'fleet') {
    return (
      <div className="mt-4 inline-flex items-center gap-2 bg-blue-500/20 border border-blue-400/40
                      rounded-full px-3.5 py-1.5">
        <span className="text-blue-300 text-xs" aria-hidden="true">🚛</span>
        <span className="text-blue-200 text-xs font-bold tracking-wide">GasCap Fleet</span>
      </div>
    );
  }

  /* ── Free signed-in ── */
  if (session) {
    return (
      <div className="mt-4 inline-flex items-center gap-1.5 bg-white/10 border border-white/20
                      rounded-full px-3.5 py-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" aria-hidden="true" />
        <span className="text-white/80 text-xs font-medium">Free plan · Works offline</span>
        <span className="mx-1 text-white/30">·</span>
        <a href="/upgrade" className="text-amber-400 text-xs font-bold hover:text-amber-300 transition-colors">
          Upgrade →
        </a>
      </div>
    );
  }

  /* ── Signed out (default) ── */
  return (
    <div className="mt-4 inline-flex items-center gap-1.5 bg-white/10 border border-white/20
                    rounded-full px-3.5 py-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" aria-hidden="true" />
      <span className="text-white/80 text-xs font-medium">Free · No account needed · Works offline</span>
    </div>
  );
}

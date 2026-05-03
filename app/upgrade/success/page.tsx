'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function SuccessContent() {
  const params    = useSearchParams();
  const router    = useRouter();
  const sessionId = params.get('session_id');
  const tier      = params.get('tier') === 'fleet' ? 'fleet' : 'pro';
  const [ready, setReady] = useState(false);

  // Small delay so webhook has time to fire before we reload session
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 2000);
    return () => clearTimeout(t);
  }, []);

  const isFleet   = tier === 'fleet';
  const planLabel = isFleet ? 'GasCap™ Fleet' : 'GasCap™ Pro';
  const headline  = isFleet ? "You're Fleet! 🎉" : "You're Pro! 🎉";
  const perks     = isFleet
    ? 'Unlimited vehicles, multi-driver access, fleet cost dashboard, and all Fleet features are now unlocked.'
    : 'Manual vehicle entry, up to 3 saved vehicles, MPG tracking, AI advisor, and all Pro features are now unlocked.';

  return (
    <div className="bg-white rounded-3xl shadow-card p-8 max-w-sm w-full text-center space-y-4">

      {/* Animated checkmark */}
      <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
        <svg className="w-10 h-10 text-amber-500" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" strokeWidth="2.5"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h1 className="text-2xl font-black text-navy-700">{headline}</h1>

      <p className="text-slate-500 text-sm leading-relaxed">
        Welcome to <span className="font-bold text-amber-600">{planLabel}</span>.
        Your account has been upgraded — {perks}
      </p>

      {sessionId && (
        <p className="text-[11px] text-slate-300 font-mono break-all">
          Ref: {sessionId.slice(-12)}
        </p>
      )}

      {/* GasCaptains™ community invite — Pro only */}
      {!isFleet && (
        <a
          href={process.env.NEXT_PUBLIC_GASCAPTAINS_URL ?? 'https://www.facebook.com/groups/gascaptains'}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-2xl border-2 border-[#1EB68F] bg-[#f0fdf9] px-4 py-3.5
                     text-left hover:bg-[#e6faf5] transition-colors"
        >
          <p className="text-[10px] font-black uppercase tracking-widest text-[#1EB68F] mb-0.5">
            🏴 Members Only
          </p>
          <p className="text-sm font-black text-[#005F4A] leading-tight">
            Join GasCaptains™ →
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
            The official private community for GasCap™ Pro members.
          </p>
        </a>
      )}

      {ready ? (
        <button
          onClick={() => router.push('/')}
          className="block w-full py-3.5 rounded-2xl bg-amber-500 text-white font-black
                     text-base hover:bg-amber-400 transition-colors text-center"
        >
          Go to Calculator →
        </button>
      ) : (
        <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity=".25"/>
            <path d="M21 12a9 9 0 00-9-9" />
          </svg>
          Activating your account…
        </div>
      )}
    </div>
  );
}

export default function UpgradeSuccessPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col items-center justify-center px-4">
      <Suspense fallback={
        <div className="bg-white rounded-3xl shadow-card p-8 max-w-sm w-full text-center">
          <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-amber-400 animate-spin" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity=".25"/>
              <path d="M21 12a9 9 0 00-9-9" />
            </svg>
          </div>
          <p className="text-slate-400 text-sm">Loading…</p>
        </div>
      }>
        <SuccessContent />
      </Suspense>
    </div>
  );
}

'use client';

/**
 * SetupChecklist — inline progress card shown once to new signed-in users.
 *
 * Steps:
 *  1. Add a vehicle (all plans)
 *  2. Log your first fill-up (all plans)
 *  3. Add a driver (fleet plan only)
 *
 * Completion is detected via:
 *  - Initial fetch of /api/vehicles, /api/fillups, /api/fleet/drivers
 *  - Live window events: "vehicle-saved", "fillup-saved"
 *
 * Dismissed permanently via localStorage key SETUP_KEY.
 * Auto-dismisses 2.5 s after all steps are complete.
 */

import { useState, useEffect }  from 'react';
import { useSession }           from 'next-auth/react';
import Link                     from 'next/link';
import { useTranslation }       from '@/contexts/LanguageContext';

const SETUP_KEY = 'gascap_setup_v1';

function CheckCircle({ done, index }: { done: boolean; index: number }) {
  if (done) {
    return (
      <div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 shadow-sm">
        <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M2 6l3 3 5-5" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-full border-2 border-amber-300 bg-amber-50 flex items-center justify-center flex-shrink-0">
      <span className="text-[11px] font-black text-amber-600">{index + 1}</span>
    </div>
  );
}

export default function SetupChecklist() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const sc = t.setupChecklist;

  const [mounted,    setMounted]    = useState(false);
  const [dismissed,  setDismissed]  = useState(true);   // true until client confirms not dismissed
  const [loading,    setLoading]    = useState(true);
  const [celebrating, setCelebrating] = useState(false);

  const [hasVehicle, setHasVehicle] = useState(false);
  const [hasFillup,  setHasFillup]  = useState(false);
  const [isFleet,    setIsFleet]    = useState(false);
  const [hasDriver,  setHasDriver]  = useState(false);

  // ── Client hydration + localStorage check ───────────────────────────────
  useEffect(() => {
    setMounted(true);
    try {
      if (!localStorage.getItem(SETUP_KEY)) setDismissed(false);
    } catch {}
  }, []);

  // ── Fetch initial completion state ───────────────────────────────────────
  useEffect(() => {
    if (!session || dismissed || !mounted) return;

    Promise.all([
      fetch('/api/vehicles').then((r) => r.json()),
      fetch('/api/fillups').then((r) => r.json()),
    ])
      .then(([vData, fData]: [{ vehicles?: unknown[]; plan?: string }, { fillups?: unknown[] }]) => {
        const plan = vData.plan ?? 'free';
        setHasVehicle((vData.vehicles ?? []).length > 0);
        setHasFillup((fData.fillups  ?? []).length > 0);
        setIsFleet(plan === 'fleet');

        if (plan === 'fleet') {
          fetch('/api/fleet/drivers')
            .then((r) => r.json())
            .then((d: { drivers?: string[] }) => setHasDriver((d.drivers ?? []).length > 0))
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session, dismissed, mounted]);

  // ── Listen for live completion events ───────────────────────────────────
  useEffect(() => {
    const onVehicle = () => setHasVehicle(true);
    const onFillup  = () => setHasFillup(true);
    window.addEventListener('vehicle-saved', onVehicle);
    window.addEventListener('fillup-saved',  onFillup);
    return () => {
      window.removeEventListener('vehicle-saved', onVehicle);
      window.removeEventListener('fillup-saved',  onFillup);
    };
  }, []);

  // ── Auto-dismiss after celebration ──────────────────────────────────────
  const steps  = isFleet ? [hasVehicle, hasFillup, hasDriver] : [hasVehicle, hasFillup];
  const allDone = !loading && steps.every(Boolean);

  useEffect(() => {
    if (!allDone) return;
    setCelebrating(true);
    const t = setTimeout(() => dismiss(), 2500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  function dismiss() {
    try { localStorage.setItem(SETUP_KEY, '1'); } catch {}
    setDismissed(true);
  }

  function goToVehicles() {
    document.getElementById('gascap-calculator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.dispatchEvent(new CustomEvent('gascap:focus-vehicles'));
  }

  function goToLog() {
    document.getElementById('gascap-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.dispatchEvent(new CustomEvent('gascap:switch-tools-tab', { detail: { tab: 'log' } }));
  }

  // ── Gate renders ─────────────────────────────────────────────────────────
  if (!mounted || !session || dismissed || loading) return null;

  const doneCount = steps.filter(Boolean).length;
  const total     = steps.length;

  // ── Celebration banner ───────────────────────────────────────────────────
  if (celebrating) {
    return (
      <div className="mb-4 rounded-2xl bg-green-50 border border-green-200 px-4 py-4 text-center animate-fade-in">
        <p className="text-xl mb-1">🎉</p>
        <p className="text-sm font-black text-green-700">{sc.celebrationTitle}</p>
        <p className="text-xs text-green-600 mt-0.5">{sc.celebrationSub}</p>
      </div>
    );
  }

  // ── Checklist card ────────────────────────────────────────────────────────
  return (
    <div className="mb-4 rounded-2xl overflow-hidden shadow-sm border border-slate-100 animate-fade-in">

      {/* Header strip */}
      <div className="bg-navy-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-base">🚀</span>
          <div>
            <p className="text-sm font-black text-white leading-tight">{sc.header}</p>
            <p className="text-[10px] text-white/50 mt-0.5">
              {doneCount === 0
                ? sc.stepsTotal(total)
                : doneCount < total
                  ? sc.stepsProgress(doneCount, total)
                  : sc.allDone}
            </p>
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mr-2">
          {steps.map((done, i) => (
            <div
              key={i}
              className={`rounded-full transition-all duration-300 ${
                done ? 'w-2 h-2 bg-green-400' : 'w-2 h-2 bg-white/20'
              }`}
            />
          ))}
        </div>

        <button
          onClick={dismiss}
          aria-label={sc.dismissAria}
          className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 transition-colors
                     flex items-center justify-center flex-shrink-0"
        >
          <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none"
               stroke="white" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M1 1l8 8M9 1L1 9" />
          </svg>
        </button>
      </div>

      {/* Steps */}
      <div className="bg-white divide-y divide-slate-50">

        {/* Step 1 — Add a vehicle */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <CheckCircle done={hasVehicle} index={0} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold leading-tight ${hasVehicle ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
              {sc.step1Title}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{sc.step1Sub}</p>
          </div>
          {!hasVehicle && (
            <button
              onClick={goToVehicles}
              className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400
                         text-white text-xs font-bold transition-colors"
            >
              {sc.step1Cta}
            </button>
          )}
        </div>

        {/* Step 2 — Log first fill-up */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <CheckCircle done={hasFillup} index={1} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold leading-tight ${hasFillup ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
              {sc.step2Title}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{sc.step2Sub}</p>
          </div>
          {!hasFillup && (
            <button
              onClick={goToLog}
              className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400
                         text-white text-xs font-bold transition-colors"
            >
              {sc.step2Cta}
            </button>
          )}
        </div>

        {/* Step 3 — Fleet: Add a driver */}
        {isFleet && (
          <div className="flex items-center gap-3 px-4 py-3.5">
            <CheckCircle done={hasDriver} index={2} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold leading-tight ${hasDriver ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                {sc.step3Title}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{sc.step3Sub}</p>
            </div>
            {!hasDriver && (
              <Link
                href="/fleet"
                className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500
                           text-white text-xs font-bold transition-colors"
              >
                {sc.step3Cta}
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-t border-slate-100">
        <p className="text-[10px] text-slate-400">{sc.footerHint}</p>
        <button
          onClick={dismiss}
          className="text-[10px] text-slate-400 hover:text-slate-600 font-semibold transition-colors"
        >
          {sc.skipNow}
        </button>
      </div>
    </div>
  );
}

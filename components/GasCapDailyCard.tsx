'use client';

/**
 * Gamification G1 — "Daily Fuel Check" card: a small, USEFUL daily action that
 * gives a reason to open GasCap on days you are not fueling.
 *
 *   Check today's fuel pulse -> GasPoints -> weekly 3-day mission -> level
 *
 * Everything shown comes from the server (GET /api/gaspoints, POST
 * /api/gaspoints/daily-check): the client never decides, requests or computes a
 * point amount. The fuel pulse is the latest NATIONAL EIA weekly average with its
 * real survey week and the week-over-week change when one exists — never a local
 * station price, never a prediction, never BUY/WAIT. GasPoints are separate from
 * giveaway entries and have no cash or redemption value; the card says so.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';
import { GASPOINT_LEVELS, isGasPointAction, type AwardSummary, type GasPointLevelId } from '@/lib/gasPointsRules';

type Grade = 'regular' | 'midgrade' | 'premium' | 'diesel';
const GRADES: Grade[] = ['regular', 'midgrade', 'premium', 'diesel'];

interface Pulse {
  grade: Grade;
  price: number | null;
  period: string | null;
  change: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  stale: boolean;
}
interface Status {
  eligible: boolean;
  balance: number;
  level: { id: GasPointLevelId; next: { id: GasPointLevelId; min: number } | null; pointsToNext: number; progressPct: number };
  checkedToday: boolean;
  week: { checks: number; target: number; complete: boolean };
  streak: number;
  pulse?: Pulse;
}
interface CheckResponse extends Omit<Status, 'eligible'> {
  awards: AwardSummary[];
  totalAwarded: number;
  alreadyChecked: boolean;
  status: Status;
  pulse: Pulse;
}

export default function GasCapDailyCard() {
  const { data: session, status: authStatus } = useSession();
  const { t } = useTranslation();
  const g = t.gasPoints;

  const [status, setStatus]   = useState<Status | null>(null);
  const [pulse,  setPulse]    = useState<Pulse | null>(null);
  const [grade,  setGrade]    = useState<Grade | null>(null);
  const [awards, setAwards]   = useState<AwardSummary[]>([]);
  const [busy,   setBusy]     = useState(false);
  const [error,  setError]    = useState(false);
  const [hidden, setHidden]   = useState(false);

  const load = useCallback(async (g?: Grade | null) => {
    try {
      setError(false);
      const r = await fetch(`/api/gaspoints${g ? `?grade=${g}` : ''}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json() as Status;
      if (!d.eligible) { setHidden(true); return; }
      setStatus(d);
      if (d.pulse) { setPulse(d.pulse); setGrade(d.pulse.grade); }
    } catch { setError(true); }
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    void load(null);
  }, [authStatus, load]);

  async function runCheck() {
    if (busy) return;
    setBusy(true); setError(false);
    try {
      const r = await fetch('/api/gaspoints/daily-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(grade ? { grade } : {}),
      });
      if (r.status === 403) { setHidden(true); return; }
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json() as CheckResponse;
      setStatus(d.status);
      setPulse(d.pulse); setGrade(d.pulse.grade);
      setAwards(Array.isArray(d.awards) ? d.awards.filter((a) => isGasPointAction(a.action)) : []);
    } catch { setError(true); }
    finally { setBusy(false); }
  }

  async function pickGrade(next: Grade) {
    if (next === grade || !status?.checkedToday) { setGrade(next); return; }
    setGrade(next);
    await load(next);
  }

  if (!session || hidden) return null;
  if (!status) {
    return error ? (
      <div className="mx-4 lg:mx-0 mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 flex items-center justify-between gap-2">
        <span>{g.loadError}</span>
        <button onClick={() => void load(null)} className="font-bold text-amber-600">{g.retry}</button>
      </div>
    ) : (
      <div className="mx-4 lg:mx-0 mt-3 h-20 rounded-2xl bg-slate-100 animate-pulse" aria-hidden="true" />
    );
  }

  const lvlName = g.levels[status.level.id];
  const nextName = status.level.next ? g.levels[status.level.next.id] : null;
  const gradeLabel = (x: Grade) =>
    x === 'regular' ? t.fillup.gradeRegular : x === 'midgrade' ? t.fillup.gradeMidGrade : x === 'premium' ? t.fillup.gradePremium : t.fillup.gradeDiesel;
  const showPulse = status.checkedToday && pulse;
  const total = awards.reduce((s, a) => s + a.points, 0);

  return (
    <section
      aria-label={g.title}
      className="mx-4 lg:mx-0 mt-3 rounded-2xl border border-amber-200 bg-white shadow-sm overflow-hidden"
      data-testid="gascap-daily-card"
    >
      {/* Header: title + balance + level */}
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-slate-800">{g.title}</p>
          <p className="text-[11px] text-slate-500 leading-snug">{g.tagline}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-black text-amber-600 leading-none">{status.balance}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{g.balanceLabel}</p>
        </div>
      </div>

      {/* Level + progress */}
      <div className="px-4 pb-2">
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="font-bold text-slate-700">{g.levelLabel}: {lvlName}</span>
          <span className="text-slate-400">{nextName ? g.toNext(status.level.pointsToNext, nextName) : g.maxLevel}</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar"
             aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.level.progressPct}>
          <div className="h-full bg-amber-400 motion-safe:transition-all" style={{ width: `${status.level.progressPct}%` }} />
        </div>
      </div>

      {/* Weekly mission */}
      <div className="px-4 pb-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold text-slate-700">{g.weekly(Math.min(status.week.checks, status.week.target), status.week.target)}</span>
          <span className="flex gap-1" aria-hidden="true">
            {Array.from({ length: status.week.target }, (_, i) => (
              <span key={i} className={`w-2.5 h-2.5 rounded-full ${i < status.week.checks ? 'bg-emerald-500' : 'bg-slate-200'}`} />
            ))}
          </span>
        </div>
        <p className="text-[10px] text-slate-400 mt-0.5">{status.week.complete ? g.weeklyDone : g.weeklyHelp}</p>
        {status.streak > 0 && <p className="text-[10px] text-slate-400 mt-0.5">📅 {g.streak(status.streak)}</p>}
      </div>

      {/* Award breakdown from THIS check (server-decided) */}
      {awards.length > 0 && (
        <div className="mx-4 mb-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 animate-fade-in" role="status">
          <p className="text-[13px] font-black text-emerald-700">{g.resultTotal(total)}</p>
          <ul className="mt-0.5 space-y-0.5">
            {awards.map((a) => (
              <li key={a.action} className="text-[11px] text-emerald-800">{g.awardLine(a.points, g.awardLabels[a.action])}</li>
            ))}
          </ul>
        </div>
      )}

      {/* CTA or completed state */}
      <div className="px-4 pb-3">
        {!status.checkedToday ? (
          <button
            onClick={() => void runCheck()}
            disabled={busy}
            className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white text-sm font-black transition-colors"
          >
            {busy ? g.checking : g.checkCta}
          </button>
        ) : (
          <p className="text-[12px] font-bold text-emerald-700">✓ {g.doneToday} <span className="font-normal text-slate-400">· {g.comeBack}</span></p>
        )}
        {error && (
          <p className="mt-1.5 text-[11px] text-red-500">{g.loadError}{' '}
            <button onClick={() => void (status.checkedToday ? load(grade) : runCheck())} className="font-bold underline">{g.retry}</button>
          </p>
        )}
      </div>

      {/* Fuel pulse — revealed by the check; real EIA data only */}
      {showPulse && pulse && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-1.5">
          <div className="flex gap-1.5" role="group" aria-label={g.pulseHeading('')}>
            {GRADES.map((x) => (
              <button
                key={x}
                onClick={() => void pickGrade(x)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                  x === grade ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'
                }`}
                aria-pressed={x === grade}
              >
                {gradeLabel(x)}
              </button>
            ))}
          </div>
          {pulse.price === null || !pulse.period ? (
            <p className="text-[12px] text-slate-500">{g.pulseNone}</p>
          ) : (
            <>
              <p className="text-[12px] text-slate-500">{g.pulseHeading(gradeLabel(pulse.grade))}</p>
              <p className="text-2xl font-black text-slate-800 leading-none">${pulse.price.toFixed(3)}<span className="text-xs font-semibold text-slate-400"> /gal</span></p>
              <p className="text-[11px] text-slate-500">
                {g.pulseWeek(new Date(`${pulse.period}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}
              </p>
              <p className={`text-[12px] font-bold ${pulse.direction === 'up' ? 'text-amber-700' : pulse.direction === 'down' ? 'text-emerald-700' : 'text-slate-600'}`}>
                {pulse.change === null || pulse.direction === null
                  ? g.pulseNoChange
                  : pulse.direction === 'flat'
                    ? g.pulseFlat
                    : pulse.direction === 'up'
                      ? g.pulseUp(Math.abs(pulse.change).toFixed(3))
                      : g.pulseDown(Math.abs(pulse.change).toFixed(3))}
              </p>
              {pulse.stale && <p className="text-[11px] text-amber-700">{g.pulseStale}</p>}
              <p className="text-[10px] text-slate-400">{g.pulseNote}</p>
            </>
          )}
        </div>
      )}

      <p className="px-4 pb-3 text-[10px] text-slate-400 leading-snug">{g.separation}</p>
    </section>
  );
}

// Re-exported so tests can assert the level thresholds the UI is built from.
export { GASPOINT_LEVELS };

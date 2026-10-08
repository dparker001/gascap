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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';
import { GASPOINT_LEVELS, GASPOINT_RULES, isGasPointAction, type AwardSummary, type GasPointLevelId } from '@/lib/gasPointsRules';
import type { ChallengeView } from '@/lib/gasChallengesRules';

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
interface ChallengesResponse {
  eligible: boolean;
  g2Active: boolean;
  startsOn: string;
  weekKey: string;
  challenges: ChallengeView[];
}
/** Awards that earn the "Weekly Challenge Complete!" banner (G2 challenge #1 is the existing weekly mission). */
const isChallengeAward = (action: string) => action.startsWith('challenge_') || action === 'weekly_3day_check';

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
  const [ch,     setCh]       = useState<ChallengesResponse | null>(null);
  // The server-derived default grade from the FIRST status load (before any switching).
  const defaultGrade = useRef<Grade | null>(null);

  const load = useCallback(async (g?: Grade | null) => {
    try {
      setError(false);
      const r = await fetch(`/api/gaspoints${g ? `?grade=${g}` : ''}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json() as Status;
      if (!d.eligible) { setHidden(true); return; }
      setStatus(d);
      if (d.pulse) {
        setPulse(d.pulse); setGrade(d.pulse.grade);
        if (defaultGrade.current === null && !g) defaultGrade.current = d.pulse.grade;
      }
    } catch { setError(true); }
  }, []);

  const loadChallenges = useCallback(async () => {
    try {
      const r = await fetch('/api/gaspoints/challenges', { cache: 'no-store' });
      if (!r.ok) return;
      setCh(await r.json() as ChallengesResponse);
    } catch { /* the weekly section simply stays hidden */ }
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    void load(null);
    void loadChallenges();
  }, [authStatus, load, loadChallenges]);

  // A fill-up or a new vehicle can advance a weekly challenge (Pump Tracker / slot 3): re-read.
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    const refresh = () => { void load(grade); void loadChallenges(); };
    window.addEventListener('fillup-saved', refresh);
    window.addEventListener('vehicle-saved', refresh);
    return () => { window.removeEventListener('fillup-saved', refresh); window.removeEventListener('vehicle-saved', refresh); };
  }, [authStatus, grade, load, loadChallenges]);

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
      void loadChallenges();
    } catch { setError(true); }
    finally { setBusy(false); }
  }

  // Fuel Explorer is completed ONLY by the authoritative POST below, and only when it is this
  // week's selected challenge and still open. Ordinary grade changes stay read-only GETs.
  const explorerOpen = !!ch?.g2Active && ch.challenges.some((c) => c.id === 'fuel_explorer' && c.status === 'available');

  async function pickGrade(next: Grade) {
    if (next === grade || !status?.checkedToday) { setGrade(next); return; }
    setGrade(next);
    await load(next);
    if (explorerOpen && defaultGrade.current !== null && next !== defaultGrade.current) {
      try {
        const r = await fetch('/api/gaspoints/explore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grade: next }),
        });
        if (r.ok) {
          const d = await r.json() as { awards?: AwardSummary[] };
          const got = Array.isArray(d.awards) ? d.awards.filter((a) => isGasPointAction(a.action)) : [];
          if (got.length > 0) { setAwards(got); await loadChallenges(); }
        }
      } catch { /* exploring still works as a read-only comparison */ }
    }
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

      {/* Weekly mission (G1 presentation, shown until the G2 weekly challenges are live) */}
      {!ch?.g2Active && (
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
        {ch && !ch.g2Active && ch.startsOn && (
          <p className="text-[10px] text-slate-500 mt-1" data-testid="g2-starts-notice">
            {t.gasChallenges.startsMonday(new Date(`${ch.startsOn}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}{' '}
            {t.gasChallenges.startsMondayHelp}
          </p>
        )}
      </div>
      )}

      {/* This Week — the three weekly challenges (G2-B). Hidden until the launch week. */}
      {ch?.g2Active && ch.challenges.length > 0 && (
        <div className="px-4 pb-2" data-testid="this-week">
          <p className="text-[11px] font-black text-slate-700 uppercase tracking-wide mb-1">{t.gasChallenges.heading}</p>
          <ul className="space-y-1.5">
            {ch.challenges.map((c) => {
              const name = t.gasChallenges.names[c.id];
              const done = c.status === 'complete';
              const progressText = c.progress === null ? null
                : c.id === 'fuel_check_3day' ? t.gasChallenges.progressDays(c.progress, c.target) : t.gasChallenges.progressCount(c.progress, c.target);
              return (
                <li key={c.id} data-challenge={c.id} className={`rounded-xl border px-3 py-2 ${done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-bold text-slate-800">{done ? '✓ ' : ''}{name}</p>
                    {progressText && <p className="text-[11px] font-bold text-slate-600 shrink-0">{done ? t.gasChallenges.complete : progressText}</p>}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">{t.gasChallenges.descriptions[c.id]}</p>
                  {c.status === 'guidance'
                    ? <p className="text-[10px] text-slate-400">{t.gasChallenges.g1RewardNote(GASPOINT_RULES.first_vehicle)}</p>
                    : c.proposedReward !== null && <p className="text-[10px] font-bold text-amber-700">{t.gasChallenges.rewardLine(c.proposedReward)}</p>}
                  {c.id === 'fuel_explorer' && c.status === 'available' && (
                    <p className="text-[10px] text-slate-500">{status.checkedToday ? t.gasChallenges.exploreHint : t.gasChallenges.exploreNeedsCheck}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Award breakdown from THIS check (server-decided) */}
      {awards.length > 0 && (
        <div className="mx-4 mb-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 animate-fade-in" role="status">
          {awards.some((a) => isChallengeAward(a.action)) && (
            <p className="text-[11px] font-black text-emerald-800 uppercase tracking-wide">{t.gasChallenges.completeBanner}</p>
          )}
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

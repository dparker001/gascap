'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import type { Prediction, ProphetStats, PredictionChoice } from '@/lib/predictions';

// ── Types ──────────────────────────────────────────────────────────────────

interface ProphetResp {
  weekStart:           string;
  prevWeek:            string;
  currentPrice:        number | null;
  thisWeekPrediction:  Prediction | null;
  lastWeekPrediction:  Prediction | null;
  userStats:           ProphetStats | null;
  userRank:            number | null;
  leaderboard:         ProphetStats[];
  totalPlayers:        number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `$${n.toFixed(3)}`;
}

function choiceLabel(c: PredictionChoice) {
  return c === 'up' ? '📈 Going Up' : c === 'down' ? '📉 Going Down' : '➡️ Staying Flat';
}

function choiceColor(c: PredictionChoice) {
  return c === 'up'   ? 'text-red-600'
       : c === 'down' ? 'text-green-600'
       : 'text-slate-600';
}

/** Days until next Monday (resolution day) */
function daysUntilMonday(): number {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  return day === 0 ? 1 : 8 - day;
}

function rankEmoji(rank: number) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

// ── Choice button ──────────────────────────────────────────────────────────

function ChoiceBtn({
  choice, selected, loading, onClick,
}: {
  choice: PredictionChoice;
  selected: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const cfg = {
    up:   { emoji: '📈', label: 'Going Up',    desc: 'Prices will rise',      bg: 'bg-red-50   border-red-200   hover:border-red-400',   active: 'bg-red-500   border-red-500   text-white' },
    down: { emoji: '📉', label: 'Going Down',  desc: 'Prices will fall',      bg: 'bg-green-50 border-green-200 hover:border-green-400', active: 'bg-green-500 border-green-500 text-white' },
    flat: { emoji: '➡️', label: 'Staying Flat', desc: 'Within ±3¢ either way', bg: 'bg-slate-50 border-slate-200 hover:border-slate-400', active: 'bg-slate-600 border-slate-600 text-white' },
  }[choice];

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={[
        'flex-1 rounded-2xl border-2 px-3 py-4 text-center transition-all duration-200',
        'flex flex-col items-center gap-1',
        selected ? cfg.active : `${cfg.bg} text-slate-700`,
        loading ? 'opacity-60 cursor-wait' : 'cursor-pointer',
      ].join(' ')}
    >
      <span className="text-2xl">{cfg.emoji}</span>
      <p className="text-xs font-black leading-tight">{cfg.label}</p>
      <p className={`text-[9px] leading-tight ${selected ? 'text-white/70' : 'text-slate-400'}`}>
        {cfg.desc}
      </p>
    </button>
  );
}

// ── Last week result card ──────────────────────────────────────────────────

function LastWeekResult({ pred }: { pred: Prediction }) {
  if (pred.outcome === 'pending') return null;
  const correct = pred.outcome === 'correct';
  const diff    = pred.resolvedPrice != null
    ? (pred.resolvedPrice - pred.basePrice).toFixed(3)
    : null;

  return (
    <div className={[
      'rounded-2xl border px-4 py-3 flex items-start gap-3',
      correct ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200',
    ].join(' ')}>
      <span className="text-2xl flex-shrink-0 mt-0.5">{correct ? '✅' : '❌'}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-black ${correct ? 'text-green-700' : 'text-red-700'}`}>
          {correct ? `Correct! +${pred.pointsAwarded} pts${(pred.streakAtResolve ?? 0) >= 2 ? ' 🔥 Streak bonus!' : ''}` : 'Wrong prediction — 0 pts'}
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
          You said{' '}
          <span className={`font-bold ${choiceColor(pred.prediction)}`}>
            {choiceLabel(pred.prediction)}
          </span>
          {diff != null && (
            <>
              {' '}· Actual change: <span className="font-bold">{Number(diff) >= 0 ? '+' : ''}{diff}/gal</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// ── Leaderboard ────────────────────────────────────────────────────────────

function Leaderboard({
  board, userId, userRank, userStats,
}: {
  board: ProphetStats[];
  userId?: string;
  userRank: number | null;
  userStats: ProphetStats | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? board : board.slice(0, 5);
  const isOnBoard = board.some((s) => s.userId === userId);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-black text-navy-700">🏆 Prophet Leaderboard</p>
        {board.length > 5 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-amber-600 font-bold hover:underline"
          >
            {expanded ? 'Show less' : `See all ${board.length}`}
          </button>
        )}
      </div>

      {board.length === 0 && (
        <p className="text-[10px] text-slate-400 text-center py-4">
          No predictions resolved yet — be the first prophet!
        </p>
      )}

      <div className="space-y-1.5">
        {visible.map((s) => {
          const isMe = s.userId === userId;
          const accuracy = s.totalPredictions > 0
            ? Math.round((s.correctPredictions / s.totalPredictions) * 100)
            : 0;
          return (
            <div
              key={s.userId}
              className={[
                'flex items-center gap-3 rounded-xl px-3 py-2 border',
                isMe ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100',
              ].join(' ')}
            >
              <span className="text-sm font-black w-8 text-center flex-shrink-0 text-slate-500">
                {rankEmoji(s.rank ?? 0)}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-black truncate ${isMe ? 'text-amber-700' : 'text-slate-700'}`}>
                  {s.userName}{isMe ? ' (you)' : ''}
                </p>
                <p className="text-[9px] text-slate-400">
                  {accuracy}% accuracy · {s.totalPredictions} week{s.totalPredictions !== 1 ? 's' : ''}
                  {s.streak >= 2 && ` · 🔥 ${s.streak} streak`}
                </p>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-sm font-black text-amber-600">{s.totalScore}</p>
                <p className="text-[9px] text-slate-400">pts</p>
              </div>
            </div>
          );
        })}

        {/* Show user's entry if they're off the board */}
        {!isOnBoard && userRank != null && userStats && (
          <>
            <p className="text-[9px] text-center text-slate-400">· · ·</p>
            <div className="flex items-center gap-3 rounded-xl px-3 py-2 border bg-amber-50 border-amber-200">
              <span className="text-sm font-black w-8 text-center flex-shrink-0 text-slate-500">
                #{userRank}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black truncate text-amber-700">
                  {userStats.userName} (you)
                </p>
                <p className="text-[9px] text-slate-400">
                  {userStats.totalPredictions > 0
                    ? Math.round((userStats.correctPredictions / userStats.totalPredictions) * 100)
                    : 0}% accuracy
                </p>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-sm font-black text-amber-600">{userStats.totalScore}</p>
                <p className="text-[9px] text-slate-400">pts</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function GasPriceProphet() {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string })?.id ?? session?.user?.email;

  const [data,       setData]       = useState<ProphetResp | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selected,   setSelected]   = useState<PredictionChoice | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/prophet', { credentials: 'include' })
      .then((r) => r.ok ? r.json() as Promise<ProphetResp> : Promise.reject())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit() {
    if (!selected || !session) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/prophet', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:    JSON.stringify({ prediction: selected }),
      });
      if (res.ok) {
        load();   // refresh state after submitting
        setSelected(null);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-4 space-y-3">
        <div className="h-6 bg-slate-100 rounded-xl animate-pulse w-1/2" />
        <div className="h-24 bg-slate-100 rounded-2xl animate-pulse" />
        <div className="h-32 bg-slate-100 rounded-2xl animate-pulse" />
      </div>
    );
  }

  const pred      = data?.thisWeekPrediction;
  const lastWeek  = data?.lastWeekPrediction;
  const stats     = data?.userStats;
  const hasPred   = !!pred && pred.outcome !== undefined;
  const days      = daysUntilMonday();

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-4 space-y-5">

      {/* ── Header ── */}
      <div className="text-center space-y-1 pb-1 border-b border-slate-100">
        <p className="text-lg font-black text-navy-700">🔮 Gas Price Prophet</p>
        <p className="text-[11px] text-slate-500 leading-snug">
          Predict whether national gas prices will go <strong>up</strong>, <strong>down</strong>, or stay <strong>flat</strong> this week.
          Earn points for correct calls. Hot streaks score big.
        </p>
        {data?.currentPrice && (
          <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1 mt-1">
            <span className="text-[10px] text-slate-500">National avg this week:</span>
            <span className="text-sm font-black text-navy-700">{fmt(data.currentPrice)}<span className="text-xs font-normal">/gal</span></span>
          </div>
        )}
        {!data?.currentPrice && (
          <p className="text-[10px] text-amber-600 mt-1">⚠️ Gas price data unavailable — predictions paused.</p>
        )}
      </div>

      {/* ── Last week result ── */}
      {lastWeek && lastWeek.outcome !== 'pending' && (
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Last week</p>
          <LastWeekResult pred={lastWeek} />
        </div>
      )}

      {/* ── User stats strip ── */}
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-amber-50 rounded-xl p-2.5 text-center">
            <p className="text-lg font-black text-amber-600">{stats.totalScore}</p>
            <p className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">pts</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-2.5 text-center">
            <p className="text-lg font-black text-navy-700">
              {stats.totalPredictions > 0
                ? `${Math.round((stats.correctPredictions / stats.totalPredictions) * 100)}%`
                : '—'}
            </p>
            <p className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">accuracy</p>
          </div>
          <div className={`rounded-xl p-2.5 text-center ${stats.streak >= 2 ? 'bg-orange-50' : 'bg-slate-50'}`}>
            <p className={`text-lg font-black ${stats.streak >= 2 ? 'text-orange-500' : 'text-slate-400'}`}>
              {stats.streak >= 1 ? `${stats.streak}🔥` : '—'}
            </p>
            <p className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">streak</p>
          </div>
        </div>
      )}

      {/* ── Prediction area ── */}
      {!session ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4 text-center space-y-2">
          <p className="text-2xl">🔮</p>
          <p className="text-sm font-black text-amber-800">Sign in to make predictions</p>
          <p className="text-[10px] text-amber-600">
            Track your score, build a streak, and climb the leaderboard.
          </p>
          <a
            href="/signin"
            className="inline-block mt-1 bg-amber-500 hover:bg-amber-400 text-white
                       font-black text-xs px-4 py-2 rounded-xl transition-colors"
          >
            Sign In →
          </a>
        </div>
      ) : hasPred && pred ? (
        /* Already predicted this week */
        <div className="bg-navy-700 rounded-2xl px-4 py-4 space-y-2">
          <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Your prediction this week</p>
          <div className="flex items-center justify-between">
            <p className={`text-base font-black ${
              pred.prediction === 'up'   ? 'text-red-400'   :
              pred.prediction === 'down' ? 'text-green-400' : 'text-slate-300'
            }`}>
              {choiceLabel(pred.prediction)}
            </p>
            {pred.basePrice && (
              <p className="text-[10px] text-white/40">at {fmt(pred.basePrice)}/gal</p>
            )}
          </div>
          <p className="text-[10px] text-white/50 leading-snug">
            {pred.outcome === 'pending'
              ? `Resolves in ${days} day${days !== 1 ? 's' : ''} on Monday when the new EIA weekly price is published.`
              : pred.outcome === 'correct'
                ? `✅ Correct! You earned ${pred.pointsAwarded} pts.`
                : `❌ Not quite this time — 0 pts.`}
          </p>
        </div>
      ) : data?.currentPrice ? (
        /* Make prediction */
        <div className="space-y-3">
          <p className="text-xs font-black text-slate-700 text-center">
            Will the national average be higher, lower, or the same next week?
          </p>
          <div className="flex gap-2">
            {(['up', 'down', 'flat'] as PredictionChoice[]).map((c) => (
              <ChoiceBtn
                key={c}
                choice={c}
                selected={selected === c}
                loading={submitting}
                onClick={() => setSelected(c)}
              />
            ))}
          </div>
          <button
            onClick={handleSubmit}
            disabled={!selected || submitting}
            className={[
              'w-full py-3.5 rounded-2xl font-black text-sm transition-all',
              selected && !submitting
                ? 'bg-amber-500 hover:bg-amber-400 text-white shadow-md'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed',
            ].join(' ')}
          >
            {submitting ? 'Submitting…' : selected ? `Lock In: ${choiceLabel(selected)} ⚡` : 'Pick your prediction above'}
          </button>
          <p className="text-[10px] text-slate-400 text-center">
            One prediction per week · resolves next Monday · no changes after submitting
          </p>
        </div>
      ) : null}

      {/* ── Scoring guide ── */}
      <div className="bg-slate-50 rounded-2xl px-4 py-3 space-y-1.5">
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Scoring</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {[
            ['1 correct', '10 pts'],
            ['2 in a row', '15 pts'],
            ['3 in a row', '20 pts'],
            ['4+ in a row 🔥', '25 pts'],
          ].map(([label, pts]) => (
            <div key={label} className="flex justify-between items-center">
              <p className="text-[10px] text-slate-500">{label}</p>
              <p className="text-[10px] font-black text-amber-600">{pts}</p>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-slate-400 mt-1 leading-snug">
          Flat = within ±3¢. Prices resolve Monday using the U.S. EIA weekly average.
        </p>
      </div>

      {/* ── Leaderboard ── */}
      <Leaderboard
        board={data?.leaderboard ?? []}
        userId={userId}
        userRank={data?.userRank ?? null}
        userStats={stats ?? null}
      />
    </div>
  );
}

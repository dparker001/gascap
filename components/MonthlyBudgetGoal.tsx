'use client';

import { useSession }           from 'next-auth/react';
import { useEffect, useState, useCallback } from 'react';
import UpgradeNudge from './UpgradeNudge';

interface GoalData {
  limit:       number | null;
  spent:       number;
  month:       string;   // YYYY-MM
  daysLeft:    number;
  daysInMonth: number;
  pct:         number | null;
}

const QUICK_AMOUNTS = [50, 100, 150, 200, 300];

/** Color band for progress bar / text */
function band(pct: number): { bar: string; text: string; bg: string } {
  if (pct >= 90) return { bar: 'bg-red-500',   text: 'text-red-600',   bg: 'bg-red-50'   };
  if (pct >= 70) return { bar: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50' };
  return               { bar: 'bg-green-500',  text: 'text-green-600', bg: 'bg-green-50' };
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function MonthlyBudgetGoal() {
  const { data: session, status } = useSession();
  const [data,     setData]     = useState<GoalData | null>(null);
  const [open,     setOpen]     = useState(false);
  const [editing,  setEditing]  = useState(false);
  const [input,    setInput]    = useState('');
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/budget-goal');
    if (res.ok) setData(await res.json() as GoalData);
  }, []);

  useEffect(() => {
    if (session && open && !data) load();
  }, [session, open, data, load]);

  // Reload when a fillup is saved
  useEffect(() => {
    const handler = () => { if (data) load(); };
    window.addEventListener('fillup-saved', handler);
    return () => window.removeEventListener('fillup-saved', handler);
  }, [data, load]);

  if (status === 'loading' || !session) return null;

  const userPlan = (session?.user as { plan?: string })?.plan ?? 'free';
  const hasGoal = data?.limit != null;
  const pct     = data?.pct  ?? 0;
  const colors  = hasGoal ? band(pct) : { bar: 'bg-slate-200', text: 'text-slate-400', bg: 'bg-slate-50' };

  async function handleSave() {
    const val = parseFloat(input);
    if (!val || val <= 0) return;
    setSaving(true);
    await fetch('/api/budget-goal', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ monthlyLimit: val }),
    });
    setSaving(false);
    setEditing(false);
    setInput('');
    load();
  }

  async function handleDelete() {
    setDeleting(true);
    await fetch('/api/budget-goal', { method: 'DELETE' });
    setDeleting(false);
    setData(null);
    load();
  }

  return (
    <div className="mb-2 rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-2.5 px-4 bg-navy-700
                   hover:bg-navy-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm" aria-hidden="true">💰</span>
          <div className="text-left">
            <p className="text-xs font-black text-white uppercase tracking-wider">Monthly Budget</p>
            {hasGoal && data ? (
              <p className="text-[10px] text-white/70 font-semibold">
                ${data.spent.toFixed(2)} / ${data.limit!.toFixed(0)} · {data.daysLeft}d left
              </p>
            ) : (
              <p className="text-[10px] text-white/50">Set a monthly fuel spending goal</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasGoal && data && (
            <div className="flex flex-col items-end gap-1">
              <span className="text-sm font-black text-white/80">{pct}%</span>
              <div className="w-16 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>
          )}
          <svg
            className={`w-4 h-4 text-white/60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-white p-4 space-y-4">

          {/* No goal set yet */}
          {!hasGoal && !editing && (
            <div className="text-center py-2">
              <p className="text-2xl mb-2">🎯</p>
              <p className="text-sm font-bold text-slate-600">No budget goal set</p>
              <p className="text-xs text-slate-400 mt-1 mb-4">
                Set a monthly limit to track your fuel spend and get alerts before you overshoot.
              </p>
              <button
                onClick={() => setEditing(true)}
                className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-bold transition-colors"
              >
                Set My Budget →
              </button>
            </div>
          )}

          {/* Goal set — progress view */}
          {hasGoal && data && !editing && (
            <>
              {/* Month label */}
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {monthLabel(data.month)}
              </p>

              {/* Big progress bar */}
              <div>
                <div className="flex justify-between items-end mb-1.5">
                  <span className={`text-2xl font-black ${colors.text}`}>
                    ${data.spent.toFixed(2)}
                  </span>
                  <span className="text-sm text-slate-400 font-semibold">
                    of ${data.limit!.toFixed(2)}
                  </span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${colors.bar}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-slate-400">{pct}% used</span>
                  <span className="text-[10px] text-slate-400">{data.daysLeft} days left</span>
                </div>
              </div>

              {/* Status message */}
              <div className={`rounded-xl px-3 py-2.5 ${colors.bg}`}>
                {pct >= 100 && (
                  <p className="text-xs font-bold text-red-700">
                    🚨 You&apos;ve hit your monthly budget. Consider waiting until next month.
                  </p>
                )}
                {pct >= 90 && pct < 100 && (
                  <p className="text-xs font-bold text-red-600">
                    ⚠️ Almost at your limit — only ${(data.limit! - data.spent).toFixed(2)} remaining.
                  </p>
                )}
                {pct >= 70 && pct < 90 && (
                  <p className="text-xs font-semibold text-amber-700">
                    🟡 You&apos;ve used {pct}% of your budget with {data.daysLeft} days to go.
                  </p>
                )}
                {pct < 70 && (
                  <p className="text-xs font-semibold text-green-700">
                    ✅ On track — ${(data.limit! - data.spent).toFixed(2)} remaining for the month.
                  </p>
                )}
              </div>

              {pct >= 90 && userPlan === 'free' && (
                <UpgradeNudge
                  emoji="🔔"
                  headline="Get alerted before you go over"
                  body="GasCap Pro sends you a push notification when you hit 80% of your monthly budget — before it's too late."
                  ctaText="Upgrade for budget alerts →"
                />
              )}

              {/* Projected overage warning */}
              {data.spent > 0 && data.daysInMonth > 0 && (() => {
                const dailyRate  = data.spent / (data.daysInMonth - data.daysLeft || 1);
                const projected  = dailyRate * data.daysInMonth;
                const overage    = projected - data.limit!;
                if (overage > 2) {
                  return (
                    <p className="text-[11px] text-amber-600 font-medium text-center">
                      📊 At your current rate, you&apos;re projected to spend <strong>${projected.toFixed(2)}</strong>
                      {' '}this month (+${overage.toFixed(2)} over budget).
                    </p>
                  );
                }
                return null;
              })()}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setEditing(true); setInput(String(data.limit)); }}
                  className="flex-1 py-2 rounded-xl border-2 border-slate-200 text-xs font-semibold
                             text-slate-600 hover:border-amber-300 transition-colors"
                >
                  Change Goal
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 rounded-xl border-2 border-slate-200 text-xs font-semibold
                             text-slate-400 hover:border-red-200 hover:text-red-400 transition-colors disabled:opacity-50"
                >
                  {deleting ? '…' : 'Remove'}
                </button>
              </div>
            </>
          )}

          {/* Edit / set form */}
          {editing && (
            <div className="space-y-3">
              <p className="text-sm font-bold text-slate-700">
                {hasGoal ? 'Update monthly budget' : 'Set a monthly fuel budget'}
              </p>

              {/* Quick-pick buttons */}
              <div className="flex gap-2 flex-wrap">
                {QUICK_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setInput(String(amt))}
                    className={[
                      'px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all',
                      input === String(amt)
                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
                    ].join(' ')}
                  >
                    ${amt}
                  </button>
                ))}
              </div>

              {/* Custom input */}
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold pointer-events-none">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  className="input-field pl-8"
                  placeholder="Custom amount"
                  value={input}
                  min="1"
                  step="1"
                  onChange={(e) => setInput(e.target.value)}
                  autoFocus
                />
              </div>

              <p className="text-[10px] text-slate-400">
                💡 GasCap will track your monthly fuel spending against this limit and alert you when you&apos;re approaching it.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => { setEditing(false); setInput(''); }}
                  className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-semibold text-slate-500 hover:border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !input || parseFloat(input) <= 0}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-bold disabled:opacity-40 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save Goal ✓'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

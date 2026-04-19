'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface EntrantRow {
  userId:     string;
  name:       string;
  email:      string;
  plan:       string;
  entryCount: number;
}

interface DrawRecord {
  id:           string;
  month:        string;
  winnerName:   string;
  winnerEmail:  string;
  entryCount:   number;
  totalEntries: number;
  drawnAt:      string;
  notes:        string | null;
}

const SESSION_KEY = 'gascap_admin_session';
const SESSION_TTL = 15 * 60 * 1000;

function loadSession(): string | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { pw, ts } = JSON.parse(raw) as { pw: string; ts: number };
    if (Date.now() - ts > SESSION_TTL) { sessionStorage.removeItem(SESSION_KEY); return null; }
    return pw;
  } catch { return null; }
}

function currentMonthStr(): string {
  return new Date().toISOString().slice(0, 7);
}

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-');
  const names = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  return `${names[parseInt(mo, 10) - 1]} ${y}`;
}

export default function SweepstakesAdminPage() {
  const [password,  setPassword]  = useState('');
  const [authed,    setAuthed]    = useState(false);
  const [authErr,   setAuthErr]   = useState('');
  const [savedPw,   setSavedPw]   = useState('');

  const [month,     setMonth]     = useState(currentMonthStr());
  const [entrants,  setEntrants]  = useState<EntrantRow[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [previewed, setPreviewed] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const [drawing,   setDrawing]   = useState(false);
  const [winner,    setWinner]    = useState<DrawRecord | null>(null);
  const [drawErr,   setDrawErr]   = useState('');

  const [history,   setHistory]   = useState<DrawRecord[]>([]);
  const [notes,     setNotes]     = useState('');

  const loadHistory = useCallback(async (pw: string) => {
    const res = await fetch('/api/admin/sweepstakes?history=1', {
      headers: { 'x-admin-password': pw },
    });
    if (res.ok) {
      const data = await res.json() as { draws: DrawRecord[] };
      setHistory(data.draws);
    }
  }, []);

  // Auto-login from session
  useEffect(() => {
    const pw = loadSession();
    if (pw) { setSavedPw(pw); setAuthed(true); loadHistory(pw); }
  }, [loadHistory]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/admin/sweepstakes?month=${month}`, {
      headers: { 'x-admin-password': password },
    });
    if (res.status === 401 || res.status === 503) { setAuthErr('Wrong password.'); return; }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ pw: password, ts: Date.now() }));
    setSavedPw(password);
    setAuthed(true);
    setAuthErr('');
    await loadHistory(password);
  }

  async function handlePreview() {
    setPreviewing(true);
    setDrawErr('');
    const res = await fetch(`/api/admin/sweepstakes?month=${month}`, {
      headers: { 'x-admin-password': savedPw },
    });
    const data = await res.json() as { entrants: EntrantRow[]; totalEntries: number };
    setEntrants(data.entrants ?? []);
    setTotalEntries(data.totalEntries ?? 0);
    setPreviewed(true);
    setPreviewing(false);
    setWinner(null);
  }

  async function handleDraw() {
    if (!confirm(`Run the weighted draw for ${fmtMonth(month)}? This cannot be undone.`)) return;
    setDrawing(true);
    setDrawErr('');
    const res = await fetch('/api/admin/sweepstakes', {
      method:  'POST',
      headers: { 'x-admin-password': savedPw, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ month, notes: notes.trim() || undefined }),
    });
    const data = await res.json() as { ok?: boolean; draw?: DrawRecord; error?: string; existing?: DrawRecord };
    setDrawing(false);
    if (res.status === 409) {
      setDrawErr(`A draw for ${fmtMonth(month)} was already run.`);
      if (data.existing) setWinner(data.existing);
      return;
    }
    if (!res.ok || !data.draw) {
      setDrawErr(data.error ?? 'Draw failed.');
      return;
    }
    setWinner(data.draw);
    await loadHistory(savedPw);
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#eef1f7] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm space-y-4">
          <div className="text-center">
            <p className="text-2xl mb-1">🎁</p>
            <p className="text-sm font-black text-slate-700">Sweepstakes Admin</p>
            <p className="text-xs text-slate-500 mt-0.5">GasCap™ Monthly Gas Card Drawing</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal"
            />
            {authErr && <p className="text-xs text-red-500">{authErr}</p>}
            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-brand-dark hover:bg-brand-teal text-white font-black text-sm transition-colors"
            >
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef1f7] p-4">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-black text-slate-700">🎁 Gas Card Drawing</p>
            <p className="text-xs text-slate-500">Monthly sweepstakes admin</p>
          </div>
          <Link href="/admin" className="text-xs text-slate-500 hover:text-brand-teal transition-colors">
            ← Admin
          </Link>
        </div>

        {/* Draw panel */}
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
          <p className="text-sm font-black text-slate-700">Run Monthly Drawing</p>

          {/* Selected month — human-readable */}
          <div className="flex items-center justify-between">
            <p className="text-base font-black text-slate-700">{fmtMonth(month)}</p>
            <input
              type="month"
              value={month}
              onChange={(e) => { setMonth(e.target.value); setPreviewed(false); setWinner(null); }}
              className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-500
                         focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {/* Preview button */}
          <button
            onClick={handlePreview}
            disabled={previewing}
            className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700
                       text-sm font-bold transition-colors disabled:opacity-50"
          >
            {previewing
              ? 'Loading…'
              : previewed
                ? `↻ Refresh  (${totalEntries} ${totalEntries === 1 ? 'entry' : 'entries'})`
                : `Click to Preview ${fmtMonth(month)} Entries`}
          </button>

          {/* Entrant table */}
          {previewed && (
            <div className="space-y-2">
              {entrants.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">
                  No eligible Pro/Fleet users with active days in {fmtMonth(month)}.
                </p>
              ) : (
                <>
                  <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wide px-1">
                    <span>User</span>
                    <span>Entries · Odds</span>
                  </div>
                  <div className="divide-y divide-slate-50 rounded-xl border border-slate-100 overflow-hidden">
                    {entrants.map((e) => (
                      <div key={e.userId} className="flex items-center justify-between px-3 py-2 bg-white">
                        <div>
                          <p className="text-sm font-semibold text-slate-700">{e.name}</p>
                          <p className="text-[11px] text-slate-500">{e.email} · <span className="uppercase text-[10px] font-bold text-amber-600">{e.plan}</span></p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-slate-700">{e.entryCount}</p>
                          <p className="text-[10px] text-slate-400">
                            {totalEntries > 0 ? `${((e.entryCount / totalEntries) * 100).toFixed(1)}%` : '—'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 px-1 pt-1">
                    <span>{entrants.length} eligible user{entrants.length !== 1 ? 's' : ''}</span>
                    <span>{totalEntries} total entries</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Notes */}
          {previewed && entrants.length > 0 && (
            <input
              type="text"
              placeholder="Optional notes (e.g. prize amount, card type)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={200}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          )}

          {/* Draw button */}
          {previewed && entrants.length > 0 && !winner && (
            <button
              onClick={handleDraw}
              disabled={drawing}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-black text-sm transition-colors disabled:opacity-50"
            >
              {drawing ? '🎲 Drawing…' : `🎰 Draw Winner for ${fmtMonth(month)}`}
            </button>
          )}

          {drawErr && (
            <p className="text-sm text-red-500 text-center">{drawErr}</p>
          )}

          {/* Winner reveal */}
          {winner && (
            <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-300 p-5 text-center space-y-2">
              <p className="text-3xl">🏆</p>
              <p className="text-xs font-bold text-amber-600 uppercase tracking-wider">{fmtMonth(winner.month)} Winner</p>
              <p className="text-xl font-black text-slate-800">{winner.winnerName}</p>
              <p className="text-sm text-slate-600">{winner.winnerEmail}</p>
              <p className="text-[11px] text-slate-500">
                {winner.entryCount} entr{winner.entryCount !== 1 ? 'ies' : 'y'} out of {winner.totalEntries} total
                {' '}· {((winner.entryCount / winner.totalEntries) * 100).toFixed(1)}% odds
              </p>
              {winner.notes && (
                <p className="text-[11px] text-slate-500 italic">{winner.notes}</p>
              )}
              <p className="text-[10px] text-slate-400 mt-1">
                Drawn {new Date(winner.drawnAt).toLocaleString()}
              </p>
            </div>
          )}
        </div>

        {/* Draw history */}
        {history.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <p className="px-5 py-4 text-sm font-black text-slate-700 border-b border-slate-100">
              Past Drawings
            </p>
            <div className="divide-y divide-slate-50">
              {history.map((d) => (
                <div key={d.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-700">{fmtMonth(d.month)}</p>
                    <p className="text-xs text-slate-600">{d.winnerName} · {d.winnerEmail}</p>
                    {d.notes && <p className="text-[10px] text-slate-500 italic mt-0.5">{d.notes}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-bold text-amber-600">{d.entryCount} / {d.totalEntries}</p>
                    <p className="text-[10px] text-slate-400">{new Date(d.drawnAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] text-slate-500 text-center pb-4">
          GasCap™ Sweepstakes Admin · <Link href="/sweepstakes-rules" className="underline">Official Rules</Link>
        </p>
      </div>
    </div>
  );
}

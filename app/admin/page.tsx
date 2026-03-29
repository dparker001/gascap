'use client';

import { useState, useEffect, useCallback } from 'react';

interface AdminUser {
  id:               string;
  name:             string;
  email:            string;
  plan:             'free' | 'pro' | 'fleet';
  emailVerified:    boolean;
  createdAt:        string;
  referralCount:    number;
  stripeCustomerId: string | null;
}

const PLAN_COLORS = {
  free:  'bg-slate-100 text-slate-600',
  pro:   'bg-amber-100 text-amber-700',
  fleet: 'bg-blue-100 text-blue-700',
};

const SESSION_KEY = 'gascap_admin_session';
const SESSION_TTL = 15 * 60 * 1000; // 15 minutes

function saveSession(pw: string) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ pw, ts: Date.now() }));
}
function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}
function loadSession(): string | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { pw, ts } = JSON.parse(raw) as { pw: string; ts: number };
    if (Date.now() - ts > SESSION_TTL) { clearSession(); return null; }
    return pw;
  } catch { return null; }
}

export default function AdminPage() {
  const [password,  setPassword]  = useState('');
  const [authed,    setAuthed]    = useState(false);
  const [authErr,   setAuthErr]   = useState('');
  const [users,     setUsers]     = useState<AdminUser[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [search,    setSearch]    = useState('');
  const [msg,       setMsg]       = useState('');
  const [savedPw,   setSavedPw]   = useState('');

  const load = useCallback(async (pw: string) => {
    setLoading(true);
    const res  = await fetch('/api/admin/users', { headers: { 'x-admin-password': pw } });
    setLoading(false);
    if (res.status === 401) { setAuthErr('Wrong password.'); clearSession(); return; }
    const data = await res.json() as { users: AdminUser[] };
    setUsers(data.users);
    setSavedPw(pw);
    saveSession(pw);
    setAuthed(true);
    setAuthErr('');
  }, []);

  // Auto-login from sessionStorage on mount
  useEffect(() => {
    const pw = loadSession();
    if (pw) load(pw);
  }, [load]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    await load(password);
  }

  function handleLogout() {
    clearSession();
    setAuthed(false);
    setSavedPw('');
    setPassword('');
    setUsers([]);
  }

  async function handleDelete(user: AdminUser) {
    if (!confirm(`Delete ${user.name} (${user.email})? This cannot be undone.`)) return;
    await fetch(`/api/admin/users?id=${user.id}`, {
      method: 'DELETE',
      headers: { 'x-admin-password': savedPw },
    });
    setMsg(`Deleted ${user.email}`);
    await load(savedPw);
  }

  async function handlePlan(user: AdminUser, plan: string) {
    await fetch(`/api/admin/users?id=${user.id}`, {
      method:  'PATCH',
      headers: { 'x-admin-password': savedPw, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ plan }),
    });
    setMsg(`Updated ${user.email} → ${plan}`);
    await load(savedPw);
  }

  async function handleVerify(user: AdminUser) {
    await fetch(`/api/admin/users?id=${user.id}`, {
      method:  'PATCH',
      headers: { 'x-admin-password': savedPw, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ emailVerified: true }),
    });
    setMsg(`Verified ${user.email}`);
    await load(savedPw);
  }

  const filtered = users.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()),
  );

  const stats = {
    total: users.length,
    free:  users.filter((u) => u.plan === 'free').length,
    pro:   users.filter((u) => u.plan === 'pro').length,
    fleet: users.filter((u) => u.plan === 'fleet').length,
    unverified: users.filter((u) => !u.emailVerified).length,
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#eef1f7] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm space-y-4">
          <div className="text-center">
            <p className="text-2xl font-black text-navy-700">GasCap™ Admin</p>
            <p className="text-xs text-slate-400 mt-1">Restricted access</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            {authErr && <p className="text-xs text-red-500">{authErr}</p>}
            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-black text-sm transition-colors"
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
      <div className="max-w-5xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xl font-black text-navy-700">GasCap™ Admin</p>
            <p className="text-xs text-slate-400">User management</p>
          </div>
          <button onClick={handleLogout} className="text-xs text-slate-400 hover:text-red-500 transition-colors">
            Sign out
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total Users', value: stats.total, color: 'text-navy-700' },
            { label: 'Free',        value: stats.free,  color: 'text-slate-600' },
            { label: 'Pro',         value: stats.pro,   color: 'text-amber-600' },
            { label: 'Fleet',       value: stats.fleet, color: 'text-blue-600' },
            { label: 'Unverified',  value: stats.unverified, color: 'text-red-500' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl p-3 text-center shadow-sm">
              <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Flash message */}
        {msg && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2 text-sm text-green-700 flex justify-between">
            <span>✓ {msg}</span>
            <button onClick={() => setMsg('')} className="text-green-400 hover:text-green-600">×</button>
          </div>
        )}

        {/* Search */}
        <input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
        />

        {/* User table */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No users found.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {filtered.map((u) => (
                <div key={u.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  {/* User info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-slate-700 truncate">{u.name}</p>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${PLAN_COLORS[u.plan]}`}>
                        {u.plan.toUpperCase()}
                      </span>
                      {!u.emailVerified && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                          UNVERIFIED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 truncate">{u.email}</p>
                    <p className="text-[10px] text-slate-300">
                      Joined {new Date(u.createdAt).toLocaleDateString()} ·{' '}
                      {u.referralCount} referrals
                      {u.stripeCustomerId && ' · Stripe ✓'}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Plan selector */}
                    <select
                      value={u.plan}
                      onChange={(e) => handlePlan(u, e.target.value)}
                      className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none"
                    >
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                      <option value="fleet">Fleet</option>
                    </select>

                    {/* Verify button */}
                    {!u.emailVerified && (
                      <button
                        onClick={() => handleVerify(u)}
                        className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 font-semibold transition-colors"
                      >
                        ✓ Verify
                      </button>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={() => handleDelete(u)}
                      className="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 font-semibold transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-[10px] text-slate-300 text-center pb-4">
          GasCap™ Admin · {users.length} total users
        </p>
      </div>
    </div>
  );
}

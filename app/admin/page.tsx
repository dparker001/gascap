'use client';

import { useState, useEffect, useCallback } from 'react';

interface FeedbackItem {
  id:        string;
  name:      string;
  email:     string;
  message:   string;
  page:      string;
  createdAt: string;
  read:      boolean;
}

interface AdminUser {
  id:               string;
  name:             string;
  email:            string;
  plan:             'free' | 'pro' | 'fleet';
  emailVerified:    boolean;
  createdAt:        string;
  referralCount:    number;
  referralCode:     string | null;
  referredBy:       string | null;
  referredByName:   string | null;
  referredUsers:    { name: string; email: string; joinedAt: string }[];
  stripeCustomerId: string | null;
  isBetaTester?:    boolean;
  betaProExpiry?:   string | null;
  pushSubscribed?:  boolean;
  isTestAccount?:   boolean;
  // Activity metrics
  loginCount:       number;
  lastLoginAt:      string | null;
  calcCount:        number;
  activeDays:       number;
  streak:           number;
  fillupCount:      number;
  lastFillup:       string | null;
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
  // ── Filters & sort ────────────────────────────────────────────────────
  const [filterPlan,     setFilterPlan]     = useState<'all'|'free'|'pro'|'fleet'>('all');
  const [filterStatus,   setFilterStatus]   = useState<'all'|'verified'|'unverified'>('all');
  const [filterActivity, setFilterActivity] = useState<'all'|'today'|'has-fillups'|'no-logins'|'has-streak'>('all');
  const [filterStripe,   setFilterStripe]   = useState<'all'|'stripe'|'no-stripe'>('all');
  const [filterPush,     setFilterPush]     = useState<'all'|'subscribed'|'not-subscribed'>('all');
  const [sortBy,         setSortBy]         = useState<'joined-desc'|'joined-asc'|'logins'|'calcs'|'fillups'|'streak'>('joined-desc');
  const [savedPw,   setSavedPw]   = useState('');
  const [pushMsg,        setPushMsg]        = useState('');
  const [pushLoading,    setPushLoading]    = useState<'all' | 'user' | 'broadcast' | null>(null);
  const [pushEmail,      setPushEmail]      = useState('');
  const [subCount,       setSubCount]       = useState<number | null>(null);
  const [bcastTitle,     setBcastTitle]     = useState('');
  const [bcastBody,      setBcastBody]      = useState('');
  const [bcastUrl,       setBcastUrl]       = useState('');
  const [bcastEmail,     setBcastEmail]     = useState('');
  const [bcastMsg,       setBcastMsg]       = useState('');
  const [feedback,  setFeedback]  = useState<FeedbackItem[]>([]);
  const [fbOpen,    setFbOpen]    = useState(false);

  const load = useCallback(async (pw: string) => {
    setLoading(true);
    const [usersRes, fbRes] = await Promise.all([
      fetch('/api/admin/users',    { headers: { 'x-admin-password': pw } }),
      fetch('/api/admin/feedback', { headers: { 'x-admin-password': pw } }),
    ]);
    setLoading(false);
    if (usersRes.status === 401) { setAuthErr('Wrong password.'); clearSession(); return; }
    const usersData = await usersRes.json() as { users: AdminUser[] };
    setUsers(usersData.users);
    if (fbRes.ok) {
      const fbData = await fbRes.json() as { feedback: FeedbackItem[] };
      setFeedback(fbData.feedback);
    }
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

  async function handlePushAll() {
    setPushLoading('all');
    setPushMsg('');
    try {
      const res  = await fetch('/api/push/digest?all=1', { headers: { 'x-admin-password': savedPw } });
      const data = await res.json() as { sent?: number; skipped?: number; error?: string };
      if (data.error) { setPushMsg(`❌ ${data.error}`); }
      else { setPushMsg(`✅ Sent to ${data.sent ?? 0} subscriber(s). ${data.skipped ?? 0} skipped/expired.`); }
    } catch { setPushMsg('❌ Network error.'); }
    finally { setPushLoading(null); }
  }

  async function handlePushUser() {
    if (!pushEmail.trim()) return;
    const user = users.find((u) => u.email.toLowerCase() === pushEmail.trim().toLowerCase());
    if (!user) { setPushMsg('❌ User not found.'); return; }
    setPushLoading('user');
    setPushMsg('');
    try {
      const res  = await fetch(`/api/push/digest?userId=${user.id}`, { headers: { 'x-admin-password': savedPw } });
      const data = await res.json() as { sent?: number; error?: string };
      if (data.error) { setPushMsg(`❌ ${data.error}`); }
      else if ((data.sent ?? 0) === 0) { setPushMsg(`⚠️ ${user.email} has no active push subscription.`); }
      else { setPushMsg(`✅ Digest sent to ${user.email}.`); }
    } catch { setPushMsg('❌ Network error.'); }
    finally { setPushLoading(null); }
  }

  async function handleBetaGrant(user: AdminUser) {
    await fetch(`/api/admin/users?id=${user.id}`, {
      method:  'PATCH',
      headers: { 'x-admin-password': savedPw, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ grantBetaTrial: 30 }),
    });
    setMsg(`✅ 30-day Pro trial granted to ${user.email}`);
    await load(savedPw);
  }

  async function handleBetaRevoke(user: AdminUser) {
    if (!confirm(`Revoke beta trial for ${user.name}? They will revert to Free.`)) return;
    await fetch(`/api/admin/users?id=${user.id}`, {
      method:  'PATCH',
      headers: { 'x-admin-password': savedPw, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ revokeBetaTrial: true }),
    });
    setMsg(`Revoked beta trial for ${user.email}`);
    await load(savedPw);
  }

  async function handleTestAccount(user: AdminUser, enable: boolean) {
    await fetch(`/api/admin/users?id=${user.id}`, {
      method:  'PATCH',
      headers: { 'x-admin-password': savedPw, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ isTestAccount: enable }),
    });
    setMsg(enable
      ? `🧪 ${user.email} marked as test account — unlimited vehicles, no plan limits`
      : `Removed test account flag from ${user.email}`);
    await load(savedPw);
  }

  async function handleFbRead(id: string) {
    await fetch(`/api/admin/feedback?id=${id}`, {
      method: 'PATCH', headers: { 'x-admin-password': savedPw },
    });
    setFeedback((prev) => prev.map((f) => f.id === id ? { ...f, read: true } : f));
  }

  async function handleFbDelete(id: string) {
    await fetch(`/api/admin/feedback?id=${id}`, {
      method: 'DELETE', headers: { 'x-admin-password': savedPw },
    });
    setFeedback((prev) => prev.filter((f) => f.id !== id));
  }

  async function loadSubCount() {
    const res = await fetch('/api/push/broadcast', { headers: { 'x-admin-password': savedPw } });
    if (res.ok) {
      const data = await res.json() as { count: number };
      setSubCount(data.count);
    }
  }

  async function handleBroadcast() {
    if (!bcastTitle.trim() || !bcastBody.trim()) {
      setBcastMsg('❌ Title and message are required.');
      return;
    }
    setPushLoading('broadcast');
    setBcastMsg('');
    try {
      const res  = await fetch('/api/push/broadcast', {
        method:  'POST',
        headers: { 'x-admin-password': savedPw, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title: bcastTitle, body: bcastBody, url: bcastUrl || '/', ...(bcastEmail.trim() ? { email: bcastEmail.trim() } : {}) }),
      });
      const data = await res.json() as { sent?: number; skipped?: number; error?: string };
      if (data.error) { setBcastMsg(`❌ ${data.error}`); }
      else {
        setBcastMsg(`✅ Sent to ${data.sent ?? 0} subscriber(s). ${data.skipped ?? 0} skipped.`);
        setBcastTitle('');
        setBcastBody('');
        setBcastUrl('');
        setBcastEmail('');
      }
    } catch { setBcastMsg('❌ Network error.'); }
    finally { setPushLoading(null); }
  }

  const today = new Date().toLocaleDateString();

  const filtered = users
    .filter((u) => {
      const q = search.toLowerCase();
      if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
      if (filterPlan !== 'all' && u.plan !== filterPlan) return false;
      if (filterStatus === 'verified'   && !u.emailVerified) return false;
      if (filterStatus === 'unverified' && u.emailVerified)  return false;
      if (filterStripe === 'stripe'    && !u.stripeCustomerId) return false;
      if (filterStripe === 'no-stripe' && u.stripeCustomerId)  return false;
      if (filterActivity === 'today') {
        if (!u.lastLoginAt || new Date(u.lastLoginAt).toLocaleDateString() !== today) return false;
      }
      if (filterActivity === 'has-fillups' && u.fillupCount === 0) return false;
      if (filterActivity === 'no-logins'   && u.loginCount  > 0)   return false;
      if (filterActivity === 'has-streak'  && u.streak      === 0)  return false;
      if (filterPush === 'subscribed'     && !u.pushSubscribed) return false;
      if (filterPush === 'not-subscribed' &&  u.pushSubscribed) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'joined-asc':  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'logins':      return b.loginCount  - a.loginCount;
        case 'calcs':       return b.calcCount   - a.calcCount;
        case 'fillups':     return b.fillupCount - a.fillupCount;
        case 'streak':      return b.streak      - a.streak;
        default:            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
  const stats = {
    total:      users.length,
    free:       users.filter((u) => u.plan === 'free').length,
    pro:        users.filter((u) => u.plan === 'pro').length,
    fleet:      users.filter((u) => u.plan === 'fleet').length,
    unverified: users.filter((u) => !u.emailVerified).length,
    push:       users.filter((u) => u.pushSubscribed).length,
    activeToday: users.filter((u) => u.lastLoginAt && new Date(u.lastLoginAt).toLocaleDateString() === today).length,
    totalFillups: users.reduce((s, u) => s + u.fillupCount, 0),
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#eef1f7] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm space-y-4">
          <div className="text-center">
            <div className="flex justify-center mb-3">
              <img src="/logo-wordmark.png" alt="GasCap™" className="h-8 w-auto" />
            </div>
            <p className="text-sm font-black text-slate-700">Admin Panel</p>
            <p className="text-xs text-slate-500 mt-0.5">Restricted access</p>
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
      <div className="max-w-5xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-wordmark.png" alt="GasCap™" className="h-7 w-auto" />
            <div>
              <p className="text-sm font-black text-slate-700">Admin Panel</p>
              <p className="text-xs text-slate-500">User management</p>
            </div>
          </div>
          <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-red-500 transition-colors">
            Sign out
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
          {[
            { label: 'Total Users',   value: stats.total,        color: 'text-navy-700' },
            { label: 'Free',          value: stats.free,         color: 'text-slate-600' },
            { label: 'Pro',           value: stats.pro,          color: 'text-amber-600' },
            { label: 'Fleet',         value: stats.fleet,        color: 'text-blue-600' },
            { label: 'Unverified',    value: stats.unverified,   color: 'text-red-500' },
            { label: '🔔 Push',       value: stats.push,         color: 'text-blue-600' },
            { label: '🟢 Today',      value: stats.activeToday,  color: 'text-green-600' },
            { label: '⛽ Fill-Ups',   value: stats.totalFillups, color: 'text-amber-700' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl p-3 text-center shadow-sm">
              <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-slate-600 uppercase tracking-wider">{s.label}</p>
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

        {/* Push Notifications */}
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-navy-700">🔔 Push Notifications</p>
              <p className="text-xs text-slate-600 mt-0.5">
                Send to subscribers
                {subCount !== null && <span className="ml-1 font-bold text-amber-600">· {subCount} subscribed</span>}
              </p>
            </div>
            <button
              onClick={loadSubCount}
              className="text-xs text-slate-400 hover:text-amber-600 transition-colors"
            >
              Refresh count
            </button>
          </div>

          {pushMsg && (
            <div className={`rounded-xl px-4 py-2 text-sm flex justify-between ${
              pushMsg.startsWith('✅') ? 'bg-green-50 border border-green-200 text-green-700'
              : pushMsg.startsWith('⚠️') ? 'bg-amber-50 border border-amber-200 text-amber-700'
              : 'bg-red-50 border border-red-200 text-red-600'
            }`}>
              <span>{pushMsg}</span>
              <button onClick={() => setPushMsg('')} className="ml-2 opacity-50 hover:opacity-100">×</button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            {/* Send to all */}
            <button
              onClick={handlePushAll}
              disabled={pushLoading !== null}
              className="flex-1 py-2.5 px-4 rounded-xl bg-navy-700 hover:bg-navy-600 text-white
                         text-sm font-bold transition-colors disabled:opacity-50"
            >
              {pushLoading === 'all' ? 'Sending…' : '📣 Send digest to all subscribers'}
            </button>
          </div>

          {/* Send to specific user */}
          <div className="flex gap-2">
            <input
              type="email"
              placeholder="user@email.com"
              value={pushEmail}
              onChange={(e) => setPushEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePushUser()}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
            />
            <button
              onClick={handlePushUser}
              disabled={pushLoading !== null || !pushEmail.trim()}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-white
                         text-sm font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {pushLoading === 'user' ? '…' : 'Send to user'}
            </button>
          </div>

          <p className="text-[10px] text-slate-600 leading-relaxed">
            <strong>Note:</strong> Users must have opted in to push notifications from the Share tab in the app.
            Sending to a user with no active subscription will return a warning.
          </p>

          {/* Custom Broadcast */}
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <p className="text-xs font-black text-slate-600 uppercase tracking-wider">📣 Custom Broadcast</p>

            {bcastMsg && (
              <div className={`rounded-xl px-4 py-2 text-sm flex justify-between ${
                bcastMsg.startsWith('✅') ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-600'
              }`}>
                <span>{bcastMsg}</span>
                <button onClick={() => setBcastMsg('')} className="ml-2 opacity-50 hover:opacity-100">×</button>
              </div>
            )}

            <input
              type="text"
              placeholder="Notification title (e.g. ⛽ Gas prices just dropped!)"
              value={bcastTitle}
              onChange={(e) => setBcastTitle(e.target.value)}
              maxLength={80}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
            />
            <textarea
              placeholder="Message body (e.g. Prices near you are down 12¢ — good time to fill up!)"
              value={bcastBody}
              onChange={(e) => setBcastBody(e.target.value)}
              maxLength={200}
              rows={3}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50 resize-none"
            />
            <input
              type="text"
              placeholder="Link URL (optional — defaults to homepage)"
              value={bcastUrl}
              onChange={(e) => setBcastUrl(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
            />
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <input
                  type="email"
                  placeholder="Send to one user (email) — leave blank for all"
                  value={bcastEmail}
                  onChange={(e) => setBcastEmail(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm
                             focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                />
              </div>
              {bcastEmail.trim() && (
                <button
                  onClick={() => setBcastEmail('')}
                  className="text-xs text-slate-400 hover:text-red-500 transition-colors whitespace-nowrap"
                >
                  Clear
                </button>
              )}
            </div>
            <button
              onClick={handleBroadcast}
              disabled={pushLoading !== null || !bcastTitle.trim() || !bcastBody.trim()}
              className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-white
                         text-sm font-black transition-colors disabled:opacity-50"
            >
              {pushLoading === 'broadcast'
                ? 'Sending…'
                : bcastEmail.trim()
                  ? `🔔 Send to ${bcastEmail}`
                  : '🚀 Send to all subscribers'}
            </button>
          </div>
        </div>

        {/* Feedback Inbox */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <button
            onClick={() => setFbOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-base">💬</span>
              <div className="text-left">
                <p className="text-sm font-black text-navy-700">Feedback Inbox</p>
                <p className="text-xs text-slate-600">
                  {feedback.length} message{feedback.length !== 1 ? 's' : ''}
                  {feedback.filter((f) => !f.read).length > 0 && (
                    <span className="ml-1.5 bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">
                      {feedback.filter((f) => !f.read).length} new
                    </span>
                  )}
                </p>
              </div>
            </div>
            <svg className={`w-4 h-4 text-slate-400 transition-transform ${fbOpen ? 'rotate-180' : ''}`}
                 viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6l4 4 4-4"/>
            </svg>
          </button>

          {fbOpen && (
            <div className="border-t border-slate-100 divide-y divide-slate-50">
              {feedback.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-400 text-center">No feedback yet.</p>
              ) : (
                feedback.map((f) => (
                  <div key={f.id} className={`px-5 py-4 ${f.read ? 'bg-white' : 'bg-amber-50'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          {!f.read && (
                            <span className="text-[10px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded-full">NEW</span>
                          )}
                          <p className="text-xs font-bold text-slate-700">{f.name}</p>
                          <p className="text-xs text-slate-600">{f.email}</p>
                          <p className="text-[10px] text-slate-500">
                            {new Date(f.createdAt).toLocaleDateString()} · {f.page}
                          </p>
                        </div>
                        <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{f.message}</p>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        {!f.read && (
                          <button
                            onClick={() => handleFbRead(f.id)}
                            className="text-[11px] px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 font-semibold transition-colors"
                          >
                            Mark read
                          </button>
                        )}
                        <button
                          onClick={() => handleFbDelete(f.id)}
                          className="text-[11px] px-2 py-1 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 font-semibold transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Search + Filters */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">

          {/* Search */}
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />

          {/* Plan filter */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Plan</p>
            <div className="flex flex-wrap gap-1.5">
              {(['all','free','pro','fleet'] as const).map((p) => (
                <button key={p} onClick={() => setFilterPlan(p)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    filterPlan === p
                      ? 'bg-navy-700 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {p === 'all' ? `All (${users.length})` : p === 'free' ? `Free (${stats.free})` : p === 'pro' ? `Pro (${stats.pro})` : `Fleet (${stats.fleet})`}
                </button>
              ))}
            </div>
          </div>

          {/* Status filter */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Email Status</p>
            <div className="flex flex-wrap gap-1.5">
              {([
                { val: 'all',        label: 'All' },
                { val: 'verified',   label: '✓ Verified' },
                { val: 'unverified', label: '⚠ Unverified' },
              ] as const).map(({ val, label }) => (
                <button key={val} onClick={() => setFilterStatus(val)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    filterStatus === val
                      ? 'bg-navy-700 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Activity filter */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Activity</p>
            <div className="flex flex-wrap gap-1.5">
              {([
                { val: 'all',         label: 'All' },
                { val: 'today',       label: '🟢 Active Today' },
                { val: 'has-fillups', label: '⛽ Has Fill-Ups' },
                { val: 'no-logins',   label: '😴 Never Logged In' },
                { val: 'has-streak',  label: '🔥 Has Streak' },
              ] as const).map(({ val, label }) => (
                <button key={val} onClick={() => setFilterActivity(val)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    filterActivity === val
                      ? 'bg-navy-700 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Stripe filter */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Billing</p>
            <div className="flex flex-wrap gap-1.5">
              {([
                { val: 'all',       label: 'All' },
                { val: 'stripe',    label: '💳 Has Stripe' },
                { val: 'no-stripe', label: 'No Stripe' },
              ] as const).map(({ val, label }) => (
                <button key={val} onClick={() => setFilterStripe(val)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    filterStripe === val
                      ? 'bg-navy-700 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Push filter */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Push Notifications</p>
            <div className="flex flex-wrap gap-1.5">
              {([
                { val: 'all',            label: 'All' },
                { val: 'subscribed',     label: '🔔 Subscribed' },
                { val: 'not-subscribed', label: 'Not subscribed' },
              ] as const).map(({ val, label }) => (
                <button key={val} onClick={() => setFilterPush(val)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    filterPush === val
                      ? 'bg-navy-700 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Sort + result count row */}
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-100">
            <p className="text-[11px] text-slate-600 font-semibold">
              {filtered.length} user{filtered.length !== 1 ? 's' : ''}
              {filtered.length !== users.length && ` of ${users.length}`}
            </p>
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide whitespace-nowrap">Sort by</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="joined-desc">Newest first</option>
                <option value="joined-asc">Oldest first</option>
                <option value="logins">Most logins</option>
                <option value="calcs">Most calcs</option>
                <option value="fillups">Most fill-ups</option>
                <option value="streak">Longest streak</option>
              </select>
            </div>
          </div>

          {/* Clear filters */}
          {(filterPlan !== 'all' || filterStatus !== 'all' || filterActivity !== 'all' || filterStripe !== 'all' || filterPush !== 'all' || search) && (
            <button
              onClick={() => { setFilterPlan('all'); setFilterStatus('all'); setFilterActivity('all'); setFilterStripe('all'); setFilterPush('all'); setSearch(''); }}
              className="text-[11px] font-bold text-amber-600 hover:text-amber-500 transition-colors"
            >
              × Clear all filters
            </button>
          )}
        </div>

        {/* User table */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-slate-600 text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-600 text-sm">No users found.</div>
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
                      {u.pushSubscribed && (
                        <span title="Push notifications enabled" className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-600">
                          🔔 PUSH
                        </span>
                      )}
                      {u.isTestAccount && (
                        <span title="Test account — no plan limits" className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          🧪 TEST
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 truncate">{u.email}</p>
                    <p className="text-[10px] text-slate-600">
                      Joined {new Date(u.createdAt).toLocaleDateString()} ·{' '}
                      {u.referralCount} referral{u.referralCount !== 1 ? 's' : ''}
                      {u.stripeCustomerId && ' · Stripe ✓'}
                      {u.referredByName && (
                        <span className="text-green-600"> · Referred by {u.referredByName}</span>
                      )}
                    </p>
                    {/* Activity metrics */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      <span className="text-[10px] text-slate-600">
                        🔑 <span className="font-semibold text-slate-700">{u.loginCount}</span> login{u.loginCount !== 1 ? 's' : ''}
                        {u.lastLoginAt && (
                          <span className="text-slate-500"> · last {new Date(u.lastLoginAt).toLocaleDateString()}</span>
                        )}
                      </span>
                      <span className="text-[10px] text-slate-600">
                        🧮 <span className="font-semibold text-slate-700">{u.calcCount}</span> calc{u.calcCount !== 1 ? 's' : ''}
                      </span>
                      <span className="text-[10px] text-slate-600">
                        ⛽ <span className="font-semibold text-slate-700">{u.fillupCount}</span> fill-up{u.fillupCount !== 1 ? 's' : ''}
                        {u.lastFillup && (
                          <span className="text-slate-500"> · last {new Date(u.lastFillup + 'T12:00:00').toLocaleDateString()}</span>
                        )}
                      </span>
                      <span className="text-[10px] text-slate-600">
                        📅 <span className="font-semibold text-slate-700">{u.activeDays}</span> active day{u.activeDays !== 1 ? 's' : ''}
                      </span>
                      {u.streak > 0 && (
                        <span className="text-[10px] text-amber-600 font-semibold">
                          🔥 {u.streak}-day streak
                        </span>
                      )}
                    </div>
                    {u.referredUsers.length > 0 && (
                      <details className="mt-1">
                        <summary className="text-[10px] text-amber-600 cursor-pointer font-semibold">
                          👥 {u.referredUsers.length} user{u.referredUsers.length !== 1 ? 's' : ''} referred — click to view
                        </summary>
                        <div className="mt-1 space-y-0.5 pl-2 border-l-2 border-amber-200">
                          {u.referredUsers.map((r) => (
                            <p key={r.email} className="text-[10px] text-slate-600">
                              {r.name} · {r.email} · {new Date(r.joinedAt).toLocaleDateString()}
                            </p>
                          ))}
                        </div>
                      </details>
                    )}
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

                    {/* Beta trial status — display only for existing testers (no new grants) */}
                    {u.isBetaTester && (
                      <span className="text-[10px] px-2 py-1 rounded-lg bg-purple-50 text-purple-600 font-semibold border border-purple-200 whitespace-nowrap">
                        🧪 {u.betaProExpiry
                          ? (() => {
                              const days = Math.ceil((new Date(u.betaProExpiry).getTime() - Date.now()) / 86400_000);
                              return days > 0 ? `Beta · ${days}d left` : 'Beta · Expired';
                            })()
                          : 'Beta'}
                        {' '}
                        <button
                          onClick={() => handleBetaRevoke(u)}
                          className="text-purple-400 hover:text-red-500 ml-0.5"
                          title="Revoke trial early"
                        >×</button>
                      </span>
                    )}

                    {/* Test account toggle */}
                    {!u.isTestAccount ? (
                      <button
                        onClick={() => handleTestAccount(u, true)}
                        className="text-xs px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 font-semibold transition-colors whitespace-nowrap"
                        title="Bypass all plan limits for this account"
                      >
                        🧪 Test
                      </button>
                    ) : (
                      <button
                        onClick={() => handleTestAccount(u, false)}
                        className="text-xs px-2 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-semibold transition-colors whitespace-nowrap"
                        title="Remove test account exemption — restore normal plan limits"
                      >
                        🧪 → Live
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

        <p className="text-[10px] text-slate-500 text-center pb-4">
          GasCap™ Admin · {users.length} total users
        </p>
      </div>
    </div>
  );
}

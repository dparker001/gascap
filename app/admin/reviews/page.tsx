'use client';

import { useEffect, useState } from 'react';
import type { Review } from '@/lib/reviews';

const ADMIN_PW_KEY = 'admin_password';

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-400 text-sm">
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  );
}

export default function AdminReviewsPage() {
  const [password, setPassword] = useState('');
  const [authed,   setAuthed]   = useState(false);
  const [reviews,  setReviews]  = useState<Review[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [filter,   setFilter]   = useState<'all' | 'pending' | 'approved'>('pending');

  // Restore saved password from session
  useEffect(() => {
    const saved = sessionStorage.getItem(ADMIN_PW_KEY);
    if (saved) { setPassword(saved); fetchReviews(saved); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchReviews(pw: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/reviews', {
        headers: { 'x-admin-password': pw },
      });
      if (res.status === 401) { setError('Wrong password'); setAuthed(false); return; }
      if (!res.ok) { setError('Server error'); return; }
      const data = await res.json() as { reviews: Review[] };
      setReviews(data.reviews);
      setAuthed(true);
      sessionStorage.setItem(ADMIN_PW_KEY, pw);
    } finally {
      setLoading(false);
    }
  }

  async function setApproval(id: string, approved: boolean) {
    const res = await fetch(`/api/admin/reviews?id=${id}`, {
      method:  'PATCH',
      headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ approved }),
    });
    if (res.ok) setReviews((prev) => prev.map((r) => r.id === id ? { ...r, approved } : r));
  }

  async function removeReview(id: string) {
    if (!confirm('Permanently delete this review? This cannot be undone.')) return;
    const res = await fetch(`/api/admin/reviews?id=${id}`, {
      method:  'DELETE',
      headers: { 'x-admin-password': password },
    });
    if (res.ok) setReviews((prev) => prev.filter((r) => r.id !== id));
  }

  // ── Login gate ──────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-6 w-full max-w-sm">
          <h1 className="text-xl font-black text-slate-800 mb-4">⭐ Review Moderation</h1>
          {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchReviews(password)}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm mb-3"
          />
          <button
            onClick={() => fetchReviews(password)}
            disabled={loading}
            className="w-full bg-slate-800 text-white rounded-xl py-3 text-sm font-bold"
          >
            {loading ? 'Checking…' : 'Sign In'}
          </button>
        </div>
      </div>
    );
  }

  // ── Filter ───────────────────────────────────────────────────────────────
  const visible = reviews.filter((r) => {
    if (filter === 'pending')  return !r.approved;
    if (filter === 'approved') return r.approved;
    return true;
  });

  const pendingCount  = reviews.filter((r) => !r.approved).length;
  const approvedCount = reviews.filter((r) => r.approved).length;

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black text-slate-800">⭐ Review Moderation</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Approve reviews to make them live on the homepage marquee.
            </p>
          </div>
          <a href="/admin" className="text-xs text-slate-400 underline">← Admin</a>
        </div>

        {/* Stats + filter tabs */}
        <div className="flex gap-2 mb-4">
          {(['all', 'pending', 'approved'] as const).map((f) => {
            const count = f === 'all' ? reviews.length : f === 'pending' ? pendingCount : approvedCount;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${
                  filter === f
                    ? 'bg-slate-800 text-white'
                    : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-400'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)} ({count})
              </button>
            );
          })}
        </div>

        {pendingCount > 0 && filter !== 'approved' && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 font-medium">
            🔔 {pendingCount} review{pendingCount !== 1 ? 's' : ''} waiting for your approval
          </div>
        )}

        {/* Review cards */}
        {visible.length === 0 && (
          <div className="text-center py-16 text-slate-400 text-sm">
            {filter === 'pending' ? 'No reviews pending — you\'re all caught up! 🎉' : 'No reviews here.'}
          </div>
        )}

        <div className="space-y-3">
          {visible.map((r) => (
            <div
              key={r.id}
              className={`bg-white rounded-2xl border p-4 shadow-sm ${
                r.approved ? 'border-green-200' : 'border-amber-200'
              }`}
            >
              {/* Status badge */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Stars rating={r.rating} />
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                      r.approved
                        ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {r.approved ? 'LIVE' : 'PENDING'}
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                      r.plan === 'fleet' ? 'bg-blue-100 text-blue-600'
                      : r.plan === 'pro' ? 'bg-amber-100 text-amber-600'
                      : 'bg-slate-100 text-slate-500'
                    }`}>
                      {r.plan.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-700 mt-1">{r.userName}</p>
                  {r.vehicleName && (
                    <p className="text-[10px] text-slate-400">{r.vehicleName}</p>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 shrink-0">
                  {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                </p>
              </div>

              {/* Review text */}
              <p className="text-sm text-slate-600 leading-relaxed border-l-2 border-slate-100 pl-3 my-3">
                &ldquo;{r.text}&rdquo;
              </p>

              {/* Actions */}
              <div className="flex gap-2 mt-3">
                {!r.approved ? (
                  <button
                    onClick={() => setApproval(r.id, true)}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-2 rounded-xl transition-colors"
                  >
                    ✓ Approve — make live
                  </button>
                ) : (
                  <button
                    onClick={() => setApproval(r.id, false)}
                    className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold py-2 rounded-xl transition-colors"
                  >
                    ↩ Unpublish
                  </button>
                )}
                <button
                  onClick={() => removeReview(r.id)}
                  className="px-4 bg-red-50 hover:bg-red-100 text-red-500 text-xs font-bold py-2 rounded-xl transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-center text-slate-300 mt-8">
          Approved reviews appear in the homepage marquee. Seed reviews always show regardless.
        </p>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Review } from '@/lib/reviews';

// ── Star display ──────────────────────────────────────────────────────────

function Stars({ rating, interactive = false, onRate }: {
  rating: number;
  interactive?: boolean;
  onRate?: (r: number) => void;
}) {
  const [hovered, setHovered] = useState(0);
  const display = interactive ? (hovered || rating) : rating;
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!interactive}
          onClick={() => onRate?.(n)}
          onMouseEnter={() => interactive && setHovered(n)}
          onMouseLeave={() => interactive && setHovered(0)}
          className={`text-xl leading-none transition-transform ${interactive ? 'cursor-pointer hover:scale-110' : 'cursor-default'} ${n <= display ? 'text-amber-400' : 'text-slate-200'}`}
          aria-label={interactive ? `Rate ${n} star${n!==1?'s':''}` : undefined}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ── Submit form ───────────────────────────────────────────────────────────

function SubmitForm() {
  const { data: session } = useSession();
  const [existing, setExisting] = useState<Review | null>(null);
  const [rating,   setRating]   = useState(5);
  const [text,     setText]     = useState('');
  const [vehicle,  setVehicle]  = useState('');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => {
    if (!session) return;
    // Check if user already has a review
    fetch('/api/reviews')
      .then((r) => r.json())
      .then((d: { reviews: Review[] }) => {
        const userId = (session.user as { id?: string })?.id ?? session.user?.email ?? '';
        const mine = d.reviews.find((r) => r.userId === userId);
        if (mine) {
          setExisting(mine);
          setRating(mine.rating);
          setText(mine.text);
          setVehicle(mine.vehicleName ?? '');
        }
      })
      .catch(() => {/* silent */});
  }, [session]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/reviews', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rating, text, vehicleName: vehicle || undefined }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? 'Save failed.');
        return;
      }
      const review = await res.json() as Review;
      setExisting(review);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (!session) {
    return (
      <div className="text-center py-6 space-y-2">
        <p className="text-2xl">⭐</p>
        <p className="text-sm font-bold text-slate-700">Share your experience</p>
        <a href="/signin" className="text-xs text-amber-600 font-semibold hover:underline">
          Sign in to leave a review →
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-black text-slate-700">{existing ? 'Edit your review' : 'Leave a review'}</p>
        {existing && <span className="text-[10px] text-green-600 bg-green-50 rounded-full px-2 py-0.5 font-bold">✓ Submitted</span>}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Your rating</label>
        <Stars rating={rating} interactive onRate={setRating} />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Your review</label>
        <textarea
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-transparent"
          rows={3}
          maxLength={500}
          placeholder="How has GasCap helped you track your fuel spending?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
        />
        <p className="text-[10px] text-slate-400 text-right mt-0.5">{text.length}/500</p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">
          Vehicle <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input
          type="text"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
          placeholder='e.g. "2022 Toyota Camry"'
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
          maxLength={60}
        />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={saving || text.trim().length < 10}
        className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-black disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving…' : saved ? '✓ Review saved!' : existing ? 'Update review' : 'Submit review'}
      </button>
    </form>
  );
}

// ── Display grid ──────────────────────────────────────────────────────────

function DisplayGrid({ limit = 6 }: { limit?: number }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reviews')
      .then((r) => r.json())
      .then((d: { reviews: Review[] }) => setReviews(d.reviews.slice(0, limit)))
      .catch(() => {/* silent */})
      .finally(() => setLoading(false));
  }, [limit]);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {[1,2,3,4].map((n) => (
          <div key={n} className="h-24 bg-slate-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <p className="text-center text-sm text-slate-400 py-8">
        No reviews yet — be the first! Sign in and share your experience.
      </p>
    );
  }

  const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-3 bg-amber-50 rounded-2xl px-4 py-3">
        <span className="text-3xl font-black text-amber-500">{avg.toFixed(1)}</span>
        <div>
          <Stars rating={Math.round(avg)} />
          <p className="text-xs text-slate-500 mt-0.5">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {reviews.map((r) => (
          <div key={r.id} className="bg-white border border-slate-100 rounded-2xl p-4 space-y-2 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-slate-700">{r.userName}</p>
                {r.vehicleName && (
                  <p className="text-[10px] text-slate-400">{r.vehicleName}</p>
                )}
              </div>
              <Stars rating={r.rating} />
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">&ldquo;{r.text}&rdquo;</p>
            <div className="flex items-center gap-2">
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                r.plan === 'fleet' ? 'bg-blue-100 text-blue-600'
                : r.plan === 'pro' ? 'bg-amber-100 text-amber-600'
                : 'bg-slate-100 text-slate-500'
              }`}>
                {r.plan.toUpperCase()}
              </span>
              <span className="text-[10px] text-slate-300">
                {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Default export ─────────────────────────────────────────────────────────

interface ReviewWidgetProps {
  mode: 'submit' | 'display';
  limit?: number;
}

export default function ReviewWidget({ mode, limit }: ReviewWidgetProps) {
  if (mode === 'display') return <DisplayGrid limit={limit} />;
  return <SubmitForm />;
}

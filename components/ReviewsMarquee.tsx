'use client';

import { useEffect, useState } from 'react';
import type { Review } from '@/lib/reviews';

// ── Star row ──────────────────────────────────────────────────────────────

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`text-sm leading-none ${n <= rating ? 'text-amber-400' : 'text-slate-200'}`}>
          ★
        </span>
      ))}
    </div>
  );
}

// ── Single review card ────────────────────────────────────────────────────

function ReviewCard({ review }: { review: Review }) {
  return (
    <div className="flex-shrink-0 w-72 bg-white rounded-2xl shadow-card border border-slate-100 p-4 mx-2">
      <Stars rating={review.rating} />
      <p className="text-sm text-slate-700 leading-relaxed mt-2 line-clamp-3">
        &ldquo;{review.text}&rdquo;
      </p>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-50">
        <div>
          <p className="text-xs font-bold text-slate-700">{review.userName}</p>
          {review.vehicleName && (
            <p className="text-[10px] text-slate-400">{review.vehicleName}</p>
          )}
        </div>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
          review.plan === 'fleet' ? 'bg-blue-100 text-blue-600'
          : review.plan === 'pro' ? 'bg-amber-100 text-amber-600'
          : 'bg-slate-100 text-slate-500'
        }`}>
          {review.plan.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

// ── Marquee row ───────────────────────────────────────────────────────────

function MarqueeRow({ reviews, direction }: { reviews: Review[]; direction: 'left' | 'right' }) {
  // Duplicate for seamless loop
  const doubled = [...reviews, ...reviews];
  return (
    <div className={`flex ${direction === 'left' ? 'marquee-track-left' : 'marquee-track-right'}`}
         style={{ width: 'max-content' }}>
      {doubled.map((r, i) => (
        <ReviewCard key={`${r.id}-${i}`} review={r} />
      ))}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────

export default function ReviewsMarquee() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loaded,  setLoaded]  = useState(false);

  useEffect(() => {
    fetch('/api/reviews')
      .then((r) => r.json())
      .then((d: { reviews: Review[] }) => {
        setReviews(d.reviews);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Need at least 2 reviews to make two rows
  if (!loaded || reviews.length < 2) return null;

  // Split reviews across two rows, interleaved for variety
  const row1 = reviews.filter((_, i) => i % 2 === 0);
  const row2 = reviews.filter((_, i) => i % 2 === 1);

  // Ensure both rows have enough cards to fill the marquee (min 3 per row)
  const pad = (arr: Review[]) =>
    arr.length < 3 ? [...arr, ...arr, ...arr].slice(0, Math.max(arr.length * 2, 4)) : arr;

  const avgRating = (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1);

  return (
    <section aria-label="User reviews" className="py-10 overflow-hidden bg-slate-50">
      {/* Heading */}
      <div className="text-center mb-6 px-4">
        <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-full px-4 py-1.5 mb-3">
          <span className="text-amber-400 text-sm">★</span>
          <span className="text-xs font-black text-amber-700">{avgRating} avg · {reviews.length} reviews</span>
        </div>
        <h2 className="text-xl font-black text-navy-700 leading-tight">
          What drivers are saying
        </h2>
        <p className="text-sm text-slate-400 mt-1">Real reviews from GasCap users</p>
      </div>

      {/* Marquee — two rows, opposite directions */}
      <div className="marquee-root space-y-3 select-none" aria-hidden="true">
        <div className="overflow-hidden">
          <MarqueeRow reviews={pad(row1)} direction="left" />
        </div>
        {row2.length > 0 && (
          <div className="overflow-hidden">
            <MarqueeRow reviews={pad(row2)} direction="right" />
          </div>
        )}
      </div>
    </section>
  );
}

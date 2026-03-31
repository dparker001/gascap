'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

const DISMISSED_KEY = 'gascap_price_alert_dismissed';

export default function GasPriceAlertBanner() {
  const { data: session } = useSession();
  const [show,      setShow]      = useState(false);
  const [savings,   setSavings]   = useState<number | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);

  const plan = (session?.user as { plan?: string })?.plan ?? 'free';
  const isPro = plan === 'pro' || plan === 'fleet';

  useEffect(() => {
    if (!session || !isPro) return;

    // Fetch threshold + national price in parallel
    Promise.all([
      fetch('/api/user/price-alert').then((r) => r.json()),
      fetch('/api/gas-price/national').then((r) => r.json()),
    ])
      .then(([alertData, priceData]: [{ threshold?: number | null }, { price?: number | null }]) => {
        const thresh = alertData.threshold ?? null;
        const price  = priceData.price ?? null;
        if (!thresh || !price) return;

        // Check if already dismissed today
        try {
          const dismissed = localStorage.getItem(DISMISSED_KEY);
          if (dismissed && new Date(dismissed).toDateString() === new Date().toDateString()) return;
        } catch {}

        if (price < thresh) {
          setThreshold(thresh);
          setCurrentPrice(price);
          setSavings(thresh - price);
          setShow(true);
        }
      })
      .catch(() => {});
  }, [session, isPro]);

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, new Date().toISOString()); } catch {}
    setShow(false);
  }

  if (!show || currentPrice === null || threshold === null) return null;

  return (
    <div
      className="px-4 py-2 max-w-lg mx-auto w-full"
      role="alert"
      aria-live="polite"
    >
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-center gap-3">
        <span className="text-xl flex-shrink-0" aria-hidden="true">⛽</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black text-emerald-800">
            Gas prices are down! ${currentPrice.toFixed(2)}/gal nationally
          </p>
          <p className="text-[10px] text-emerald-600 mt-0.5">
            ${savings?.toFixed(2)} below your ${threshold.toFixed(2)} alert threshold — good time to fill up!
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href="/#calculator"
            className="text-[10px] font-black bg-emerald-600 text-white px-2.5 py-1.5 rounded-xl hover:bg-emerald-700 transition-colors"
          >
            Calculate
          </Link>
          <button
            onClick={dismiss}
            className="text-emerald-400 hover:text-emerald-600 transition-colors p-0.5"
            aria-label="Dismiss alert"
          >
            <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

/**
 * ReferralNudge — appears after a user logs their first fill-up.
 * Dismissible per-session (localStorage). Tapping the CTA switches
 * to the Share tab where the referral link lives.
 */
import { useState, useEffect } from 'react';

const DISMISS_KEY = 'gascap_referral_nudge_dismissed';

interface Props {
  fillupCount: number | null;
}

export default function ReferralNudge({ fillupCount }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show once the user has at least 1 fill-up and hasn't dismissed before
    if (fillupCount !== 1) return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch { /* private browsing — show anyway */ }
    setVisible(true);
  }, [fillupCount]);

  function dismiss() {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ok */ }
  }

  function openShareTab() {
    window.dispatchEvent(
      new CustomEvent('gascap:switch-tools-tab', { detail: { tab: 'share' } }),
    );
    dismiss();
    // Scroll the tools panel into view
    setTimeout(() => {
      document.getElementById('tools-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  if (!visible) return null;

  return (
    <div className="max-w-lg mx-auto w-full px-4 pb-3">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-3">
        <span className="text-xl flex-shrink-0 mt-0.5">🔗</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-amber-900 leading-tight">
            Nice — first fill-up logged! 🎉
          </p>
          <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
            Share GasCap™ with a friend. When they upgrade to Pro, you earn{' '}
            <strong>1 free Pro month</strong> — plus bonus drawing entries and a path to{' '}
            <strong>lifetime Pro access</strong>.
          </p>
          <button
            onClick={openShareTab}
            className="mt-2 inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400
                       text-white text-xs font-black px-3 py-1.5 rounded-xl transition-colors"
          >
            <span>📤</span>
            Get My Referral Link
          </button>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex-shrink-0 text-amber-400 hover:text-amber-600 transition-colors text-lg leading-none mt-0.5"
        >
          ×
        </button>
      </div>
    </div>
  );
}

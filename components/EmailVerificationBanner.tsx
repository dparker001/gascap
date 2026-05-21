'use client';

import { useState, useEffect } from 'react';
import { useSession }         from 'next-auth/react';
import { usePathname }        from 'next/navigation';
import { useTranslation }     from '@/contexts/LanguageContext';

export default function EmailVerificationBanner() {
  const { data: session, update } = useSession();
  const { t }                     = useTranslation();
  const pathname                  = usePathname();
  const [sending, setSending]     = useState(false);
  const [sent,    setSent]        = useState(false);
  const [error,   setError]       = useState('');
  const [dismissed, setDismissed] = useState(false);

  const isVerified = (session?.user as { emailVerified?: boolean })?.emailVerified ?? true;

  // Silently refresh the JWT on mount — picks up verification done in another
  // tab or device without the user needing to sign out and back in.
  useEffect(() => {
    if (session && !isVerified) void update();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Don't show if: not signed in, on the verify-email page, or dismissed
  if (!session || pathname.startsWith('/verify-email') || dismissed) return null;

  // Verified users: auto-hide (handles normal case + stale-session edge case
  // where the banner briefly shows after verification in another tab).
  // Unverified users: always show — no dismiss option.
  if (isVerified) return null;

  async function handleResend() {
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/auth/verify-email', { method: 'POST' });
      if (res.ok) {
        setSent(true);
        setTimeout(() => setSent(false), 12000);
      } else {
        const d = await res.json() as { error?: string };
        setError(d.error ?? t.verifyBanner.failSend);
      }
    } catch {
      setError(t.verifyBanner.networkErr);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-amber-500 border-b-2 border-amber-600 px-4 py-3 text-white">
      <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">

        {/* Icon + text */}
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-2xl flex-shrink-0 mt-0.5" aria-hidden="true">📧</span>
          <div className="min-w-0">
            <p className="text-sm font-black leading-tight">{t.verifyBanner.message}</p>
            <p className="text-[11px] text-amber-100 leading-snug mt-0.5">
              {t.verifyBanner.subtitle}
            </p>
            {error && (
              <p className="text-[10px] text-amber-100 mt-1">{error}</p>
            )}
          </div>
        </div>

        {/* CTA + optional dismiss */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {sent ? (
            <span className="text-[11px] font-bold text-white bg-amber-600 px-3 py-2 rounded-xl">
              {t.verifyBanner.sent}
            </span>
          ) : (
            <button
              onClick={handleResend}
              disabled={sending}
              className="text-xs font-black bg-white text-amber-600 hover:bg-amber-50
                         px-4 py-2 rounded-xl transition-colors disabled:opacity-60
                         whitespace-nowrap shadow-sm"
            >
              {sending ? t.verifyBanner.sending : t.verifyBanner.resend}
            </button>
          )}

          {/* X button — only available once email is verified (handles stale-session
              edge case where banner lingers after verification in another tab).
              Unverified users cannot dismiss the banner. */}
          {isVerified && (
            <button
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
              className="text-white/70 hover:text-white transition-colors p-1 rounded-lg
                         hover:bg-amber-600"
            >
              <svg viewBox="0 0 14 14" className="w-4 h-4" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M1 1l12 12M13 1L1 13"/>
              </svg>
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

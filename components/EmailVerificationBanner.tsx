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

  const isVerified = (session?.user as { emailVerified?: boolean })?.emailVerified ?? true;

  // Silently refresh the JWT on mount — picks up verification done in another
  // tab or device without the user needing to sign out and back in.
  useEffect(() => {
    if (session && !isVerified) void update();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Don't show if: not signed in, already verified, or on the verify-email page itself
  if (!session || isVerified || pathname.startsWith('/verify-email')) return null;

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

        {/* CTA */}
        <div className="flex-shrink-0">
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
        </div>

      </div>
    </div>
  );
}

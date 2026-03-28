'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';

export default function EmailVerificationBanner() {
  const { data: session } = useSession();
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState('');

  const isVerified = (session?.user as { emailVerified?: boolean })?.emailVerified ?? true;
  // Don't show if not signed in or already verified
  if (!session || isVerified) return null;

  async function handleResend() {
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/auth/verify-email', { method: 'POST' });
      if (res.ok) {
        setSent(true);
        setTimeout(() => setSent(false), 10000);
      } else {
        const d = await res.json() as { error?: string };
        setError(d.error ?? 'Failed to send.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-amber-500 px-4 py-2.5 flex items-center justify-between gap-3 text-white">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-base flex-shrink-0">📧</span>
        <p className="text-xs font-semibold truncate">
          Please verify your email address to secure your account.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {error && <span className="text-[10px] text-amber-100">{error}</span>}
        {sent ? (
          <span className="text-[11px] font-bold text-amber-100">✓ Email sent!</span>
        ) : (
          <button
            onClick={handleResend}
            disabled={sending}
            className="text-[11px] font-black bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {sending ? 'Sending…' : 'Resend email'}
          </button>
        )}
      </div>
    </div>
  );
}

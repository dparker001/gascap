'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';

function VerifyEmailContent() {
  const router  = useRouter();
  const params  = useSearchParams();
  const token   = params.get('token') ?? '';
  const lang    = params.get('lang') ?? '';
  const { data: session } = useSession();
  const { t } = useTranslation();
  const vp = t.verifyPage;

  const [resent,    setResent]    = useState(false);
  const [resending, setResending] = useState(false);
  const [resendErr, setResendErr] = useState('');

  useEffect(() => {
    if (token) {
      // Sync the user's chosen signup locale into localStorage BEFORE we hand
      // off to the API route. This prevents a stale 'gascap_locale' value
      // (left by a previous visitor to this browser) from flipping the
      // post-verification signin page into the wrong language.
      if (lang === 'en' || lang === 'es') {
        try { localStorage.setItem('gascap_locale', lang); } catch {}
      }
      // Token present — hit the verify API and redirect
      window.location.href = `/api/auth/verify-email?token=${token}`;
    }
  }, [token, lang]);

  async function handleResend() {
    setResending(true);
    setResendErr('');
    try {
      const res  = await fetch('/api/auth/resend-verification', { method: 'POST' });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setResendErr(data.error ?? vp.resending); return; }
      setResent(true);
    } catch {
      setResendErr(t.verifyBanner.networkErr);
    } finally {
      setResending(false);
    }
  }

  // If a token is in the URL, show the "verifying" spinner
  if (token) {
    return (
      <div className="min-h-screen bg-[#eef1f7] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-card p-8 text-center max-w-sm w-full space-y-3">
          <p className="text-3xl">⏳</p>
          <p className="text-lg font-black text-navy-700">{vp.verifying}</p>
          <p className="text-sm text-slate-500">{vp.pleaseWait}</p>
        </div>
      </div>
    );
  }

  // No token — user was redirected here after signup (unverified)
  return (
    <div className="min-h-screen bg-[#eef1f7] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-card p-8 text-center max-w-sm w-full space-y-4">
        <p className="text-4xl">📬</p>
        <p className="text-xl font-black text-navy-700">{vp.checkInbox}</p>
        <p className="text-sm text-slate-500 leading-relaxed">
          {vp.checkBody(session?.user?.email ?? 'your email address')}
        </p>

        {resent ? (
          <p className="text-sm text-green-600 font-semibold">{vp.resentOk}</p>
        ) : (
          <>
            {resendErr && <p className="text-xs text-red-500">{resendErr}</p>}
            <button
              onClick={handleResend}
              disabled={resending}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50
                         text-white font-black text-sm transition-colors"
            >
              {resending ? vp.resending : vp.resend}
            </button>
          </>
        )}

        <button
          onClick={() => router.push('/signin')}
          className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-500
                     hover:bg-slate-50 text-sm font-semibold transition-colors"
        >
          {vp.switchAccount}
        </button>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}

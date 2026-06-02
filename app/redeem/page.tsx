'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

function RedeemContent() {
  const params  = useSearchParams();
  const router  = useRouter();
  const { data: session, status, update: refreshSession } = useSession();

  const codeParam = (params.get('code') ?? '').toUpperCase().trim();
  const [code, setCode]       = useState(codeParam);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState<null | { message: string; alreadyLifetime?: boolean }>(null);

  useEffect(() => { if (codeParam) setCode(codeParam); }, [codeParam]);

  const signedIn = status === 'authenticated' && !!session?.user;
  // Preserve the code through the sign-in/up round-trip
  const nextUrl = `/redeem${code ? `?code=${encodeURIComponent(code)}` : ''}`;
  // Pre-fill the recipient's email + name on sign-up (passed from the gift email link).
  const recipientEmail = params.get('email') ?? '';
  const recipientName  = params.get('name') ?? '';
  const emailQs = recipientEmail ? `&email=${encodeURIComponent(recipientEmail)}` : '';
  const nameQs  = recipientName  ? `&name=${encodeURIComponent(recipientName)}`  : '';

  async function handleClaim() {
    setError('');
    if (!code.trim()) { setError('Please enter your gift code.'); return; }
    setLoading(true);
    try {
      const res  = await fetch('/api/gift/redeem', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json() as { success?: boolean; error?: string; message?: string; alreadyLifetime?: boolean };
      if (!res.ok) { setError(data.error ?? 'Could not redeem this gift.'); setLoading(false); return; }
      await refreshSession();
      setDone({ message: data.message ?? 'Pro Lifetime unlocked! 🎉', alreadyLifetime: data.alreadyLifetime });
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-3xl shadow-card p-8 max-w-sm w-full text-center space-y-5">
      <div className="w-20 h-20 rounded-full bg-teal-100 flex items-center justify-center mx-auto text-4xl">🎁</div>

      {done ? (
        <>
          <h1 className="text-2xl font-black text-navy-700">
            {done.alreadyLifetime ? "You're already Lifetime!" : "You're Pro for Life! 🎉"}
          </h1>
          <p className="text-slate-500 text-sm leading-relaxed">{done.message}</p>
          <button
            onClick={() => router.push('/')}
            className="block w-full py-3.5 rounded-2xl bg-teal-500 hover:bg-teal-400 text-white font-black text-base transition-colors">
            Go to GasCap™ →
          </button>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-black text-navy-700">You've received a gift!</h1>
          <p className="text-slate-500 text-sm leading-relaxed">
            Someone gifted you <span className="font-bold text-teal-600">GasCap™ Pro Lifetime</span> — every Pro feature, forever, no subscription. Enter your code to claim it.
          </p>

          <div className="text-left">
            <label className="field-label" htmlFor="code">Gift code</label>
            <input
              id="code"
              type="text"
              autoCapitalize="characters"
              className="input-field font-mono tracking-wider text-center"
              placeholder="GASCAP-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-red-600 text-sm font-medium">{error}</p>
            </div>
          )}

          {signedIn ? (
            <button
              onClick={handleClaim}
              disabled={loading}
              className="block w-full py-3.5 rounded-2xl bg-teal-500 hover:bg-teal-400 text-white font-black text-base transition-colors disabled:opacity-50">
              {loading ? 'Claiming…' : '🎁 Claim My Pro Lifetime'}
            </button>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-slate-500">Sign in or create a free account to claim your gift.</p>
              <Link
                href={`/signup?next=${encodeURIComponent(nextUrl)}${emailQs}${nameQs}`}
                className="block w-full py-3.5 rounded-2xl bg-teal-500 hover:bg-teal-400 text-white font-black text-base transition-colors">
                Create account &amp; claim →
              </Link>
              <Link
                href={`/signin?next=${encodeURIComponent(nextUrl)}`}
                className="block w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-colors">
                I already have an account
              </Link>
            </div>
          )}

          <p className="text-[11px] text-slate-400">
            Need help? Email{' '}
            <a href="mailto:support@gascap.app" className="text-teal-600 underline">support@gascap.app</a>
          </p>
        </>
      )}
    </div>
  );
}

export default function RedeemPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col items-center justify-center px-4 py-12">
      <Suspense fallback={
        <div className="bg-white rounded-3xl shadow-card p-8 max-w-sm w-full text-center">
          <p className="text-slate-400 text-sm">Loading…</p>
        </div>
      }>
        <RedeemContent />
      </Suspense>
    </div>
  );
}

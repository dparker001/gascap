'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const token        = searchParams.get('token') ?? '';

  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [pwFocused, setPwFocused] = useState(false);
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [success,   setSuccess]   = useState(false);

  const pwChecks = {
    length:    password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number:    /[0-9]/.test(password),
    special:   /[^A-Za-z0-9]/.test(password),
  };
  const pwValid   = Object.values(pwChecks).every(Boolean);
  const canSubmit = pwValid && password === confirm && !!token;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    setError('');
    const res  = await fetch('/api/auth/reset-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, password }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    setLoading(false);
    if (!res.ok) { setError(data.error ?? 'Reset failed. The link may have expired.'); return; }
    setSuccess(true);
    setTimeout(() => router.push('/signin'), 3000);
  }

  if (!token) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-8 text-center space-y-4">
        <p className="text-4xl">❌</p>
        <p className="text-xl font-black text-navy-700">Invalid link</p>
        <p className="text-sm text-slate-500">This reset link is missing or invalid.</p>
        <Link href="/forgot-password"
          className="block w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400
                     text-white font-black text-sm text-center transition-colors">
          Request a new link
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-8 text-center space-y-4">
        <p className="text-4xl">✅</p>
        <p className="text-xl font-black text-navy-700">Password updated!</p>
        <p className="text-sm text-slate-500">Redirecting you to sign in…</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-black text-navy-700 mb-1">Set new password</h1>
      <p className="text-slate-500 text-sm mb-6">Choose a strong password for your GasCap account.</p>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label className="field-label" htmlFor="password">New password</label>
          <input
            id="password" type="password" autoComplete="new-password"
            className="input-field" placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={() => setPwFocused(true)}
            required
          />
          {(pwFocused || password.length > 0) && (
            <ul className="mt-2 space-y-1">
              {[
                { key: 'length',    label: '8 or more characters' },
                { key: 'uppercase', label: 'One uppercase letter (A–Z)' },
                { key: 'number',    label: 'One number (0–9)' },
                { key: 'special',   label: 'One special character (!@#$…)' },
              ].map(({ key, label }) => {
                const met = pwChecks[key as keyof typeof pwChecks];
                return (
                  <li key={key} className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${met ? 'text-green-600' : 'text-slate-400'}`}>
                    <span className="text-base leading-none">{met ? '✓' : '○'}</span>
                    {label}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <label className="field-label" htmlFor="confirm">Confirm password</label>
          <input
            id="confirm" type="password" autoComplete="new-password"
            className="input-field" placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {confirm.length > 0 && password !== confirm && (
            <p className="mt-1 text-xs text-red-500">Passwords do not match.</p>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-red-600 text-sm font-medium">{error}</p>
          </div>
        )}

        <button type="submit" disabled={!canSubmit || loading} className="btn-amber mt-2">
          {loading ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col">
      <div className="bg-navy-700 px-5 py-4">
        <Link href="/" className="flex items-center gap-2.5 w-fit">
          <div className="w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center">
            <GasPumpIcon />
          </div>
          <span className="text-white font-black text-lg">
            GasCap<sup className="text-amber-400 text-xs ml-0.5">™</sup>
          </span>
        </Link>
      </div>
      <div className="flex-1 flex items-start justify-center px-4 pt-10 pb-16">
        <div className="w-full max-w-sm">
          <Suspense fallback={null}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function GasPumpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <rect x="2" y="6" width="11" height="16" rx="1.5" />
      <rect x="4" y="9" width="7" height="4" rx="0.75" />
      <path d="M13 8 L18 8 Q21 8 21 11 L21 16 Q21 18 19 18" />
      <circle cx="18.5" cy="18.5" r="1.5" />
    </svg>
  );
}

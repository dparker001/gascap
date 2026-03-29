'use client';

import { useState, FormEvent, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function SignUpForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const refCode      = searchParams.get('ref') ?? '';

  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [pwFocused, setPwFocused] = useState(false);

  const pwChecks = {
    length:    password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number:    /[0-9]/.test(password),
    special:   /[^A-Za-z0-9]/.test(password),
  };
  const pwValid = Object.values(pwChecks).every(Boolean);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    // Client-side quick checks
    if (!name.trim()) return setError('Please enter your name.');
    if (!pwValid)     return setError('Please meet all password requirements.');

    setLoading(true);

    // Register via API — include referral code if present
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, ...(refCode ? { referralCode: refCode } : {}) }),
    });

    if (!res.ok) {
      const data = await res.json() as { error?: string };
      setError(data.error ?? 'Registration failed.');
      setLoading(false);
      return;
    }

    // Auto sign-in after registration
    const signInRes = await signIn('credentials', {
      redirect: false,
      email,
      password,
    });

    setLoading(false);

    if (signInRes?.error) {
      setError('Account created — please sign in.');
      router.push('/signin');
    } else {
      router.push('/');
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col">
      {/* Top brand bar */}
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

      {/* Form */}
      <div className="flex-1 flex items-start justify-center px-4 pt-10 pb-16">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-black text-navy-700 mb-1">Create your account</h1>
          <p className="text-slate-500 text-sm mb-5">
            Free forever. Save your vehicles and calculation history.
          </p>

          {/* Referral banner */}
          {refCode && (
            <div className="mb-5 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-3">
              <span className="text-lg flex-shrink-0">🔗</span>
              <div>
                <p className="text-sm font-black text-amber-800">You were invited!</p>
                <p className="text-xs text-amber-700 leading-relaxed mt-0.5">
                  Referral code <span className="font-mono font-bold">{refCode}</span> applied.
                  Sign up and your friend earns a free month of Pro.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label className="field-label" htmlFor="name">Your name</label>
              <input
                id="name" type="text" autoComplete="name"
                className="input-field" placeholder="Alex Johnson"
                value={name} onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor="email">Email</label>
              <input
                id="email" type="email" autoComplete="email"
                className="input-field" placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor="password">Password</label>
              <input
                id="password" type="password" autoComplete="new-password"
                className="input-field" placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setPwFocused(true)}
                required
              />
              {/* Real-time requirements checklist */}
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

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-red-600 text-sm font-medium">{error}</p>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-amber mt-2">
              {loading ? 'Creating account…' : 'Create free account'}
            </button>
          </form>

          {/* Trust signals */}
          <div className="mt-5 flex items-center justify-center gap-4 text-[10px] text-slate-400">
            <span>✓ Free forever</span>
            <span>✓ No credit card</span>
            <span>✓ Cancel anytime</span>
          </div>

          <p className="text-center text-sm text-slate-500 mt-5">
            Already have an account?{' '}
            <Link href="/signin" className="text-amber-600 font-bold hover:underline">
              Sign in
            </Link>
          </p>

          <p className="text-center mt-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 text-xs">
              ← Continue without an account
            </Link>
          </p>

          <p className="text-center text-[11px] text-slate-400 mt-4 leading-relaxed">
            By signing up you agree to our{' '}
            <Link href="/terms"   className="hover:text-amber-600 underline">Terms of Service</Link>
            {' '}and{' '}
            <Link href="/privacy" className="hover:text-amber-600 underline">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
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

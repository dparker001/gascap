'use client';

import { useState, FormEvent, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function SignInForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const verified     = searchParams.get('verified') === 'success';

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await signIn('credentials', {
      redirect: false,
      email,
      password,
    });

    setLoading(false);

    if (res?.error) {
      setError('Incorrect email or password. Please try again.');
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
          <h1 className="text-2xl font-black text-navy-700 mb-1">Welcome back</h1>
          <p className="text-slate-500 text-sm mb-5">Sign in to your GasCap™ account.</p>

          {/* Email verified success banner */}
          {verified && (
            <div className="mb-5 bg-green-50 border border-green-200 rounded-2xl px-4 py-3 flex items-start gap-3">
              <span className="text-lg flex-shrink-0">✅</span>
              <div>
                <p className="text-sm font-black text-green-800">Email verified!</p>
                <p className="text-xs text-green-700 leading-relaxed mt-0.5">
                  Your account is active. Sign in below to get started.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
              <div className="flex items-center justify-between mb-1">
                <label className="field-label !mb-0" htmlFor="password">Password</label>
                <Link href="/forgot-password" className="text-xs text-amber-600 hover:underline font-semibold">
                  Forgot password?
                </Link>
              </div>
              <input
                id="password" type="password" autoComplete="current-password"
                className="input-field" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-red-600 text-sm font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-amber mt-2"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-6">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-amber-600 font-bold hover:underline">
              Sign up free
            </Link>
          </p>

          <p className="text-center text-sm mt-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 text-xs">
              ← Continue without an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
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

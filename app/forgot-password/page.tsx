'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email,     setEmail]     = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading,   setLoading]   = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch('/api/auth/forgot-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    });
    setLoading(false);
    setSubmitted(true);
  }

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
          {submitted ? (
            <div className="bg-white rounded-2xl shadow-card p-8 text-center space-y-4">
              <p className="text-4xl">📬</p>
              <p className="text-xl font-black text-navy-700">Check your inbox</p>
              <p className="text-sm text-slate-500 leading-relaxed">
                If an account exists for <span className="font-semibold text-slate-700">{email}</span>,
                we've sent a password reset link. It expires in 1 hour.
              </p>
              <Link href="/signin"
                className="block w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400
                           text-white font-black text-sm text-center transition-colors">
                Back to Sign In
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-black text-navy-700 mb-1">Forgot your password?</h1>
              <p className="text-slate-500 text-sm mb-6">
                Enter your email and we'll send you a reset link.
              </p>

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <div>
                  <label className="field-label" htmlFor="email">Email address</label>
                  <input
                    id="email" type="email" autoComplete="email"
                    className="input-field" placeholder="you@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <button type="submit" disabled={loading || !email.trim()} className="btn-amber mt-2">
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <p className="text-center text-sm text-slate-500 mt-6">
                Remembered it?{' '}
                <Link href="/signin" className="text-amber-600 font-bold hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
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

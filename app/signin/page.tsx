'use client';

import { useState, FormEvent, Suspense, useRef, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslation } from '@/contexts/LanguageContext';
import BrandBar from '@/components/BrandBar';
import { useNativePlatform } from '@/hooks/useIsNative';

type Step    = 'email' | 'otp' | 'password';

function SignInForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const verified     = searchParams.get('verified') === 'success';
  const { t }        = useTranslation();
  const hideGoogle   = useNativePlatform() === 'ios';

  const nextRaw  = searchParams.get('next');
  const nextPath = nextRaw && nextRaw.startsWith('/') ? nextRaw : '/';

  // ── Shared ───────────────────────────────────────────────────────────────────
  const [email,         setEmail]         = useState('');
  const [step,          setStep]          = useState<Step>('email');
  const [error,         setError]         = useState('');
  const [loading,       setLoading]       = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // ── OTP step ─────────────────────────────────────────────────────────────────
  const [otp,            setOtp]           = useState('');
  const [otpError,       setOtpError]      = useState('');
  const [otpLoading,     setOtpLoading]    = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);

  // ── Password fallback ─────────────────────────────────────────────────────────
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);


  useEffect(() => {
    if (step === 'otp') setTimeout(() => otpInputRef.current?.focus(), 100);
  }, [step]);

  useEffect(() => {
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, []);

  function startCooldown() {
    setResendCooldown(60);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) { clearInterval(cooldownRef.current!); return 0; }
        return s - 1;
      });
    }, 1000);
  }

  function redirect() {
    if (nextPath === '/') { try { localStorage.setItem('gc_active_tab', 'calculator'); } catch { /* ignore */ } }
    router.push(nextPath);
    router.refresh();
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    await signIn('google', { callbackUrl: nextPath });
  }

  // Step 1: send OTP to the email
  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim()) return setError('Please enter your email address.');
    setLoading(true);

    const res  = await fetch('/api/otp/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    setLoading(false);

    if (!res.ok || !data.ok) {
      setError(data.error ?? 'Failed to send code. Please try again.');
      return;
    }
    setStep('otp');
    startCooldown();
  }

  // Step 2: verify OTP — single call to NextAuth which verifies from DB
  async function handleOtpSubmit(e: FormEvent) {
    e.preventDefault();
    setOtpError('');
    if (otp.length !== 6) return setOtpError('Please enter the 6-digit code.');
    setOtpLoading(true);

    const signInRes = await signIn('credentials-otp', {
      redirect: false,
      email,
      code:     otp,
    });
    setOtpLoading(false);

    if (!signInRes || signInRes.error) {
      setOtpError('Invalid or expired code. Please try again.');
      return;
    }
    redirect();
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setOtpError('');
    const res = await fetch('/api/otp/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    });
    if (res.ok) startCooldown();
    else setOtpError('Could not resend. Please try again.');
  }

  // Password fallback (existing password users)
  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await signIn('credentials', { redirect: false, email, password });
    setLoading(false);

    if (res?.error) {
      setError(
        res.error.includes('Google Sign-In')
          ? 'This account uses Google. Please use "Continue with Google" above.'
          : t.signIn.errorDefault,
      );
    } else {
      redirect();
    }
  }

  // ── Shared hero ───────────────────────────────────────────────────────────────
  const Hero = () => (
    <>
      <style>{`
        @keyframes gcFadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes gcPop    { 0% { transform: scale(.7); opacity: 0; } 60% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
        .gc-tagline span { display: inline-block; opacity: 0; animation: gcFadeUp .55s ease forwards; }
        .gc-pop { animation: gcPop .5s ease forwards; }
      `}</style>
      <div className="text-center mb-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/gascap-icon-raw.png" alt="GasCap" className="h-16 w-auto mx-auto mb-3 gc-pop drop-shadow-sm" />
        <p className="gc-tagline text-xl font-black text-navy-700 tracking-tight">
          <span style={{ animationDelay: '60ms' }}>Know</span>{' '}
          <span style={{ animationDelay: '180ms' }}>before</span>{' '}
          <span style={{ animationDelay: '300ms' }}>you</span>{' '}
          <span style={{ animationDelay: '420ms' }}>go</span>
        </p>
      </div>
    </>
  );

  // ── OTP step ──────────────────────────────────────────────────────────────────
  if (step === 'otp') {
    return (
      <div className="min-h-screen bg-[#eef1f7] flex flex-col">
        <BrandBar />
        <div className="flex-1 flex items-start justify-center px-4 pt-8 pb-16">
          <div className="w-full max-w-sm">
            <Hero />

            <button
              type="button"
              onClick={() => { setStep('email'); setOtp(''); setOtpError(''); }}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5"
            >
              ← Back
            </button>

            <h1 className="text-2xl font-black text-navy-700 mb-1">Check your email</h1>
            <p className="text-slate-500 text-sm mb-1">We sent a 6-digit code to</p>
            <p className="text-slate-800 font-bold text-sm mb-6 break-all">{email}</p>

            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <div>
                <label className="field-label" htmlFor="otp-code">Enter your code</label>
                <input
                  ref={otpInputRef}
                  id="otp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  className="input-field text-center text-3xl font-black tracking-[0.5em] py-4"
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
                  required
                />
              </div>

              {otpError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <p className="text-red-600 text-sm font-medium">{otpError}</p>
                </div>
              )}

              <button type="submit" disabled={otpLoading || otp.length !== 6} className="btn-amber mt-2">
                {otpLoading ? 'Signing in…' : 'Sign in →'}
              </button>
            </form>

            <div className="mt-5 text-center space-y-3">
              {resendCooldown > 0 ? (
                <p className="text-sm text-slate-400">Resend available in {resendCooldown}s</p>
              ) : (
                <button onClick={handleResend} className="text-sm text-amber-600 font-semibold hover:underline">
                  Resend code
                </button>
              )}
              <p className="text-xs text-slate-400">
                Have a password?{' '}
                <button
                  type="button"
                  onClick={() => { setStep('password'); setOtpError(''); }}
                  className="text-amber-600 font-semibold hover:underline"
                >
                  Sign in with password
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Password fallback ─────────────────────────────────────────────────────────
  if (step === 'password') {
    return (
      <div className="min-h-screen bg-[#eef1f7] flex flex-col">
        <BrandBar />
        <div className="flex-1 flex items-start justify-center px-4 pt-8 pb-16">
          <div className="w-full max-w-sm">
            <Hero />

            <button
              type="button"
              onClick={() => { setStep('otp'); setError(''); }}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5"
            >
              ← Back
            </button>

            <h1 className="text-2xl font-black text-navy-700 mb-1">Sign in with password</h1>
            <p className="text-slate-500 text-sm mb-5 break-all">{email}</p>

            <form onSubmit={handlePasswordSubmit} noValidate className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="field-label !mb-0" htmlFor="password">{t.signIn.passwordLabel}</label>
                  <Link href="/forgot-password" className="text-xs text-amber-600 hover:underline font-semibold">
                    {t.signIn.forgotPw}
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="password" type={showPw ? 'text' : 'password'}
                    autoComplete="current-password" className="input-field pr-11"
                    placeholder={t.signIn.passwordHolder}
                    value={password} onChange={(e) => setPassword(e.target.value)} required
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                    aria-label={showPw ? 'Hide password' : 'Show password'}>
                    <EyeIcon open={showPw} />
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <p className="text-red-600 text-sm font-medium">{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-amber mt-2">
                {loading ? t.signIn.loading : t.signIn.button}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 1: email entry ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col">
      <BrandBar />
      <div className="flex-1 flex items-start justify-center px-4 pt-8 pb-16">
        <div className="w-full max-w-sm">
          <Hero />

          <h1 className="text-2xl font-black text-navy-700 mb-1">{t.signIn.title}</h1>
          <p className="text-slate-500 text-sm mb-5">{t.signIn.sub}</p>

          {verified && (
            <div className="mb-5 bg-green-50 border border-green-200 rounded-2xl px-4 py-3 flex items-start gap-3">
              <span className="text-lg flex-shrink-0">✅</span>
              <div>
                <p className="text-sm font-black text-green-800">{t.signIn.verifiedBanner.title}</p>
                <p className="text-xs text-green-700 leading-relaxed mt-0.5">{t.signIn.verifiedBanner.body}</p>
              </div>
            </div>
          )}

          {!hideGoogle && (
            <>
              <button type="button" onClick={handleGoogleSignIn} disabled={googleLoading}
                className="w-full flex items-center justify-center gap-3 py-3 px-4
                           bg-white border border-slate-200 rounded-2xl shadow-sm
                           hover:bg-slate-50 hover:border-slate-300 transition-all
                           text-slate-700 font-semibold text-sm disabled:opacity-60">
                <GoogleIcon />
                {googleLoading ? t.signIn.redirecting : t.signIn.continueWithGoogle}
              </button>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 font-medium">or sign in with email</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
            </>
          )}

          <form onSubmit={handleEmailSubmit} noValidate className="space-y-4">
            <div>
              <label className="field-label" htmlFor="email">{t.signIn.emailLabel}</label>
              <input
                id="email" type="email" autoComplete="email"
                className="input-field" placeholder={t.signIn.emailHolder}
                value={email} onChange={(e) => setEmail(e.target.value)} required
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-red-600 text-sm font-medium">{error}</p>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-amber mt-2">
              {loading ? 'Sending code…' : 'Send my code →'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-6">
            {t.signIn.noAccount}{' '}
            <Link href="/signup" className="text-amber-600 font-bold hover:underline">
              {t.signIn.signUpFree}
            </Link>
          </p>

          <p className="text-center text-sm mt-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 text-xs">
              {t.signIn.continueGuest}
            </Link>
          </p>

          <div className="mt-9 grid grid-cols-3 gap-2">
            {[
              { icon: '⛽', label: 'Save your\nvehicles' },
              { icon: '📈', label: 'Track your\nMPG' },
              { icon: '🎁', label: 'Win gas\ncards' },
            ].map((v) => (
              <div key={v.label} className="rounded-2xl bg-white/70 border border-slate-200 px-2 py-3
                                             flex flex-col items-center text-center gap-1">
                <span className="text-xl" aria-hidden="true">{v.icon}</span>
                <span className="text-[11px] font-semibold text-slate-600 leading-tight whitespace-pre-line">{v.label}</span>
              </div>
            ))}
          </div>
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

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <path d="M14.12 14.12A3 3 0 119.88 9.88" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

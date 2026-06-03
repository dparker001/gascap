'use client';

import { useState, useEffect, FormEvent, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslation } from '@/contexts/LanguageContext';
import { trackSignUp, fbTrack, trackGoogleAdsSignup } from '@/lib/gtag';
import SignUpExitIntent from '@/components/SignUpExitIntent';
import BrandBar        from '@/components/BrandBar';

function SignUpForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const refCode      = searchParams.get('ref') ?? '';
  const { t, locale } = useTranslation();

  // Safe internal redirect target after signup (e.g. /redeem?code=…, /upgrade).
  const nextRaw  = searchParams.get('next');
  const nextPath = nextRaw && nextRaw.startsWith('/') ? nextRaw : null;
  const sep      = (path: string) => (path.includes('?') ? '&' : '?');

  // Optional pre-filled email + name (e.g. a gift recipient claiming their gift).
  // Name is an editable default — the buyer may have typed a nickname like "Dad".
  const prefillEmail = searchParams.get('email') ?? '';
  const prefillName  = (searchParams.get('name') ?? '').replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());

  const [fullName,  setFullName]  = useState(prefillName);
  const [email,     setEmail]     = useState(prefillEmail);
  const [phone,     setPhone]     = useState('');
  const [smsOptIn,  setSmsOptIn]  = useState(false);
  const [password,  setPassword]  = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Robustly apply pre-fill once the URL params are available (handles the case
  // where useSearchParams resolves after first render). Never overwrites typed input.
  useEffect(() => {
    if (prefillEmail) setEmail((cur) => cur || prefillEmail);
    if (prefillName)  setFullName((cur) => cur || prefillName);
  }, [prefillEmail, prefillName]);

  const pwValid = password.length >= 8;

  // Capitalize the first letter of each word as the user types
  function handleNameChange(val: string) {
    const capitalized = val.replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());
    setFullName(capitalized);
  }

  async function handleGoogleSignUp() {
    setGoogleLoading(true);
    // If a redirect target is set (e.g. gift redemption), honor it; else welcome flow.
    const callbackUrl = nextPath
      ? `${nextPath}${sep(nextPath)}welcome=1`
      : (refCode ? `/?welcome=1&ref=${refCode}` : '/?welcome=1');
    await signIn('google', { callbackUrl });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!fullName.trim()) return setError(t.signUp.errors.noName ?? 'Please enter your name.');
    if (!pwValid)         return setError(t.signUp.errors.pwReqs);

    setLoading(true);

    // Split full name into first / last for the API
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0] ?? '';
    const lastName  = nameParts.slice(1).join(' ');

    // Register via API — include referral code + active locale so the
    // verification email link can bring the user back to the correct language.
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName,
        lastName,
        email,
        password,
        locale,
        ...(phone.trim()  ? { phone: phone.trim() } : {}),
        ...(smsOptIn      ? { smsOptIn: true }       : {}),
        ...(refCode       ? { referralCode: refCode } : {}),
      }),
    });

    if (!res.ok) {
      const data = await res.json() as { error?: string };
      setError(data.error ?? t.signUp.errors.fallback);
      setLoading(false);
      return;
    }

    // ── Conversion tracking ───────────────────────────────────────────────
    // Fire immediately after the server confirms account creation.
    // Both events run client-side so the pixel/gtag scripts are available.
    trackSignUp();                          // GA4: sign_up event
    fbTrack('CompleteRegistration');        // Meta Pixel: CompleteRegistration
    trackGoogleAdsSignup();                 // Google Ads: Sign-up conversion
    // ─────────────────────────────────────────────────────────────────────

    // Auto sign-in after registration
    const signInRes = await signIn('credentials', {
      redirect: false,
      email,
      password,
    });

    setLoading(false);

    if (signInRes?.error) {
      // Auto sign-in failed — send to sign-in page (preserve redirect target)
      router.push(nextPath ? `/signin?next=${encodeURIComponent(nextPath)}` : '/signin');
    } else if (nextPath) {
      // Redirect target set (e.g. claim a gift) — go there with the welcome flag.
      router.push(`${nextPath}${sep(nextPath)}welcome=1`);
    } else {
      // Signed in — drop them straight into the calculator with the welcome banner.
      // The FreshSignupBanner will remind them to verify their email.
      router.push('/?welcome=1');
    }
  }

  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col">
      <BrandBar />

      {/* Form */}
      <div className="flex-1 flex items-start justify-center px-4 pt-10 pb-16">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-black text-navy-700 mb-1">{t.signUp.title}</h1>
          <p className="text-slate-500 text-sm mb-4">{t.signUp.sub}</p>

          {/* Quick benefit cards */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            {([
              { icon: '💰', label: 'Stop overspending' },
              { icon: '⚡', label: 'Know before you go' },
              { icon: '📱', label: 'No app store needed' },
            ] as { icon: string; label: string }[]).map(({ icon, label }) => (
              <div
                key={label}
                className="bg-white border border-slate-100 rounded-xl p-2.5 text-center shadow-sm"
              >
                <div className="text-lg mb-1" aria-hidden="true">{icon}</div>
                <p className="text-[10px] font-semibold text-slate-600 leading-tight">{label}</p>
              </div>
            ))}
          </div>

          {/* Pro trial callout */}
          <div className="mb-5 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
            <span className="text-xl flex-shrink-0">🎁</span>
            <p className="text-sm font-bold text-amber-800">{t.signUp.proTrial}</p>
          </div>

          {/* Referral banner */}
          {refCode && (
            <div className="mb-5 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-3">
              <span className="text-lg flex-shrink-0">🔗</span>
              <div>
                <p className="text-sm font-black text-amber-800">{t.signUp.referralBanner.title}</p>
                <p className="text-xs text-amber-700 leading-relaxed mt-0.5">
                  {t.signUp.referralBanner.body1}{' '}
                  <span className="font-mono font-bold">{refCode}</span>{' '}
                  {t.signUp.referralBanner.body2}
                </p>
              </div>
            </div>
          )}

          {/* ── Google Sign-Up ──────────────────────────────────────── */}
          <button
            type="button"
            onClick={handleGoogleSignUp}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-3 py-3 px-4
                       bg-white border border-slate-200 rounded-2xl shadow-sm
                       hover:bg-slate-50 hover:border-slate-300 transition-all
                       text-slate-700 font-semibold text-sm disabled:opacity-60"
          >
            <GoogleIcon />
            {googleLoading ? t.signUp.redirecting : t.signUp.continueWithGoogle}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-medium">or</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* ── Email / Password form ────────────────────────────────── */}
          <form onSubmit={handleSubmit} noValidate className="space-y-4">

            {/* Full name — single field */}
            <div>
              <label className="field-label" htmlFor="fullName">
                {t.signUp.fullNameLabel ?? 'Full name'}
              </label>
              <input
                id="fullName" type="text" autoComplete="name"
                autoCapitalize="words"
                className="input-field"
                placeholder={t.signUp.fullNamePlaceholder ?? 'Alex Johnson'}
                value={fullName}
                onChange={(e) => handleNameChange(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor="email">{t.signUp.emailLabel}</label>
              <input
                id="email" type="email" autoComplete="email"
                className="input-field" placeholder={t.signUp.emailHolder}
                value={email} onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor="password">{t.signUp.passwordLabel}</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  className="input-field pr-11"
                  placeholder={t.signUp.passwordHolder}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400
                             hover:text-slate-600 transition-colors p-0.5"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon open={showPw} />
                </button>
              </div>
              {password.length > 0 && (
                <p className={`mt-1.5 text-xs font-medium ${pwValid ? 'text-green-600' : 'text-slate-400'}`}>
                  {pwValid ? '✓ Good to go' : '8 characters minimum'}
                </p>
              )}
            </div>

            {/* Phone + SMS opt-in — always visible, always at the bottom */}
            <div>
              <label className="field-label" htmlFor="phone">{t.signUp.phoneLabel}</label>
              <input
                id="phone" type="tel" autoComplete="tel"
                className="input-field" placeholder={t.signUp.phoneHolder}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (!e.target.value.trim()) setSmsOptIn(false);
                }}
              />
            </div>

            {/* SMS consent panel — teal highlight when opted in */}
            <div className={`rounded-xl border p-3.5 transition-all ${smsOptIn ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-slate-50'}`}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smsOptIn}
                  onChange={(e) => setSmsOptIn(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600
                             focus:ring-teal-500 cursor-pointer flex-shrink-0"
                />
                <div>
                  <p className={`text-sm font-semibold ${smsOptIn ? 'text-teal-800' : 'text-slate-600'}`}>
                    Send me SMS alerts
                  </p>
                  <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">
                    Gas price drops, fill-up reminders, and account notifications.
                    Msg &amp; data rates may apply. Reply STOP to opt out at any time.
                    Must be 18+ to receive SMS. See our{' '}
                    <a href="/terms#sms" className="text-amber-600 hover:underline" target="_blank" rel="noopener noreferrer">
                      SMS Terms
                    </a>.
                  </p>
                </div>
              </label>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-red-600 text-sm font-medium">{error}</p>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-amber mt-2">
              {loading ? t.signUp.loading : t.signUp.button}
            </button>
          </form>

          {/* Trust signals */}
          <div className="mt-5 flex items-center justify-center gap-4 text-[10px] text-slate-400">
            <span>{t.signUp.trustFree}</span>
            <span>{t.signUp.trustNoCard}</span>
            <span>{t.signUp.trustCancel}</span>
          </div>

          <p className="text-center text-sm text-slate-500 mt-5">
            {t.signUp.haveAccount}{' '}
            <Link href="/signin" className="text-amber-600 font-bold hover:underline">
              {t.signUp.signIn}
            </Link>
          </p>

          <p className="text-center mt-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 text-xs">
              {t.signUp.continueGuest}
            </Link>
          </p>

          <p className="text-center text-[11px] text-slate-400 mt-4 leading-relaxed">
            {t.signUp.termsNote}{' '}
            <Link href="/terms"   className="hover:text-amber-600 underline">{t.signUp.terms}</Link>
            {' '}{t.signUp.and}{' '}
            <Link href="/privacy" className="hover:text-amber-600 underline">{t.signUp.privacy}</Link>.
          </p>
        </div>
      </div>

      {/* Exit-intent bottom sheet — fires after 8 s on exit signals */}
      <SignUpExitIntent />
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

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <path d="M14.12 14.12A3 3 0 119.88 9.88" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

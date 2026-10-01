'use client';

/**
 * $20 Gift Campaign landing — client body. Copy lives in
 * translations.gift20 (EN + ES); this file is layout + tracking only.
 *
 * Tracking: CampaignTracker logs page_view/return_visit under the gc_src
 * card code. Each section logs one `section_view` when it first scrolls into
 * view (last section seen = where a visitor dropped off), and every CTA logs
 * a `cta_click`. Visits without a card code (typed URL) are silently
 * unattributed by /api/campaign/track — no extra branching needed here.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import BrandBar from '@/components/BrandBar';
import CampaignTracker from '@/components/CampaignTracker';
import { useTranslation } from '@/contexts/LanguageContext';
import { detectNativePlatform } from '@/hooks/useIsNative';
import { PRICING } from '@/lib/stripe';
import {
  ANDROID_APP_URL, IOS_APP_URL, GIFT20_CONSENT_VERSION,
  type Gift20Cta, type Gift20Section,
} from '@/lib/gift20';

type Device = 'ios' | 'android' | 'other';
export type ShellEnv = 'unknown' | 'web' | 'native';

function detectDevice(): Device {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

function track(type: 'cta_click' | 'section_view', meta: { cta: Gift20Cta } | { section: Gift20Section }) {
  try {
    void fetch('/api/campaign/track', {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      JSON.stringify({ type, meta, path: window.location.pathname }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* tracking never breaks the page */ }
}

const PRICE = `$${PRICING.pro.lifetime}`;
const withPrice = (s: string) => s.replace('{price}', PRICE);

// ── Store buttons ───────────────────────────────────────────────────────────

function StoreButton({ store, label, large }: { store: 'ios' | 'android'; label: string; large?: boolean }) {
  const ios = store === 'ios';
  return (
    <a
      href={ios ? IOS_APP_URL : ANDROID_APP_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track('cta_click', { cta: ios ? 'app_store' : 'google_play' })}
      className={`flex items-center justify-center gap-2.5 rounded-2xl bg-black text-white font-bold shadow-lift
                  active:scale-[0.98] transition-transform ${large ? 'px-6 py-4 text-base w-full' : 'px-4 py-3 text-sm'}`}
      style={{ minHeight: 48 }}
    >
      {ios ? (
        <svg viewBox="0 0 384 512" width="20" height="20" fill="currentColor" aria-hidden="true">
          <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
        </svg>
      ) : (
        <svg viewBox="0 0 512 512" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M325.3 234.3L104.6 13c-6.2-6.1-16.4-6.5-23.3-.9-3.8 3.1-6 7.9-6 12.8v462.2c0 4.9 2.2 9.7 6 12.8 6.9 5.6 17.1 5.2 23.3-.9l220.7-221.3zm97.5 44.2l-49.4-29-52.9 53 52.9 53 49.4-29c25.2-14.8 25.2-53.2 0-68z" />
        </svg>
      )}
      <span>{label}</span>
      <span className="sr-only">{ios ? '(App Store)' : '(Google Play)'}</span>
    </a>
  );
}

/** Device-aware download block. Before mount, renders both (SSR-stable). */
function DownloadButtons({ device, mounted, label, webLabel }: {
  device: Device; mounted: boolean; label: string; webLabel: string;
}) {
  if (mounted && device === 'ios')     return <StoreButton store="ios" label={label} large />;
  if (mounted && device === 'android') return <StoreButton store="android" label={label} large />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <StoreButton store="ios" label="App Store" />
        <StoreButton store="android" label="Google Play" />
      </div>
      <Link
        href="/"
        onClick={() => track('cta_click', { cta: 'web_app' })}
        className="block text-center text-sm font-semibold underline underline-offset-4 opacity-90"
      >
        {webLabel}
      </Link>
    </div>
  );
}

// ── Section wrapper with one-shot view tracking ─────────────────────────────

function Section({ id, name, className, children }: {
  id?: string; name: Gift20Section; className?: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        track('section_view', { section: name });
        obs.disconnect();
      }
    // A thin band across the middle of the viewport rather than a % of the
    // section: a fractional threshold can never be reached by a section
    // taller than ~1/threshold screens (the getaway terms on a small phone),
    // which would silently record that section as never seen.
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [name]);
  return <section id={id} ref={ref} className={className}>{children}</section>;
}

// ── Lead form ───────────────────────────────────────────────────────────────

function UpdatesForm() {
  const { t } = useTranslation();
  const g = t.gift20;
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [emailOk, setEmailOk]   = useState(false);
  const [state, setState]       = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError]       = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(g.updatesErrEmail); return; }
    if (!emailOk) { setError(g.updatesErrConsent); return; }
    setState('sending');
    try {
      const res = await fetch('/api/campaign/lead', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:  name.trim() || undefined,
          email: email.trim(),
          // No phone field for this test (2026-10-01): /gift/20 is not a
          // registered A2P opt-in source, so SMS consent isn't collected here.
          emailConsent: true,
        }),
      });
      if (!res.ok) throw new Error();
      setState('done');
    } catch {
      setError(g.updatesErrGeneric);
      setState('idle');
    }
  }

  if (state === 'done') {
    return <p className="rounded-2xl bg-white p-4 text-center font-bold text-brand-dark">{g.updatesSuccess}</p>;
  }

  const input = 'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-navy-800 focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30';
  return (
    <form onSubmit={submit} className="space-y-3" noValidate data-consent-version={GIFT20_CONSENT_VERSION}>
      <input className={input} placeholder={g.updatesFirstName} autoComplete="given-name"
             value={name} onChange={(e) => setName(e.target.value)} />
      <input className={input} placeholder={g.updatesEmail} type="email" autoComplete="email" inputMode="email"
             value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="flex gap-3 text-sm text-slate-600 leading-snug">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-dark"
               checked={emailOk} onChange={(e) => setEmailOk(e.target.checked)} />
        <span>{g.updatesEmailConsent}</span>
      </label>
      {error && <p className="text-sm font-semibold text-red-600" role="alert">{error}</p>}
      <button type="submit" disabled={state === 'sending'}
              className="w-full rounded-2xl bg-navy-700 py-3.5 font-bold text-white disabled:opacity-60">
        {state === 'sending' ? g.updatesSubmitting : g.updatesSubmit}
      </button>
      <p className="text-center text-xs text-slate-500">
        <Link href="/privacy" className="underline underline-offset-2">{g.updatesPrivacy}</Link>
      </p>
    </form>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Gift20Landing({ founderPhoto }: { founderPhoto: string | null }) {
  const { t } = useTranslation();
  const g = t.gift20;
  // Three states, not a boolean: the shared useIsNative() reports false both
  // before detection has run (SSR + first client render) AND for a confirmed
  // browser, so gating Stripe on it would put the web checkout link in the
  // server HTML a native shell receives. Stripe renders only once 'web' is
  // CONFIRMED on the client; 'unknown' and 'native' never render it.
  const [env, setEnv] = useState<ShellEnv>('unknown');
  useEffect(() => { setEnv(detectNativePlatform() ? 'native' : 'web'); }, []);
  const isNative = env === 'native';
  const { status } = useSession();
  const [mounted, setMounted] = useState(false);
  const [device, setDevice]   = useState<Device>('other');
  const [showSticky, setShowSticky] = useState(false);
  const heroRef     = useRef<HTMLDivElement>(null);
  const lifetimeRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setDevice(detectDevice()); setMounted(true); }, []);

  // Sticky download bar: visible once the hero has scrolled away, hidden
  // while the Lifetime offer is on screen so two CTAs never compete.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    let heroVisible = true, lifetimeVisible = false;
    const update = () => setShowSticky(!heroVisible && !lifetimeVisible);
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === heroRef.current)     heroVisible = e.isIntersecting;
        if (e.target === lifetimeRef.current) lifetimeVisible = e.isIntersecting;
      }
      update();
    });
    if (heroRef.current)     obs.observe(heroRef.current);
    if (lifetimeRef.current) obs.observe(lifetimeRef.current);
    return () => obs.disconnect();
  }, []);

  const lifetimeHref = status === 'authenticated'
    ? '/upgrade?auto=lifetime'
    : '/signup?next=' + encodeURIComponent('/upgrade?auto=lifetime');

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-navy-800">
      <CampaignTracker />
      <BrandBar />

      {/* ── 1. Hero ─────────────────────────────────────────────────────── */}
      <Section name="hero" className="bg-gradient-to-b from-brand-dark to-[#00463a] px-4 pb-10 pt-8 text-white">
        <div ref={heroRef} className="mx-auto max-w-md">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-teal">{g.eyebrow}</p>
          <h1 className="mt-3 text-[2.15rem] font-black leading-[1.08] tracking-tight">{g.heroTitle}</h1>
          <p className="mt-3 text-lg font-semibold text-white/95">{g.heroSub}</p>
          <p className="mt-3 text-base leading-relaxed text-white/80">{g.heroBody}</p>

          {!isNative && (
            <div className="mt-6">
              <DownloadButtons device={device} mounted={mounted} label={g.ctaDownload} webLabel={g.ctaWebApp} />
              <p className="mt-3 text-center text-xs leading-snug text-white/70">{g.trialNote}</p>
            </div>
          )}

          <a href="#why" onClick={() => track('cta_click', { cta: 'see_why' })}
             className="mt-5 block text-center text-sm font-bold text-white underline underline-offset-4">
            {g.ctaSeeWhy} ↓
          </a>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marketing/gift20/result-card.jpg" alt={g.imageAlt} width={700} height={450}
               className="mt-7 w-full rounded-2xl shadow-lift ring-1 ring-white/10" />
        </div>
      </Section>

      {/* ── 2. Your $20, your choice ──────────────────────────────────── */}
      <Section name="choice" className="px-4 py-10">
        <div className="mx-auto max-w-md">
          <h2 className="text-2xl font-black tracking-tight">{g.choiceTitle}</h2>
          <div className="mt-5 grid gap-3">
            <div className="rounded-2xl bg-white p-5 shadow-card">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">{g.optionALabel}</p>
              <p className="mt-1 text-lg font-black">{g.optionATitle}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{g.optionABody}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-card">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">{g.optionBLabel}</p>
              <p className="mt-1 text-lg font-black">{g.optionBTitle}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{withPrice(g.optionBBody)}</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-slate-500">{g.choiceFootnote}</p>
        </div>
      </Section>

      {/* ── 3. What is GasCap ─────────────────────────────────────────── */}
      <Section name="features" className="bg-white px-4 py-10">
        <div className="mx-auto max-w-md">
          <h2 className="text-2xl font-black tracking-tight">{g.featuresTitle}</h2>
          <p className="mt-3 leading-relaxed text-slate-600">{g.featuresLead}</p>
          <ul className="mt-6 space-y-4">
            {g.features.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-teal" aria-hidden="true" />
                <div>
                  <p className="font-black">
                    {f.title}
                    {f.pro && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[10px] font-black uppercase tracking-wider text-amber-700">
                        {g.proBadge}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs leading-relaxed text-slate-500">{g.featuresProNote}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{g.featuresEstimateNote}</p>
        </div>
      </Section>

      {/* ── 4. Founder ────────────────────────────────────────────────── */}
      <Section id="why" name="founder" className="scroll-mt-24 px-4 py-10">
        <div className="mx-auto max-w-md">
          <h2 className="text-2xl font-black tracking-tight">{g.founderTitle}</h2>
          <figure className="mt-5 flex items-center gap-4">
            {founderPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={founderPhoto} alt={g.founderCaption} width={96} height={96}
                   className="h-24 w-24 rounded-full object-cover shadow-card" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-dark text-2xl font-black text-white shadow-card"
                   aria-hidden="true">DP</div>
            )}
            <figcaption className="text-sm font-bold text-slate-600">{g.founderCaption}</figcaption>
          </figure>
          <div className="mt-6 space-y-4 text-[17px] leading-relaxed text-navy-800">
            {g.founderParas.map((p, i) => <p key={i}>{withPrice(p)}</p>)}
            <p className="font-bold">{g.founderSignoff}</p>
          </div>
          <p className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-600">
            {g.getawayTransition}
          </p>
        </div>
      </Section>

      {/* ── 5. Lifetime ───────────────────────────────────────────────── */}
      <Section name="lifetime" className="bg-navy-800 px-4 py-10 text-white">
        <div ref={lifetimeRef} className="mx-auto max-w-md">
          <h2 className="text-2xl font-black tracking-tight">{g.lifetimeTitle}</h2>
          <p className="mt-4">
            <span className="text-5xl font-black">{PRICE}</span>
            <span className="ml-2 text-sm font-semibold text-white/70">{g.lifetimePriceNote}</span>
          </p>
          <p className="mt-4 leading-relaxed text-white/85">{withPrice(g.lifetimeBody)}</p>

          {env === 'native' && (
            <p className="mt-6 rounded-2xl bg-white/10 p-4 text-sm font-semibold">{g.lifetimeNativeNote}</p>
          )}
          {env === 'web' && (
            <>
              <Link
                href={lifetimeHref}
                onClick={() => track('cta_click', { cta: 'web_lifetime' })}
                className="mt-6 block w-full rounded-2xl bg-brand-teal py-4 text-center text-base font-black text-white shadow-teal active:scale-[0.98] transition-transform"
              >
                {withPrice(g.lifetimeCta)}
              </Link>
              <p className="mt-3 text-xs leading-relaxed text-white/70">
                {g.lifetimeFinal} (<Link href="/terms" className="underline underline-offset-2">{g.lifetimeTerms}</Link>).{' '}
                {g.lifetimeSameAccount}
              </p>
              <p className="mt-4 text-sm text-white/80">{g.lifetimeInApp}</p>
            </>
          )}
          {/* env === 'unknown' (server render / before detection): no purchase CTA at all. */}
        </div>
      </Section>

      {/* ── 6. Vacation certificate (visually distinct) ───────────────── */}
      <Section name="getaway" className="px-4 py-10">
        <div className="mx-auto max-w-md rounded-3xl border border-[#e8dcc4] bg-[#fbf7ef] p-5">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#8a6d3b]">{g.getawayEyebrow}</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">{g.getawayTitle}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">{g.getawayLead}</p>

          <h3 className="mt-5 font-black">{g.getawayWhoTitle}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{g.getawayWho}</p>

          <h3 className="mt-5 font-black">{g.getawayHowTitle}</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
            {g.getawaySteps.map((s) => <li key={s}>{s}</li>)}
          </ol>

          <h3 className="mt-5 font-black">{g.getawayCostsTitle}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{g.getawayCovered}</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{g.getawayYouPay}</p>

          <h3 className="mt-5 font-black">{g.getawayTermsTitle}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
            {g.getawayTerms.map((s) => <li key={s}>{s}</li>)}
          </ul>

          <Link href="/terms#getaway" onClick={() => track('cta_click', { cta: 'getaway_terms' })}
                className="mt-5 block font-bold text-brand-dark underline underline-offset-4">
            {g.getawayTermsLink} →
          </Link>
          <p className="mt-2 text-xs text-slate-500">{g.getawayPartnerNote}</p>
        </div>
      </Section>

      {/* ── 7. Optional updates ───────────────────────────────────────── */}
      <Section name="updates" className="bg-white px-4 py-10">
        <div className="mx-auto max-w-md">
          <h2 className="text-xl font-black tracking-tight">{g.updatesTitle}</h2>
          <p className="mt-1 mb-5 text-sm text-slate-500">{g.updatesBody}</p>
          <UpdatesForm />
        </div>
      </Section>

      <footer className="px-4 pb-28 pt-8 text-center text-xs leading-relaxed text-slate-500">
        <p>{g.footerEntity}</p>
        <p className="mt-2 space-x-3">
          <Link href="/terms" className="underline">{g.lifetimeTerms}</Link>
          <Link href="/privacy" className="underline">{g.updatesPrivacy}</Link>
          <a href="mailto:admin@gascap.app" className="underline">admin@gascap.app</a>
        </p>
      </footer>

      {/* Sticky download bar (phones only) */}
      {!isNative && mounted && device !== 'other' && (
        <div
          className={`fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 pt-3 backdrop-blur transition-all duration-300 ${showSticky ? 'visible translate-y-0' : 'invisible translate-y-full'}`}
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto max-w-md">
            <StoreButton store={device} label={g.stickyCta} large />
          </div>
        </div>
      )}
    </main>
  );
}

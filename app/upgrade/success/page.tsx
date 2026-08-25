'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';
import { getawayPromoActive } from '@/lib/getawayPromo';
import GetawayDestinationPicker from '@/components/GetawayDestinationPicker';
import { fbTrack } from '@/lib/gtag';
import { isNativeIapSuccess, resolveNativeIapConfirmation, type ReconciledEntitlement } from '@/lib/iapNavigationGate';

// ── Per-plan content ────────────────────────────────────────────────────────
// Plan content (headline/intro/perks) is built from translations inside the
// component so the success page is fully localized (EN/ES). Colors live here.

type PlanKey = 'pro-monthly' | 'pro-lifetime' | 'fleet';

const PLAN_COLOR: Record<PlanKey, string> = {
  'pro-monthly':  'amber',
  'pro-lifetime': 'teal',
  'fleet':        'blue',
};

// ── Color helpers ────────────────────────────────────────────────────────────

function ctaClass(color: string) {
  if (color === 'teal') return 'bg-teal-500 hover:bg-teal-400 text-white';
  if (color === 'blue') return 'bg-blue-600 hover:bg-blue-500 text-white';
  return 'bg-amber-500 hover:bg-amber-400 text-white';
}
function iconBgClass(color: string) {
  if (color === 'teal') return 'bg-teal-100';
  if (color === 'blue') return 'bg-blue-100';
  return 'bg-amber-100';
}
function iconColorClass(color: string) {
  if (color === 'teal') return 'text-teal-500';
  if (color === 'blue') return 'text-blue-600';
  return 'text-amber-500';
}
function labelColorClass(color: string) {
  if (color === 'teal') return 'text-teal-600';
  if (color === 'blue') return 'text-blue-700';
  return 'text-amber-600';
}

// ── Main content ─────────────────────────────────────────────────────────────

function SuccessContent() {
  const params    = useSearchParams();
  const router    = useRouter();
  const { update: refreshSession } = useSession();
  const { t } = useTranslation();
  const sessionId = params.get('session_id');
  const tier      = params.get('tier') ?? 'pro';
  const billing   = params.get('billing') ?? 'monthly';
  // 'method=iap' is set ONLY by app/upgrade/page.tsx's native handleIap()/
  // handleRestore() — a Stripe Checkout redirect always carries session_id
  // instead and never this param. This page is shared by both flows; the
  // distinction matters because native purchases already went through
  // server-authoritative reconciliation (POST /api/user/sync-revenuecat,
  // gated by shouldAllowIapSuccess()) before ever navigating here, and a
  // Capacitor WebView's useSession().update() has been observed to stall
  // indefinitely in production (2026-08-25 — a real Lifetime purchase for
  // info.bodycamfiles@gmail.com stuck on "Activating your account…" despite
  // a fully correct, already-granted entitlement). Stripe/web success is
  // NOT affected by any of this — its own polling loop below is unchanged.
  const isNativeIap = isNativeIapSuccess(params);
  const [ready, setReady] = useState(false);
  // 'ready' means ONLY "stop the spinner" — it is NEVER read as proof of
  // entitlement. For native IAP, whether the requested purchase is actually
  // server-confirmed lives in this SEPARATE state (2026-08-25 correction —
  // query params like method=iap/billing=lifetime must never by themselves
  // authorize the success UI or getaway eligibility; a directly-visited or
  // spoofed success URL must not visually assert a purchase the server
  // hasn't confirmed). 'pending' only applies mid-flight for native; Stripe/
  // web never sets this and is unaffected — see below.
  const [nativeConfirmed, setNativeConfirmed] = useState<'pending' | 'confirmed' | 'unconfirmed'>('pending');

  // ── Native IAP recovery path ─────────────────────────────────────────────
  // Never depends on useSession().update() — asks the existing
  // server-authoritative endpoint directly, bounded by a client-side timeout
  // so a network stall still converges deterministically instead of
  // spinning. The purchase was AUTHORIZED client-side before navigating here
  // (handleIap() already gated the initial navigation on shouldAllowIapSuccess),
  // but that is not durable proof for THIS page load — a direct/refreshed/
  // spoofed visit to this URL carries no such guarantee, so this endpoint's
  // response is re-evaluated through the SAME shouldAllowIapSuccess() gate
  // every time. Only a response that reconciles with the REQUESTED tier
  // (`billing`) sets nativeConfirmed='confirmed'; anything else — timeout,
  // non-2xx, no entitlement, or an entitlement that doesn't match what was
  // requested — sets 'unconfirmed'. The spinner still always stops.
  function runNativeReconciliation() {
    setNativeConfirmed('pending');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    fetch('/api/user/sync-revenuecat', { method: 'POST', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return null;
        return await res.json() as ReconciledEntitlement;
      })
      .catch(() => null)
      .then((server) => {
        const state = resolveNativeIapConfirmation(billing === 'lifetime' ? 'lifetime' : 'monthly', server);
        setNativeConfirmed(state);
        // Best-effort JWT refresh — never gates the confirmation decision above.
        if (state === 'confirmed') refreshSession().catch(() => {});
      })
      .finally(() => {
        clearTimeout(timeout);
        setReady(true); // stop the spinner regardless — never the entitlement signal
      });

    return () => { clearTimeout(timeout); controller.abort(); };
  }

  useEffect(() => {
    if (!isNativeIap) return;
    return runNativeReconciliation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNativeIap]);

  // ── Stripe/web success path (unchanged) ──────────────────────────────────
  // Poll the session until the webhook has applied the upgrade, instead of a
  // single fixed wait. The Stripe webhook (checkout.session.completed) can take
  // a few seconds — a one-shot 2.5s refresh often raced it, leaving the user on
  // a "You're Pro!" page whose session still said trial/free. We refresh the JWT
  // repeatedly until plan reflects the purchase (or we hit a safety timeout).
  useEffect(() => {
    if (isNativeIap) return; // handled by the native recovery effect above
    let cancelled = false;
    let attempts  = 0;
    const MAX_ATTEMPTS = 8;     // ~1.2s + 8×1.8s ≈ 15s worst case
    const isUpgraded = (s: Awaited<ReturnType<typeof refreshSession>>) => {
      const u = s?.user as { plan?: string; isProTrial?: boolean } | undefined;
      if (!u) return false;
      if (tier === 'fleet') return u.plan === 'fleet';
      return u.plan === 'pro' && !u.isProTrial; // trial cleared = upgrade applied
    };

    async function poll() {
      if (cancelled) return;
      attempts += 1;
      const updated = await refreshSession(); // pulls fresh user data into the JWT
      if (cancelled) return;
      if (isUpgraded(updated) || attempts >= MAX_ATTEMPTS) {
        setReady(true);                        // show success even if webhook is slow
        return;
      }
      setTimeout(poll, 1800);
    }

    const first = setTimeout(poll, 1200);      // small head start for the webhook
    // Hard stop: the purchase is already confirmed before we land here, so never
    // leave the user staring at "activating…" — show the Continue button no matter
    // what (e.g. if a session refresh stalls on the native WebView).
    const hardStop = setTimeout(() => { if (!cancelled) setReady(true); }, 4000);
    return () => { cancelled = true; clearTimeout(first); clearTimeout(hardStop); };
  }, [refreshSession, tier, isNativeIap]);

  // Meta Pixel Purchase event — fires once per checkout session (never again on
  // refresh/re-render). Stripe has already confirmed payment before redirecting
  // here, so this doesn't need to wait on the webhook-propagation poll above.
  // Pulls the real charged amount from Stripe rather than guessing per-plan,
  // since win-back/founding-member offers discount the standard price —
  // ad platforms need the true value for value-based bidding to work.
  useEffect(() => {
    if (!sessionId) return;
    const firedKey = `gc_fb_purchase_${sessionId}`;
    try {
      if (sessionStorage.getItem(firedKey)) return;
      sessionStorage.setItem(firedKey, '1');
    } catch { /* storage unavailable — fire once this session anyway */ }

    fetch(`/api/stripe/session-amount?session_id=${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { amountTotal?: number | null; currency?: string | null } | null) => {
        fbTrack('Purchase', {
          ...(d?.amountTotal != null ? { value: d.amountTotal / 100 } : {}),
          currency: (d?.currency ?? 'usd').toUpperCase(),
          content_name: tier === 'fleet' ? 'fleet' : billing === 'lifetime' ? 'pro-lifetime' : 'pro-monthly',
        });
      })
      .catch(() => {
        // Still fire without a value rather than losing the conversion signal entirely
        fbTrack('Purchase', { currency: 'USD' });
      });
    // sessionId/tier/billing are stable for the life of this page (from the URL)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Resolve which plan content to show
  let planKey: PlanKey;
  if (tier === 'fleet') {
    planKey = 'fleet';
  } else if (billing === 'lifetime') {
    planKey = 'pro-lifetime';
  } else {
    planKey = 'pro-monthly';
  }

  // Localized plan content (EN/ES) — built from translations.
  const PLAN_CONTENT: Record<PlanKey, { headline: string; label: string; intro: string; perks: readonly string[] }> = {
    'pro-monthly':  { headline: t.upgrade.successProHeadline,      label: t.plan.gascapPro,         intro: t.upgrade.successProIntro,      perks: t.upgrade.successFeatures },
    'pro-lifetime': { headline: t.upgrade.successLifetimeHeadline, label: t.plan.gascapProLifetime, intro: t.upgrade.successLifetimeIntro, perks: t.upgrade.successFeaturesLifetime },
    'fleet':        { headline: t.upgrade.successFleetHeadline,    label: t.plan.gascapFleet,       intro: t.upgrade.successFleetIntro,    perks: t.upgrade.successFleetFeatures },
  };
  const plan  = { ...PLAN_CONTENT[planKey], color: PLAN_COLOR[planKey] };

  // Localized Lifetime exclusives
  const exclusives = planKey === 'pro-lifetime'
    ? [
        `🏅  ${t.pricing.exLifetimeBadge}`,
        `📅  ${t.pricing.exTwoXEntries}`,
        `⭐  ${t.pricing.exStreakShield}`,
      ]
    : null;

  // Native IAP, spinner stopped, but the server did NOT confirm the
  // requested entitlement (timeout, non-2xx, no entitlement, or a mismatch
  // between what was requested and what the server actually granted). Never
  // render the Lifetime/Pro success template in this state — query params
  // alone must never visually assert a purchase the server hasn't confirmed.
  if (ready && isNativeIap && nativeConfirmed === 'unconfirmed') {
    return (
      <div className="bg-white rounded-3xl shadow-card p-8 max-w-sm w-full text-center space-y-5">
        <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
          <svg className="w-10 h-10 text-amber-500" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5" /><path d="M12 16h.01" />
          </svg>
        </div>
        <h1 className="text-2xl font-black text-navy-700">{t.upgrade.successUnconfirmedTitle}</h1>
        <p className="text-slate-500 text-sm leading-relaxed">{t.upgrade.successUnconfirmedBody}</p>
        <button
          onClick={runNativeReconciliation}
          className="block w-full py-3.5 rounded-2xl font-black text-base transition-colors text-center bg-amber-500 hover:bg-amber-400 text-white"
        >
          {t.upgrade.successUnconfirmedRetry}
        </button>
        <button onClick={() => router.push('/')}
          className="block w-full py-3 rounded-2xl border-2 border-slate-200 text-sm font-bold
                     text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors">
          {t.upgrade.backToApp}
        </button>
      </div>
    );
  }

  // Lifetime getaway UI requires server-authoritative confirmation for a
  // native purchase — for Stripe/web, checkout + the existing webhook
  // already gate this upstream, unchanged.
  const lifetimeConfirmedForGetaway = isNativeIap ? nativeConfirmed === 'confirmed' : true;

  return (
    <div className="bg-white rounded-3xl shadow-card p-8 max-w-sm w-full text-center space-y-5">

      {/* Animated checkmark */}
      <div className={`w-20 h-20 rounded-full ${iconBgClass(plan.color)} flex items-center justify-center mx-auto`}>
        <svg className={`w-10 h-10 ${iconColorClass(plan.color)}`} viewBox="0 0 24 24"
             fill="none" stroke="currentColor" strokeWidth="2.5"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h1 className="text-2xl font-black text-navy-700">{plan.headline}</h1>

      <p className="text-slate-500 text-sm leading-relaxed">
        Welcome to{' '}
        <span className={`font-bold ${labelColorClass(plan.color)}`}>{plan.label}</span>.
        {' '}{plan.intro}
      </p>

      {/* Pro features */}
      <ul className="text-left space-y-2">
        {plan.perks.map((perk) => (
          <li key={perk} className="text-sm text-slate-700 leading-snug">{perk}</li>
        ))}
      </ul>

      {/* Lifetime exclusives — visually distinct section */}
      {exclusives && (
        <>
          <div className="flex items-center gap-2 py-1">
            <div className="flex-1 border-t border-teal-200" />
            <span className="text-[10px] font-black text-teal-600 uppercase tracking-widest whitespace-nowrap">
              {t.pricing.lifetimeExclusives}
            </span>
            <div className="flex-1 border-t border-teal-200" />
          </div>
          <ul className="text-left space-y-2">
            {exclusives.map((perk) => (
              <li key={perk} className="text-sm text-teal-700 font-semibold leading-snug">{perk}</li>
            ))}
          </ul>
        </>
      )}

      {/* Getaway promo — Lifetime buyers choose their complimentary getaway.
          Always shown for lifetime; the picker handles the brief post-purchase
          window gracefully (the grant webhook is async) with a retry message. */}
      {billing === 'lifetime' && getawayPromoActive() && lifetimeConfirmedForGetaway && <GetawayDestinationPicker />}

      {sessionId && (
        <p className="text-[11px] text-slate-300 font-mono break-all">
          Ref: {sessionId.slice(-12)}
        </p>
      )}

      {/* GasCaptains™ community invite — Pro only */}
      {tier !== 'fleet' && (
        <a
          href={process.env.NEXT_PUBLIC_GASCAPTAINS_URL ?? 'https://www.facebook.com/groups/gascaptains'}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-2xl border-2 border-[#1EB68F] bg-[#f0fdf9] px-4 py-3.5
                     text-left hover:bg-[#e6faf5] transition-colors"
        >
          <p className="text-[10px] font-black uppercase tracking-widest text-[#1EB68F] mb-0.5">
            🏴 Members Only
          </p>
          <p className="text-sm font-black text-[#005F4A] leading-tight">
            Join GasCaptains™ →
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
            The official private community for GasCap™ Pro members.
          </p>
        </a>
      )}

      {ready ? (
        <button
          onClick={() => router.push('/')}
          className={`block w-full py-3.5 rounded-2xl font-black text-base transition-colors text-center ${ctaClass(plan.color)}`}
        >
          {t.upgrade.goToCalculator}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity=".25"/>
              <path d="M21 12a9 9 0 00-9-9" />
            </svg>
            {t.upgrade.activatingAccount}
          </div>
          {/* Always allow leaving — never trap the user behind the spinner */}
          <button onClick={() => router.push('/')}
            className="block w-full py-3 rounded-2xl border-2 border-slate-200 text-sm font-bold
                       text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors">
            {t.upgrade.backToApp}
          </button>
        </div>
      )}
    </div>
  );
}

export default function UpgradeSuccessPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col items-center justify-center px-4">
      <Suspense fallback={
        <div className="bg-white rounded-3xl shadow-card p-8 max-w-sm w-full text-center">
          <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-amber-400 animate-spin" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity=".25"/>
              <path d="M21 12a9 9 0 00-9-9" />
            </svg>
          </div>
          <p className="text-slate-400 text-sm">Loading…</p>
        </div>
      }>
        <SuccessContent />
      </Suspense>
    </div>
  );
}

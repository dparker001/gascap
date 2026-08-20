/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout Session for upgrading to Pro, or adding Lifetime Perks.
 * Body: { tier?: 'pro', billing?: 'monthly' | 'annual' | 'lifetime' | 'lifetime-perks' }
 * 'annual' is accepted for type/legacy compat only — always rejected below (see block).
 * Fleet is shelved — any other tier value is rejected (see validation block).
 *
 * Lifetime uses mode:'payment' (one-time); all others use mode:'subscription'.
 *
 * Stripe Payment Authorization Hardening — the Price ID for every session
 * created here is ALWAYS the server's own canonical PRICES lookup. There is
 * no caller-supplied price override: a prior legacy `body.priceId` escape
 * hatch let a caller redirect a genuine tier/billing selection to an
 * arbitrary Stripe Price, which checkout.session.completed would then grant
 * entitlement for based on request-echoed metadata alone. No first-party
 * caller (app/upgrade, app/settings) ever sent priceId — see the hardening
 * report for the full caller inventory. The webhook additionally verifies
 * the actual purchased Price server-side before granting anything; this
 * checkout-side removal is defense-in-depth, not the only guard.
 */
import { NextResponse }    from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }     from '@/lib/auth';
import { findById }        from '@/lib/users';
import { stripe, PRICES }  from '@/lib/stripe';
import { getBaseUrl }      from '@/lib/getBaseUrl';
import { newMemberOfferStatus, NEW_MEMBER_LIFETIME_COUPON } from '@/lib/newMemberOffer';
import { winbackOfferAvailable, WINBACK_LIFETIME_COUPON } from '@/lib/winbackOffer';
import { foundingStatus, FOUNDING_LIFETIME_COUPON } from '@/lib/foundingPromo';
import { recordAnalyticsEvent } from '@/lib/analyticsEvents';

export async function POST(req: Request) {
  if (!stripe) {
    return NextResponse.json(
      { error: 'Stripe is not configured. Add STRIPE_SECRET_KEY to .env.local.' },
      { status: 503 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Sign in to upgrade.' }, { status: 401 });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = await findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  // NOTE: We intentionally do NOT gate checkout on email verification. Most
  // sign-ups never click the verification link, and a hard block here silently
  // killed conversions (a ready-to-pay user hit a 403 dead-end). Stripe collects
  // and verifies the buyer's email at checkout and sends its own receipts, so a
  // deliverable address is guaranteed regardless of our app-side verified flag.

  // Deliberately untyped-union here — a TypeScript cast on the request body
  // is not runtime validation (Stripe Payment Authorization Hardening).
  // `tier`/`billing` are runtime-checked against an explicit allowlist
  // below before anything derived from them can reach Stripe. No
  // `priceId` field exists in this contract — Price selection is entirely
  // server-owned (see file header).
  const body = await req.json() as {
    tier?:    string;
    billing?: string;
    newMemberOffer?: boolean; // request the 7-day new-member Lifetime discount
    winbackOffer?:   boolean; // request the win-back Lifetime discount ($9.99)
    foundingOffer?:  boolean; // request the Founding Member launch discount ($9.99)
  };

  const tier    = body.tier    ?? 'pro';
  const billing = body.billing ?? 'monthly';

  // Stripe Payment Authorization Hardening — there is no caller-supplied
  // Coupon ID contract at all. A coupon is only ever set below, from a
  // server-validated offer flag (newMemberOffer/winbackOffer/foundingOffer),
  // never from a raw client-named coupon string. (A prior `body.coupon`
  // allowlist for a single campaign coupon, C4/LIFETIME19, was removed
  // 2026-08-20 — that coupon never existed in Stripe, so the path was dead
  // and, worse, could 500 a real checkout if reached. See git history for
  // the removed code if this is ever revisited.)
  let coupon: string | null = null;

  // Annual is no longer offered — Lifetime ($19.99 one-time) was strictly cheaper
  // AND better (forever access, more giveaway entries, the vacation getaway) than
  // Annual ($26.99/yr), so there was never a rational reason to buy it. Blocked
  // explicitly (rather than silently falling through) so a stale cached client
  // can't still create one. Zero existing Annual subscribers as of 2026-07-23, so
  // this affects no one. See lib/stripe.ts for the shelved price ID.
  if (billing === 'annual') {
    return NextResponse.json(
      { error: 'Annual billing is no longer offered. Choose Monthly or Lifetime instead.' },
      { status: 400 },
    );
  }

  // Stripe Payment Authorization Hardening — explicit runtime allowlist.
  // Fleet is shelved (no canonical Price exists for it) and must never be
  // reachable again via a caller-supplied tier, and an unrecognized billing
  // string must never silently fall through to Pro Monthly (the previous
  // `if (!priceId) { ... else priceId = PRICES.proMonthly }` shape made
  // exactly that mistake possible). Anything outside this allowlist is a
  // deterministic 400, not a guess.
  const SUPPORTED_BILLING = ['monthly', 'lifetime', 'lifetime-perks'] as const;
  type SupportedBilling = typeof SUPPORTED_BILLING[number];
  if (tier !== 'pro' || !SUPPORTED_BILLING.includes(billing as SupportedBilling)) {
    return NextResponse.json(
      { error: `Unsupported plan selection. Choose Pro Monthly, Pro Lifetime, or Lifetime Perks.` },
      { status: 400 },
    );
  }
  const validatedBilling = billing as SupportedBilling;

  // Tags which campaign the coupon came from — the founding, win-back, and
  // new-member offers all currently share the same Stripe coupon ID, so this is
  // the only way to attribute a purchase to a specific campaign after the fact.
  let   offerSource: 'founding' | 'winback' | 'new_member' | null = null;

  // New-member 7-day Lifetime discount ($5 off). Server-validates eligibility
  // (createdAt within 7 days, not already Lifetime) so the discount can't be
  // claimed by a copied link or an ineligible account.
  if (body.newMemberOffer && billing === 'lifetime' && newMemberOfferStatus(user).eligible) {
    coupon = NEW_MEMBER_LIFETIME_COUPON;
    offerSource = 'new_member';
  }

  // Win-back $9.99 Lifetime — only for lapsed free users (expired trial). Like
  // the new-member offer, eligibility is re-validated server-side so the deal
  // can't be claimed via a copied /upgrade?wb=1 link by an ineligible account.
  if (body.winbackOffer && billing === 'lifetime' && winbackOfferAvailable(user)) {
    coupon = WINBACK_LIFETIME_COUPON;
    offerSource = 'winback';
  }

  // Founding Member launch promo — $9.99 Lifetime for any non-Lifetime account while
  // the promo is active (spots remain). This is the reactivation-campaign path: it
  // covers trial users and lapsed users who fall outside the 7-day new-member window.
  // Re-validated server-side (promo active) so a copied /upgrade?founding=1 link
  // can't outlive the launch.
  if (body.foundingOffer && billing === 'lifetime' && user.stripeInterval !== 'lifetime') {
    const { active } = await foundingStatus();
    if (active) { coupon = FOUNDING_LIFETIME_COUPON; offerSource = 'founding'; }
  }

  // ── Lifetime Perks add-on ─────────────────────────────────────────────────
  // Only available to existing Pro Lifetime Membership holders.
  if (billing === 'lifetime-perks') {
    if (user.stripeInterval !== 'lifetime') {
      return NextResponse.json(
        { error: 'Lifetime Perks are only available to Pro Lifetime Membership holders.' },
        { status: 403 },
      );
    }
    const perksPrice = PRICES.lifetimePerks;
    if (!perksPrice) {
      return NextResponse.json(
        { error: 'Lifetime Perks price not configured. Add STRIPE_PRICE_LIFETIME_PERKS to env.' },
        { status: 503 },
      );
    }
    const origin = getBaseUrl(req);
    const perksSession = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      allow_promotion_codes: false,
      phone_number_collection: { enabled: false },
      line_items:  [{ price: perksPrice, quantity: 1 }],
      customer_email: user.stripeCustomerId ? undefined : user.email,
      customer:       user.stripeCustomerId ?? undefined,
      success_url: `${origin}/upgrade/success?session_id={CHECKOUT_SESSION_ID}&tier=pro&billing=lifetime-perks`,
      cancel_url:  `${origin}/upgrade`,
      metadata: { userId, userEmail: user.email, tier: 'pro', billing: 'lifetime-perks' },
      subscription_data: { metadata: { userId, tier: 'pro', billing: 'lifetime-perks' } },
    });
    return NextResponse.json({ url: perksSession.url });
  }

  // Resolve price ID — server-owned only. `validatedBilling` is narrowed to
  // 'monthly' | 'lifetime' at this point ('lifetime-perks' already returned
  // above, 'annual' already rejected above), so this is an exhaustive
  // two-way canonical lookup with no caller-influenced fallback.
  const priceId = validatedBilling === 'lifetime' ? PRICES.proLifetime : PRICES.proMonthly;

  if (!priceId) {
    return NextResponse.json(
      { error: `No price configured for pro/${validatedBilling}. Add the STRIPE_PRICE_* vars to .env.local.` },
      { status: 503 },
    );
  }

  const origin = getBaseUrl(req);

  // Fleet is shelved (rejected above, before this point is ever reached) —
  // no trial-carryover logic is needed here anymore.

  const isLifetime = validatedBilling === 'lifetime';

  const checkoutSession = await stripe.checkout.sessions.create({
    // One-time payment for lifetime; recurring subscription for monthly
    mode:                 isLifetime ? 'payment' : 'subscription',
    payment_method_types: ['card'],
    // Coupon / promo codes
    ...(coupon
      ? { discounts: [{ coupon }] }
      : { allow_promotion_codes: true }),
    phone_number_collection: { enabled: true },
    line_items:  [{ price: priceId, quantity: 1 }],
    customer_email: user.stripeCustomerId ? undefined : user.email,
    customer:       user.stripeCustomerId ?? undefined,
    success_url: `${origin}/upgrade/success?session_id={CHECKOUT_SESSION_ID}&tier=pro&billing=${validatedBilling}`,
    cancel_url:  `${origin}/upgrade`,
    metadata: {
      userId,
      userEmail: user.email,
      tier: 'pro',
      billing: validatedBilling,
      ...(offerSource ? { offerSource } : {}),
    },
    // subscription_data only valid for mode:'subscription'
    ...(!isLifetime ? {
      subscription_data: {
        metadata: { userId, tier: 'pro' },
      },
    } : {
      // payment_intent_data carries metadata for one-time payments
      payment_intent_data: {
        metadata: { userId, tier: 'pro', billing: validatedBilling, ...(offerSource ? { offerSource } : {}) },
      },
    }),
  });

  // Growth Sprint 1, P0C-1B — checkout_started fires only for a genuine
  // canonical Pro Monthly or Pro Lifetime checkout, only after the real
  // Stripe Checkout Session above has been created. `tier`/`validatedBilling`
  // are already runtime-validated and `priceId` is already server-owned
  // (Stripe Payment Authorization Hardening — see file header; there is no
  // caller-supplied priceId contract to re-derive from anymore). The
  // `priceId === PRICES.x` equality check below is kept anyway as
  // defense-in-depth: it costs nothing and means this classifier stays
  // correct even if the price-resolution logic above it ever changes
  // shape. This is an analytics-purity check only — it never affects
  // whether checkout itself succeeds.
  const analyticsBilling =
    validatedBilling === 'monthly'  && priceId === PRICES.proMonthly  ? 'monthly' :
    validatedBilling === 'lifetime' && priceId === PRICES.proLifetime ? 'lifetime' :
    null;

  if (analyticsBilling) {
    try {
      await recordAnalyticsEvent({
        eventType:      'checkout_started',
        originPlatform: 'web',
        emitter:        'server',
        userId,
        provider:       'stripe',
        billing:        analyticsBilling,
        source:         'stripe_checkout',
        idempotencyKey: `checkout_started:stripe:${checkoutSession.id}`,
        ...(offerSource ? { metadata: { offerSource } } : {}),
      });
    } catch (e) { console.error('[GasCap analytics] checkout_started write failed:', e); }
  }

  return NextResponse.json({ url: checkoutSession.url });
}

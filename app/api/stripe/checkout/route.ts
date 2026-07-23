/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout Session for upgrading to Pro or Fleet, or adding Lifetime Perks.
 * Body: { tier: 'pro' | 'fleet', billing: 'monthly' | 'annual' | 'lifetime' | 'lifetime-perks' }
 * 'annual' is accepted for type/legacy compat only — always rejected below (see block).
 *
 * Lifetime uses mode:'payment' (one-time); all others use mode:'subscription'.
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

  const body = await req.json() as {
    tier?:    'pro' | 'fleet';
    billing?: 'monthly' | 'annual' | 'lifetime' | 'lifetime-perks';
    priceId?: string; // legacy direct price ID override
    coupon?:  string; // Stripe coupon ID to pre-apply (e.g. from C4 promo email)
    newMemberOffer?: boolean; // request the 7-day new-member Lifetime discount
    winbackOffer?:   boolean; // request the win-back Lifetime discount ($9.99)
    foundingOffer?:  boolean; // request the Founding Member launch discount ($9.99)
  };

  const tier    = body.tier    ?? 'pro';
  const billing = body.billing ?? 'monthly';
  let   coupon  = body.coupon  ?? null;

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

  // Resolve price ID
  let priceId = body.priceId ?? '';
  if (!priceId) {
    if (tier === 'pro') {
      if (billing === 'lifetime') priceId = PRICES.proLifetime;
      else                        priceId = PRICES.proMonthly;
    }
    // Fleet plan is shelved — no active price IDs
  }

  if (!priceId) {
    return NextResponse.json(
      { error: `No price configured for ${tier}/${billing}. Add the STRIPE_PRICE_* vars to .env.local.` },
      { status: 503 },
    );
  }

  const origin = getBaseUrl(req);

  // ── Fleet trial days ──────────────────────────────────────────────────────
  // • If the user is on an active pro trial and hasn't paid for anything yet,
  //   carry those remaining days over as the fleet trial so upgrading mid-trial
  //   doesn't forfeit the free period.
  // • If they have no subscription at all (brand-new or expired-trial free user),
  //   give them a 14-day fleet trial.
  // • Paid pro subscribers upgrading to fleet get no trial — Stripe prorates
  //   the current billing period automatically.
  let trialDays = 0;
  if (tier === 'fleet') {
    const hasTrial     = user.isProTrial && !!user.trialExpiresAt;
    const hasActiveSub = !!user.stripeSubscriptionId;

    if (hasTrial && !hasActiveSub) {
      // Carry over remaining pro-trial days (floor to whole days, min 1)
      const remainingMs = new Date(user.trialExpiresAt!).getTime() - Date.now();
      trialDays = Math.max(1, Math.floor(remainingMs / 86_400_000));
    } else if (!hasActiveSub) {
      // No prior trial and no paid sub → fresh 14-day fleet trial
      trialDays = 14;
    }
    // hasActiveSub (paid pro) → trialDays stays 0; Stripe handles proration
  }

  const isLifetime = billing === 'lifetime';

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
    success_url: `${origin}/upgrade/success?session_id={CHECKOUT_SESSION_ID}&tier=${tier}&billing=${billing}`,
    cancel_url:  `${origin}/upgrade`,
    metadata: {
      userId,
      userEmail: user.email,
      tier,
      billing,
      ...(offerSource ? { offerSource } : {}),
    },
    // subscription_data only valid for mode:'subscription'
    ...(!isLifetime ? {
      subscription_data: {
        metadata: { userId, tier },
        ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
      },
    } : {
      // payment_intent_data carries metadata for one-time payments
      payment_intent_data: {
        metadata: { userId, tier, billing, ...(offerSource ? { offerSource } : {}) },
      },
    }),
  });

  return NextResponse.json({ url: checkoutSession.url });
}

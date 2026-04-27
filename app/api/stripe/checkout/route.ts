/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout Session for upgrading to Pro or Fleet.
 * Body: { tier: 'pro' | 'fleet', billing: 'monthly' | 'annual' }
 */
import { NextResponse }    from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }     from '@/lib/auth';
import { findById }        from '@/lib/users';
import { stripe, PRICES }  from '@/lib/stripe';
import { getBaseUrl }      from '@/lib/getBaseUrl';

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

  // Require email verification before allowing upgrade to paid plan.
  // This ensures billing receipts and subscription emails reach the user.
  if (!user.emailVerified) {
    return NextResponse.json(
      { error: 'Please verify your email address before upgrading. Check your inbox for a verification link.' },
      { status: 403 },
    );
  }

  const body = await req.json() as {
    tier?:    'pro' | 'fleet';
    billing?: 'monthly' | 'annual';
    priceId?: string; // legacy direct price ID override
  };

  const tier    = body.tier    ?? 'pro';
  const billing = body.billing ?? 'monthly';

  // Resolve price ID
  let priceId = body.priceId ?? '';
  if (!priceId) {
    if (tier === 'pro')   priceId = billing === 'annual' ? PRICES.proAnnual    : PRICES.proMonthly;
    if (tier === 'fleet') priceId = billing === 'annual' ? PRICES.fleetAnnual  : PRICES.fleetMonthly;
  }

  if (!priceId) {
    return NextResponse.json(
      { error: `No price configured for ${tier}/${billing}. Add the STRIPE_PRICE_* vars to .env.local.` },
      { status: 503 },
    );
  }

  const origin = getBaseUrl(req);

  // ── Fleet trial days ──────────────────────────────────────────────────────
  // • If the user is on an active pro trial (isProTrial/isBetaTester) and hasn't
  //   paid for anything yet, carry those remaining days over as the fleet trial.
  //   This means upgrading mid-trial doesn't forfeit the free period.
  // • If they have no subscription at all (brand-new or expired-trial free user),
  //   give them a 14-day fleet trial.
  // • Paid pro subscribers upgrading to fleet get no trial — Stripe prorates
  //   the current billing period automatically.
  let trialDays = 0;
  if (tier === 'fleet') {
    const hasTrial     = (user.isProTrial || user.isBetaTester) && !!user.betaProExpiry;
    const hasActiveSub = !!user.stripeSubscriptionId;

    if (hasTrial && !hasActiveSub) {
      // Carry over remaining pro-trial days (floor to whole days, min 1)
      const remainingMs = new Date(user.betaProExpiry!).getTime() - Date.now();
      trialDays = Math.max(1, Math.floor(remainingMs / 86_400_000));
    } else if (!hasActiveSub) {
      // No prior trial and no paid sub → fresh 14-day fleet trial
      trialDays = 14;
    }
    // hasActiveSub (paid pro) → trialDays stays 0; Stripe handles proration
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode:                    'subscription',
    payment_method_types:    ['card'],
    allow_promotion_codes:   true,
    line_items:              [{ price: priceId, quantity: 1 }],
    customer_email:          user.stripeCustomerId ? undefined : user.email,
    customer:                user.stripeCustomerId ?? undefined,
    success_url:             `${origin}/upgrade/success?session_id={CHECKOUT_SESSION_ID}&tier=${tier}`,
    cancel_url:              `${origin}/upgrade`,
    metadata: {
      userId,
      userEmail: user.email,
      tier,
      billing,
    },
    subscription_data: {
      metadata:                    { userId, tier },
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
    },
  });

  return NextResponse.json({ url: checkoutSession.url });
}

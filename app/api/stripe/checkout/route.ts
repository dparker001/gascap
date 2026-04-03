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
  const user   = findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

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
      metadata: { userId, tier },
    },
  });

  return NextResponse.json({ url: checkoutSession.url });
}

/**
 * POST /api/stripe/webhook
 * Receives Stripe webhook events and keeps user plan in sync.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET  (from `stripe listen` or Dashboard endpoint)
 */
import { NextResponse }                     from 'next/server';
import type Stripe                          from 'stripe';
import { stripe }                           from '@/lib/stripe';
import { setUserPlan, findByStripeCustomer, findById } from '@/lib/users';

// Next.js App Router reads the raw body via req.text() — no body-parser config needed

export async function POST(req: Request) {
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured.' }, { status: 503 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[GasCap webhook] STRIPE_WEBHOOK_SECRET not set');
    return NextResponse.json({ error: 'Webhook secret missing.' }, { status: 500 });
  }

  const sig  = req.headers.get('stripe-signature') ?? '';
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error('[GasCap webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  // ── Handle events ────────────────────────────────────────────────────────

  switch (event.type) {

    // Checkout completed → activate Pro
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId  = session.metadata?.userId;
      if (!userId) break;

      const customerId     = typeof session.customer     === 'string' ? session.customer     : null;
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
      const tier           = (session.metadata?.tier ?? 'pro') as 'pro' | 'fleet';

      setUserPlan(userId, tier, {
        customerId:     customerId     ?? undefined,
        subscriptionId: subscriptionId ?? undefined,
      });

      console.info(`[GasCap webhook] Upgraded user ${userId} to ${tier}`);
      break;
    }

    // Invoice paid → ensure plan stays active (handles renewals)
    case 'invoice.payment_succeeded': {
      const invoice    = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
      if (!customerId) break;

      const user = findByStripeCustomer(customerId);
      if (!user) break;

      // Determine tier from subscription metadata; fall back to existing plan if already paid
      const subId = typeof invoice.subscription === 'string' ? invoice.subscription : undefined;
      let tier: 'pro' | 'fleet' = user.plan === 'fleet' ? 'fleet' : 'pro';

      // If we have a subscription ID, fetch it to read the price metadata tier
      if (stripe && subId && tier === 'pro') {
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          const priceId = sub.items.data[0]?.price?.id ?? '';
          const fleetPrices = [
            process.env.STRIPE_PRICE_FLEET_MONTHLY ?? '',
            process.env.STRIPE_PRICE_FLEET_ANNUAL  ?? '',
          ].filter(Boolean);
          if (fleetPrices.includes(priceId)) tier = 'fleet';
        } catch { /* non-fatal: keep existing tier */ }
      }

      if (user.plan !== tier) {
        setUserPlan(user.id, tier, { subscriptionId: subId });
        console.info(`[GasCap webhook] Activated ${tier} for user ${user.id} on renewal`);
      }
      break;
    }

    // Subscription cancelled / payment failed → revert to free
    case 'customer.subscription.deleted':
    case 'invoice.payment_failed': {
      const obj        = event.data.object as Stripe.Subscription | Stripe.Invoice;
      const customerId = typeof obj.customer === 'string' ? obj.customer : null;
      if (!customerId) break;

      const user = findByStripeCustomer(customerId);
      if (user) {
        setUserPlan(user.id, 'free');
        console.info(`[GasCap webhook] Reverted user ${user.id} to Free (${event.type})`);
      }
      break;
    }

    // Customer portal session: sync updated customer ID if needed
    case 'customer.updated': {
      const customer = event.data.object as Stripe.Customer;
      const userId   = (customer.metadata as Record<string,string>)?.userId;
      if (userId) {
        const user = findById(userId);
        if (user) setUserPlan(userId, user.plan, { customerId: customer.id });
      }
      break;
    }

    default:
      // Unhandled — Stripe expects a 200 so it doesn't retry
      break;
  }

  return NextResponse.json({ received: true });
}

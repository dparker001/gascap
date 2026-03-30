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
import { updateGhlContactPlan }            from '@/lib/ghl';
import { sendMail }                        from '@/lib/email';

/** Fire-and-forget admin notification */
function sendAdminMail(opts: { subject: string; html: string; text: string }) {
  sendMail({ to: 'hello@gascap.app', ...opts })
    .catch((e) => console.error('[GasCap] Admin notify failed:', e));
}

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

      // Sync plan change to GHL CRM + notify admin
      const upgradedUser = findById(userId);
      if (upgradedUser) {
        updateGhlContactPlan(upgradedUser.email, tier)
          .catch((err) => console.error('[GHL] plan sync failed:', err));

        const tierLabel = tier === 'fleet' ? 'Fleet ($19.99/mo)' : 'Pro ($4.99/mo)';
        sendAdminMail({
          subject: `⬆️ GasCap™ upgrade: ${upgradedUser.name} → ${tier.toUpperCase()}`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
            <p style="font-size:22px;margin:0 0 8px;">⬆️ Plan upgrade</p>
            <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${upgradedUser.name}</strong> upgraded to <strong>${tierLabel}</strong></p>
            <p style="font-size:14px;color:#64748b;margin:0 0 16px;">${upgradedUser.email}</p>
            <p style="font-size:12px;color:#94a3b8;">${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET</p>
          </div>`,
          text: `GasCap upgrade: ${upgradedUser.name} <${upgradedUser.email}> → ${tierLabel}`,
        });
      }

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
        updateGhlContactPlan(user.email, 'free')
          .catch((err) => console.error('[GHL] plan revert sync failed:', err));

        sendAdminMail({
          subject: `📉 GasCap™ cancellation: ${user.name} → Free`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
            <p style="font-size:22px;margin:0 0 8px;">📉 Subscription ended</p>
            <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${user.name}</strong> reverted to Free</p>
            <p style="font-size:14px;color:#64748b;margin:0 0 16px;">${user.email}</p>
            <p style="font-size:12px;color:#94a3b8;">Event: ${event.type} · ${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET</p>
          </div>`,
          text: `GasCap cancellation: ${user.name} <${user.email}> reverted to Free (${event.type})`,
        });

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

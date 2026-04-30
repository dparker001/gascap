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
import { setUserPlan, findByStripeCustomer, findById, findByReferralCode, creditVerifiedReferral, getActiveCredits, enrollPaidCampaign, enrollEngagementCampaign, setEarlyUpgradeBonus, markMilestoneSent } from '@/lib/users';
import { updateGhlContactPlan }            from '@/lib/ghl';
import { sendMail }                        from '@/lib/email';
import { sendReferralCreditEmail }         from '@/lib/emailCampaign';
import { sendPaidCampaignEmail }           from '@/lib/emailCampaignPaid';
import { sendMilestoneEmail }              from '@/lib/emailEngagement';
import { PRICES }                          from '@/lib/stripe';

/** Fire-and-forget admin notification */
function sendAdminMail(opts: { subject: string; html: string; text: string }) {
  sendMail({ to: 'info@gascap.app', ...opts })
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

      await setUserPlan(userId, tier, {
        customerId:     customerId     ?? undefined,
        subscriptionId: subscriptionId ?? undefined,
      });

      // Sync plan change to GHL CRM + notify admin
      const upgradedUser = await findById(userId);
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

        // ── P1: Upgrade confirmation email ──────────────────────────────────
        // Determine billing interval from the checkout session billing param
        // (stored in metadata) or fall back to price ID matching.
        const billingMeta = session.metadata?.billing as string | undefined;
        let interval: 'monthly' | 'annual' = 'monthly';
        if (billingMeta === 'annual') {
          interval = 'annual';
        } else {
          const annualPrices = [PRICES.proAnnual, PRICES.fleetAnnual].filter(Boolean);
          if (subscriptionId && stripe) {
            try {
              const sub     = await stripe.subscriptions.retrieve(subscriptionId);
              const priceId = sub.items.data[0]?.price?.id ?? '';
              if (annualPrices.includes(priceId)) interval = 'annual';
            } catch { /* non-fatal: default stays monthly */ }
          }
        }

        // Credit early-upgrade bonus if they were on a Pro trial at upgrade time
        if (upgradedUser.isProTrial) {
          await setEarlyUpgradeBonus(userId, 10);
        }

        // Only enroll if not already in the paid campaign (idempotent guard)
        if (!upgradedUser.paidCampaignEnrolledAt) {
          await enrollPaidCampaign(userId, interval);
        }

        if (!upgradedUser.engagementEnrolledAt) {
          await enrollEngagementCampaign(upgradedUser.id, tier === 'fleet' ? 'fleet' : 'pro');
        }

        sendPaidCampaignEmail('P1', {
          id:       upgradedUser.id,
          name:     upgradedUser.name,
          email:    upgradedUser.email,
          tier,
          interval,
        }).catch((err) => console.error('[paid-campaign] P1 send failed:', err));
      }

      console.info(`[GasCap webhook] Upgraded user ${userId} to ${tier}`);
      break;
    }

    // Invoice paid → ensure plan stays active (handles renewals)
    case 'invoice.payment_succeeded': {
      const invoice    = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
      if (!customerId) break;

      const user = await findByStripeCustomer(customerId);
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
        await setUserPlan(user.id, tier, { subscriptionId: subId });
        console.info(`[GasCap webhook] Activated ${tier} for user ${user.id} on renewal`);
      }

      // ── Referral credit — fires on first real payment only ────────────────
      // Conditions: amount_paid > 0, referredBy is set, not yet credited.
      // Free trial sign-ups do NOT earn a referral credit; only paying
      // conversions count. This is the ONLY place creditVerifiedReferral fires.
      if (
        invoice.amount_paid > 0 &&
        user.referredBy &&
        !user.referralRewardCredited
      ) {
        const credited = await creditVerifiedReferral(user.id);
        if (credited && user.referredBy) {
          // Look up the referrer to send them a notification
          const referrer = await findByReferralCode(user.referredBy);
          if (referrer && !referrer.isTestAccount) {
            // Re-fetch to get the updated credit count after recording
            const fresh = await findById(referrer.id);
            const totalCredits = fresh ? getActiveCredits(fresh).length : 1;
            sendReferralCreditEmail(
              referrer.id,
              referrer.email,
              referrer.name,
              totalCredits,
            ).catch((e) => console.error('[GasCap] Referral credit email failed:', e));
            console.info(`[GasCap webhook] Referral credit awarded to ${referrer.email} (${totalCredits} total)`);

            // M3 — first referral milestone email (fires once when referrer hits
            // their very first paying referral)
            if (fresh && !fresh.milestoneReferral1Sent && (fresh.referralCount ?? 0) >= 1) {
              sendMilestoneEmail('referral1', {
                id:    fresh.id,
                name:  fresh.name,
                email: fresh.email,
                plan:  fresh.plan,
              }).catch((e) => console.error('[GasCap] M3 milestone email failed:', e));
              markMilestoneSent(fresh.id, 'referral1')
                .catch((e) => console.error('[GasCap] M3 milestone mark failed:', e));
            }
          }
        }
      }
      break;
    }

    // Subscription cancelled / payment failed → revert to free
    case 'customer.subscription.deleted':
    case 'invoice.payment_failed': {
      const obj        = event.data.object as Stripe.Subscription | Stripe.Invoice;
      const customerId = typeof obj.customer === 'string' ? obj.customer : null;
      if (!customerId) break;

      const user = await findByStripeCustomer(customerId);
      if (user) {
        await setUserPlan(user.id, 'free');
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

        // ── P5: Win-back email — only on hard cancellation (not payment failure)
        // We skip this for invoice.payment_failed because that's a dunning scenario
        // (card declined), not a deliberate cancellation — different message needed.
        if (event.type === 'customer.subscription.deleted' && !user.emailOptOut) {
          sendPaidCampaignEmail('P5', {
            id:       user.id,
            name:     user.name,
            email:    user.email,
            tier:     'pro', // already reverted; tier label is cosmetic
            interval: (user.stripeInterval ?? 'monthly') as 'monthly' | 'annual',
          }).catch((err) => console.error('[paid-campaign] P5 send failed:', err));
        }

        console.info(`[GasCap webhook] Reverted user ${user.id} to Free (${event.type})`);
      }
      break;
    }

    // Customer portal session: sync updated customer ID if needed
    case 'customer.updated': {
      const customer = event.data.object as Stripe.Customer;
      const userId   = (customer.metadata as Record<string,string>)?.userId;
      if (userId) {
        const user = await findById(userId);
        if (user) await setUserPlan(userId, user.plan, { customerId: customer.id });
      }
      break;
    }

    // Chargeback opened — alert admin immediately so the account can be reviewed.
    // We do NOT auto-revoke referral credits here: disputes can be won, and
    // revoking prematurely would punish legitimate referrers. Admin investigates
    // and acts manually if the dispute is confirmed fraudulent.
    case 'charge.dispute.created': {
      const dispute  = event.data.object as Stripe.Dispute;
      const amount   = `$${(dispute.amount / 100).toFixed(2)}`;
      const reason   = dispute.reason ?? 'unknown';

      // Dispute has charge (not customer) — fetch the charge to get customer ID
      const chargeId   = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
      let customerId: string | null = null;
      if (stripe && chargeId) {
        try {
          const charge = await stripe.charges.retrieve(chargeId);
          customerId = typeof charge.customer === 'string' ? charge.customer : null;
        } catch { /* non-fatal */ }
      }

      const disputedUser = customerId ? await findByStripeCustomer(customerId) : null;
      const nameLabel    = disputedUser ? `${disputedUser.name} (${disputedUser.email})` : customerId ?? 'unknown';
      const hadReferral  = disputedUser?.referralRewardCredited ? ' — ⚠️ referral credit was already awarded' : '';

      sendAdminMail({
        subject: `🚨 Stripe dispute: ${nameLabel} — ${amount}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
          <p style="font-size:22px;margin:0 0 8px;">🚨 Chargeback opened</p>
          <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${nameLabel}</strong></p>
          <p style="font-size:14px;color:#64748b;margin:0 0 4px;">Amount disputed: <strong>${amount}</strong></p>
          <p style="font-size:14px;color:#64748b;margin:0 0 4px;">Reason: <strong>${reason}</strong></p>
          <p style="font-size:14px;color:#64748b;margin:0 0 16px;">Dispute ID: ${dispute.id}</p>
          ${hadReferral ? `<p style="font-size:13px;color:#dc2626;font-weight:700;margin:0 0 12px;">⚠️ This user had a referral credit awarded. Review whether to revoke it.</p>` : ''}
          <p style="font-size:12px;color:#94a3b8;">${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</p>
        </div>`,
        text: `GasCap chargeback: ${nameLabel} — ${amount} (${reason}) · Dispute ID: ${dispute.id}${hadReferral}`,
      });

      console.warn(`[GasCap webhook] Dispute created — ${nameLabel} — ${amount} (${reason})`);
      break;
    }

    default:
      // Unhandled — Stripe expects a 200 so it doesn't retry
      break;
  }

  return NextResponse.json({ received: true });
}

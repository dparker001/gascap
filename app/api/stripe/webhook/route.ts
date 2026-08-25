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
import { setUserPlan, findByStripeCustomer, findById, findByReferralCode, creditVerifiedReferral, getActiveCredits, enrollPaidCampaign, enrollEngagementCampaign, setEarlyUpgradeBonus, markMilestoneSent, updateUserProfile, clearStripeSubscriptionId, setLifetimePerksActive, clearLifetimePerks, markFoundingMember, revokeStripeSubscriptionEntitlement, bindStripeCustomerIdIfMissing } from '@/lib/users';
import { updateGhlContactPlan }            from '@/lib/ghl';
import { recordAnalyticsEvent }            from '@/lib/analyticsEvents';
import { sendMail, giftEmailHtml }         from '@/lib/email';
import { createGift }                      from '@/lib/gifts';
import { getawayPromoActive, GETAWAY_DISCLOSURE } from '@/lib/getawayPromo';
import { stampGetawayHoldUntil } from '@/lib/getawayFulfillment';
import { sendReferralCreditEmail }         from '@/lib/emailCampaign';
import { sendPaidCampaignEmail }           from '@/lib/emailCampaignPaid';
import { sendMilestoneEmail }              from '@/lib/emailEngagement';
import { sendUserPush }                    from '@/lib/userPush';
import { PRICES }                          from '@/lib/stripe';

/** Fire-and-forget admin notification */
function sendAdminMail(opts: { subject: string; html: string; text: string }) {
  sendMail({ to: 'info@gascap.app', ...opts })
    .catch((e) => console.error('[GasCap] Admin notify failed:', e));
}

// ── Stripe Payment Authorization Hardening ──────────────────────────────────
// checkout.session.completed previously granted entitlement purely from
// session.metadata (tier/billing) — values that originate from the checkout
// REQUEST, not from what Stripe actually sold. Before any entitlement
// mutation for a normal Pro checkout, independently confirm the actual
// purchased Stripe Price via the Checkout Session's own line items and
// require it to agree with the metadata. A mismatch (or an unrecognized
// Price entirely) is a deterministic rejection, never a "correct and grant
// anyway."
type VerifiedCheckoutOutcome =
  | { kind: 'pro'; billing: 'monthly' | 'lifetime' }
  | { kind: 'lifetime-perks' }
  | { kind: 'rejected'; reason: string }
  /** The Stripe API call itself failed (network/outage/etc) — distinct from
   *  a successful lookup that simply didn't match anything expected. Callers
   *  must fail closed: do NOT treat this the same as a deterministic
   *  mismatch, and do NOT acknowledge the event as handled. */
  | { kind: 'lookup-failed'; error: unknown };

type PurchaseEvidence =
  | { kind: 'ok'; priceId: string }
  /** A deterministic integrity problem with the line-item SHAPE itself
   *  (more than one item, or a quantity other than 1) — distinct from an
   *  unrecognized Price, which verifyCheckoutPurchase() classifies. Not a
   *  lookup failure: Stripe answered fine, the answer is just invalid for
   *  GasCap's one-Price-one-quantity entitlement contract. */
  | { kind: 'rejected'; reason: string }
  /** Provider/API failure OR incomplete evidence (zero line items, or a
   *  line item with no resolvable Price ID) — callers must fail closed:
   *  do not acknowledge the event as processed. */
  | { kind: 'lookup-failed'; error: unknown };

/** Retrieves and validates the actual line-item evidence for a completed
 *  Checkout Session, straight from Stripe — never from metadata. Requires
 *  exactly one line item with quantity 1 and a resolvable Price ID. Using
 *  `limit: 2` (not 1) is deliberate: it's the minimum needed to prove
 *  "exactly one" rather than merely "at least one" — a second item makes
 *  the session invalid for GasCap's simple one-Price entitlement contract
 *  no matter what the first item is, so pagination beyond 2 is never
 *  needed. */
async function getPurchaseEvidence(session: Stripe.Checkout.Session): Promise<PurchaseEvidence> {
  if (!stripe) return { kind: 'lookup-failed', error: new Error('Stripe not configured') };

  let items: Stripe.LineItem[];
  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 });
    items = lineItems.data;
  } catch (err) {
    return { kind: 'lookup-failed', error: err };
  }

  if (items.length === 0) {
    // Incomplete evidence, not proof of anything — treat the same as a
    // provider failure rather than guessing.
    return { kind: 'lookup-failed', error: new Error('Checkout Session returned zero line items') };
  }
  if (items.length > 1) {
    return { kind: 'rejected', reason: 'Checkout Session has more than one line item' };
  }

  const [item] = items;
  const priceId = item.price?.id ?? '';
  if (!priceId) {
    return { kind: 'lookup-failed', error: new Error('Checkout Session line item has no resolvable Price ID') };
  }
  if (item.quantity !== 1) {
    return { kind: 'rejected', reason: 'Checkout Session line item quantity was not exactly 1' };
  }

  return { kind: 'ok', priceId };
}

// Stripe Payment Authorization Hardening — explicit payment_status policy.
// 'paid' and 'no_payment_required' both authorize entitlement:
// 'no_payment_required' covers an intentionally-configured, Stripe
// Dashboard-administered 100%-off Promotion Code entered by the customer at
// Stripe's own hosted checkout (allow_promotion_codes:true) — a deliberate
// product/security policy distinct from the raw-Coupon-ID vulnerability
// closed elsewhere in this hardening pass (a Promotion Code is something
// Stripe itself validates and Stripe itself decides was actually redeemed;
// it is never a value GasCap's API accepts and forwards on the caller's
// say-so). 'unpaid' and any other/unexpected value are NOT authorized —
// fail closed rather than assume a new Stripe status is safe to grant.
function isEntitlementAuthorizedPaymentStatus(status: Stripe.Checkout.Session.PaymentStatus): boolean {
  return status === 'paid' || status === 'no_payment_required';
}

async function verifyCheckoutPurchase(
  session: Stripe.Checkout.Session,
): Promise<VerifiedCheckoutOutcome> {
  const evidence = await getPurchaseEvidence(session);
  if (evidence.kind !== 'ok') return evidence;
  const actualPriceId = evidence.priceId;

  const metaTier    = session.metadata?.tier;
  const metaBilling = session.metadata?.billing;

  if (actualPriceId === PRICES.proMonthly) {
    if (metaTier === 'pro' && metaBilling === 'monthly') return { kind: 'pro', billing: 'monthly' };
    return { kind: 'rejected', reason: 'actual Price was Pro Monthly but metadata did not match' };
  }
  if (actualPriceId === PRICES.proLifetime) {
    if (metaTier === 'pro' && metaBilling === 'lifetime') return { kind: 'pro', billing: 'lifetime' };
    return { kind: 'rejected', reason: 'actual Price was Pro Lifetime but metadata did not match' };
  }
  if (actualPriceId === PRICES.lifetimePerks) {
    if (metaTier === 'pro' && metaBilling === 'lifetime-perks') return { kind: 'lifetime-perks' };
    return { kind: 'rejected', reason: 'actual Price was Lifetime Perks but metadata did not match' };
  }

  return { kind: 'rejected', reason: 'actual Price did not match any canonical GasCap product' };
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

      // ── GIFT purchase branch ───────────────────────────────────────────
      // A gift has no buyer userId — it activates Pro on the RECIPIENT's
      // account later, via a redemption code. Handle it and return early so
      // the normal upgrade logic below never mis-grants the buyer.
      if (session.metadata?.isGift === 'true') {
        // Stripe Payment Authorization Hardening — payment_status policy
        // applies to gift completions too: 'paid' or 'no_payment_required'
        // (an intentional 100%-off Stripe Promotion Code) authorize gift
        // creation; 'unpaid' or anything unexpected does not.
        if (!isEntitlementAuthorizedPaymentStatus(session.payment_status)) {
          console.warn(`[GasCap webhook] Gift completion payment_status not authorized (${session.payment_status}) — no Gift record created.`);
          break;
        }

        // Stripe Payment Authorization Hardening — a gift completion must
        // actually have purchased exactly one canonical Pro Lifetime line
        // item (quantity 1) before a redeemable Gift record is created.
        // A lookup failure OR incomplete evidence fails closed (non-200,
        // Stripe retries); a resolved-but-invalid shape (extra line item,
        // wrong quantity) or wrong Price is a deterministic rejection — no
        // gift code is minted for it.
        const giftEvidence = await getPurchaseEvidence(session);
        if (giftEvidence.kind === 'lookup-failed') {
          console.error('[GasCap webhook] Gift Price lookup failed — failing closed for retry:', giftEvidence.error);
          return NextResponse.json({ error: 'Unable to verify purchased Price.' }, { status: 502 });
        }
        if (giftEvidence.kind === 'rejected') {
          console.warn(`[GasCap webhook] Gift completion line-item evidence invalid — ${giftEvidence.reason}. No Gift record created.`);
          break;
        }
        if (giftEvidence.priceId !== PRICES.proLifetime) {
          console.warn('[GasCap webhook] Gift completion Price did not match canonical Pro Lifetime — rejecting, no Gift record created.');
          break;
        }

        const m = session.metadata;
        const deliverToRecipient = m.deliverToRecipient === 'true';
        const purchaserEmail = m.purchaserEmail ?? (session.customer_details?.email ?? '');
        const recipientEmail = m.recipientEmail || null;
        const paymentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;

        try {
          const gift = await createGift({
            occasion:           m.occasion ?? 'gift',
            amountPaid:         session.amount_total ?? 1999,
            purchaserEmail,
            recipientEmail:     deliverToRecipient ? recipientEmail : null,
            recipientName:      m.recipientName || null,
            giftMessage:        m.giftMessage || null,
            deliverToRecipient,
            stripeSessionId:    session.id,
            stripePaymentId:    paymentId,
          });

          const baseUrl   = (process.env.NEXTAUTH_URL ?? 'https://www.gascap.app').replace(/\/$/, '');
          // Include recipient email + name so the claim page can pre-fill the sign-up.
          const emailQs   = deliverToRecipient && recipientEmail ? `&email=${encodeURIComponent(recipientEmail)}` : '';
          const nameQs    = gift.recipientName ? `&name=${encodeURIComponent(gift.recipientName)}` : '';
          const redeemUrl = `${baseUrl}/redeem?code=${gift.code}${emailQs}${nameQs}`;
          const sendTo    = deliverToRecipient && recipientEmail ? recipientEmail : purchaserEmail;

          if (sendTo) {
            sendMail({
              to:      sendTo,
              subject: deliverToRecipient
                ? `🎁 You've been gifted GasCap™ Pro Lifetime!`
                : `🎁 Your GasCap™ Pro Lifetime gift code (${gift.code})`,
              html: giftEmailHtml({
                code:          gift.code,
                redeemUrl,
                occasion:      gift.occasion,
                toRecipient:   deliverToRecipient,
                recipientName: gift.recipientName,
                purchaserName: purchaserEmail,
                giftMessage:   gift.giftMessage,
              }),
              text: `Your GasCap Pro Lifetime gift code: ${gift.code}. Redeem at ${redeemUrl}`,
            }).catch((e) => console.error('[GasCap] Gift email failed:', e));
          }

          // If delivered to the recipient, also confirm to the buyer.
          if (deliverToRecipient && purchaserEmail && purchaserEmail !== recipientEmail) {
            sendMail({
              to:      purchaserEmail,
              subject: `Your GasCap™ gift is on its way 🎁`,
              html: giftEmailHtml({
                code:          gift.code,
                redeemUrl,
                occasion:      gift.occasion,
                toRecipient:   false,
                recipientName: gift.recipientName,
                purchaserName: purchaserEmail,
                giftMessage:   gift.giftMessage,
              }),
              text: `Thanks! Your gift code ${gift.code} was sent to ${recipientEmail}. Backup link: ${redeemUrl}`,
            }).catch((e) => console.error('[GasCap] Gift buyer confirmation failed:', e));
          }

          sendAdminMail({
            subject: `🎁 GasCap™ gift purchased — ${gift.code}`,
            html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
              <p style="font-size:20px;margin:0 0 8px;">🎁 Gift purchased</p>
              <p style="font-size:14px;color:#334155;margin:0 0 4px;">Code: <strong>${gift.code}</strong> · Occasion: ${gift.occasion}</p>
              <p style="font-size:14px;color:#64748b;margin:0 0 4px;">Buyer: ${purchaserEmail}</p>
              <p style="font-size:14px;color:#64748b;margin:0 0 4px;">Recipient: ${deliverToRecipient ? recipientEmail : '(buyer will hand over)'}</p>
              <p style="font-size:12px;color:#94a3b8;">${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET</p>
            </div>`,
            text: `Gift purchased: ${gift.code} (${gift.occasion}) — buyer ${purchaserEmail}, recipient ${deliverToRecipient ? recipientEmail : 'buyer-held'}`,
          });

          console.info(`[GasCap webhook] Gift created ${gift.code} (buyer ${purchaserEmail})`);
        } catch (e) {
          console.error('[GasCap webhook] Gift creation failed:', e);
        }
        break;
      }

      const userId  = session.metadata?.userId;
      if (!userId) break;

      // Stripe Payment Authorization Hardening — explicit payment_status
      // gate, checked before any entitlement-bearing work (Price
      // verification, setUserPlan, onboarding, purchase_completed,
      // referral logic). See isEntitlementAuthorizedPaymentStatus() above
      // for the exact policy and rationale.
      if (!isEntitlementAuthorizedPaymentStatus(session.payment_status)) {
        console.warn(`[GasCap webhook] checkout.session.completed payment_status not authorized (${session.payment_status}) for user ${userId} — no entitlement granted.`);
        break;
      }

      // Stripe Payment Authorization Hardening — verify the ACTUAL Stripe
      // Price purchased (via the Checkout Session's own line items) before
      // any entitlement mutation. session.metadata.tier/billing is REQUEST
      // context, not proof of what was bought — a prior legacy checkout
      // escape hatch let those diverge from the real Price. See
      // verifyCheckoutPurchase() above for the exact classification.
      const verified = await verifyCheckoutPurchase(session);

      if (verified.kind === 'lookup-failed') {
        // Provider/API lookup failure — distinct from a resolved-but-wrong
        // Price. Fail closed: do not acknowledge this event as processed,
        // so Stripe retries per its normal webhook retry schedule. Do NOT
        // log the actual Price ID or user PII.
        console.error(`[GasCap webhook] checkout.session.completed Price lookup failed for user ${userId} — failing closed for retry:`, verified.error);
        return NextResponse.json({ error: 'Unable to verify purchased Price.' }, { status: 502 });
      }

      if (verified.kind === 'rejected') {
        // Deterministic Price/metadata mismatch — not a transient failure.
        // Acknowledge (200) so Stripe doesn't retry a permanently invalid
        // session forever; grant nothing. Redacted warning only — never
        // print the actual Price ID.
        console.warn(`[GasCap webhook] checkout.session.completed REJECTED for user ${userId} — ${verified.reason}. No entitlement granted.`);
        break;
      }

      if (verified.kind === 'lifetime-perks') {
        // Lifetime Perks is an ADD-ON, never a normal Pro upgrade — it must
        // never call setUserPlan(), overwrite stripeInterval, clear/replace
        // Lifetime ownership, emit purchase_completed, or run any of the
        // ordinary paid-campaign/engagement/admin-notify/early-upgrade-bonus
        // side effects below. invoice.payment_succeeded already owns Perks
        // activation via its own canonical-Price check (setLifetimePerksActive,
        // see that handler below) — duplicating a one-year extension here
        // would be both redundant and a second, driftable source of truth.
        console.info(`[GasCap webhook] checkout.session.completed — Lifetime Perks initial checkout confirmed for user ${userId}; activation deferred to invoice.payment_succeeded.`);
        break;
      }

      // verified.kind === 'pro' from here on — the only remaining case.
      // `verified.billing` is Stripe-Price-confirmed, not merely
      // metadata-echoed, and is exactly 'monthly' | 'lifetime' (never
      // 'annual' — Annual is rejected before a checkout session can even be
      // created; never 'fleet' — no canonical Fleet Price exists to match).
      const customerId     = typeof session.customer     === 'string' ? session.customer     : null;
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
      const planTier: 'pro' = 'pro';
      const interval: 'monthly' | 'lifetime' = verified.billing;

      // Fetch BEFORE setUserPlan so we can check isProTrial before it's cleared
      const userBeforeUpgrade = await findById(userId);
      const wasOnTrial = userBeforeUpgrade?.isProTrial ?? false;

      await setUserPlan(userId, planTier, {
        customerId:     customerId     ?? undefined,
        subscriptionId: subscriptionId ?? undefined,
        interval,
      });

      // ── Growth Sprint 1, P0B — first-party purchase_completed analytics ──
      // Entitlement (setUserPlan, above) has already completed successfully
      // by this point — this write is strictly additive and must never be
      // able to affect it. `interval` here is already Price-verified (see
      // verifyCheckoutPurchase above), so every purchase_completed event
      // from here on reflects a genuine, canonical Pro Monthly/Lifetime sale.
      const analyticsBilling: 'monthly' | 'lifetime' = interval;

      if (session.payment_status === 'paid') {
        try {
          const result = await recordAnalyticsEvent({
            eventType:      'purchase_completed',
            originPlatform: 'web',
            emitter:        'webhook',
            userId,
            provider:       'stripe',
            billing:        analyticsBilling,
            source:         'stripe_checkout',
            idempotencyKey: `stripe:${event.id}`,
            metadata: {
              tier: planTier,
              ...(typeof session.amount_total === 'number' ? { amountTotal: session.amount_total } : {}),
              ...(session.currency ? { currency: session.currency } : {}),
              ...(session.metadata?.offerSource ? { offerSource: session.metadata.offerSource } : {}),
            },
          });
          console.log(`[GasCap analytics] Stripe purchase_completed ${result.outcome} for event ${event.id}`);
        } catch (err) {
          // Analytics failure must never affect entitlement, GHL, emails, or
          // referral processing — all of which run below this point and are
          // completely unaffected by this catch. Logged only.
          console.error('[GasCap analytics] Stripe purchase event write failed:', err);
        }
      }

      // Founding Member launch promo — record the REAL redemption so the "X of
      // 100 spots left" banner counts actual $9.99 Lifetime purchases, not just
      // signups since launch (the coupon is shared with win-back/new-member, so
      // this metadata tag is the only way to attribute the purchase correctly).
      if (interval === 'lifetime' && session.metadata?.offerSource === 'founding') {
        await markFoundingMember(userId);
      }

      // Lifetime is a one-time payment (mode:'payment') with no subscription of
      // its own. If this buyer was previously a recurring subscriber (monthly /
      // annual Pro), their old subscription is still live and would keep billing
      // them on top of the Lifetime charge. Cancel it now so they're never
      // double-billed. The resulting customer.subscription.deleted event is
      // safely ignored for Lifetime owners (see that handler below).
      if (interval === 'lifetime' && userBeforeUpgrade?.stripeSubscriptionId) {
        const oldSubId = userBeforeUpgrade.stripeSubscriptionId;
        try {
          await stripe.subscriptions.cancel(oldSubId);
          await clearStripeSubscriptionId(userId);
          console.info(`[GasCap webhook] Cancelled prior subscription ${oldSubId} after Lifetime upgrade for ${userId}`);
        } catch (e) {
          console.error(`[GasCap webhook] Failed to cancel prior subscription ${oldSubId} after Lifetime upgrade:`, e);
          sendAdminMail({
            subject: `⚠️ GasCap™: manual sub-cancel needed after Lifetime upgrade`,
            html: `<p>User <strong>${userId}</strong> bought Pro Lifetime but their prior subscription <code>${oldSubId}</code> could not be cancelled automatically. Please cancel it in Stripe so they aren't double-billed.</p>`,
            text: `User ${userId} bought Lifetime but prior subscription ${oldSubId} could not be auto-cancelled. Cancel it manually in Stripe.`,
          });
        }
      }

      // Backfill phone from Stripe checkout if user didn't provide one at signup.
      // Note: Stripe phone is for billing only — SMS consent must come from the
      // opt-in checkbox on the signup or Settings page, never assumed here.
      const stripePhone = (session as Stripe.Checkout.Session & { customer_details?: { phone?: string | null } })
        ?.customer_details?.phone;
      if (stripePhone) {
        if (userBeforeUpgrade && !userBeforeUpgrade.phone) {
          updateUserProfile(userId, { phone: stripePhone })
            .catch((e) => console.error('[GasCap] Stripe phone backfill failed:', e));
        }
      }

      // Sync plan change to GHL CRM + notify admin
      const upgradedUser = await findById(userId);
      if (upgradedUser) {
        updateGhlContactPlan(upgradedUser.email, planTier)
          .catch((err) => console.error('[GHL] plan sync failed:', err));

        // interval is Price-verified 'monthly' | 'lifetime' only at this
        // point (see verifyCheckoutPurchase) — Annual/Fleet labels are
        // unreachable and were removed rather than left as dead branches.
        const tierLabel = interval === 'lifetime'
          ? 'Pro Lifetime Membership ($19.99)'
          : 'Pro Monthly ($2.99/mo)';

        sendAdminMail({
          subject: `⬆️ GasCap™ upgrade: ${upgradedUser.name} → ${interval === 'lifetime' ? 'PRO LIFETIME' : planTier.toUpperCase()}`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
            <p style="font-size:22px;margin:0 0 8px;">⬆️ Plan upgrade</p>
            <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${upgradedUser.name}</strong> upgraded to <strong>${tierLabel}</strong></p>
            <p style="font-size:14px;color:#64748b;margin:0 0 16px;">${upgradedUser.email}</p>
            <p style="font-size:12px;color:#94a3b8;">${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET</p>
          </div>`,
          text: `GasCap upgrade: ${upgradedUser.name} <${upgradedUser.email}> → ${tierLabel}`,
        });

        // Credit early-upgrade bonus if they were on a Pro trial at upgrade time.
        // Use wasOnTrial (captured before setUserPlan cleared isProTrial).
        if (wasOnTrial) {
          await setEarlyUpgradeBonus(userId, 10);
        }

        // ── Getaway promo (Option B: buyer picks destination, admin issues) ────
        // Any Lifetime purchase made while the getaway promo is active earns a
        // complimentary resort getaway. The buyer chooses their destination at
        // /getaway; that choice fires the actionable "ISSUE" email to the admin
        // (see app/api/getaway/choose). Here we just invite them to choose and
        // give the admin a heads-up.
        if (interval === 'lifetime' && getawayPromoActive()) {
          // 72-hour verification hold (2026-08-25) — same idempotent stamp as
          // the RevenueCat grant path (see lib/getawayFulfillment.ts). A
          // Stripe Lifetime purchase's own webhook remains its source of
          // truth for entitlement re-checks at fulfillment time — this only
          // records WHEN the hold started.
          await stampGetawayHoldUntil(userId);
          const baseUrl   = (process.env.NEXTAUTH_URL ?? 'https://www.gascap.app').replace(/\/$/, '');
          const chooseUrl = `${baseUrl}/getaway`;

          sendAdminMail({
            subject: `🏝️ Getaway sale — ${upgradedUser.email} will choose a destination`,
            html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
              <p style="font-size:20px;margin:0 0 8px;">🏝️ Getaway promo sale</p>
              <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${upgradedUser.name}</strong> bought Pro Lifetime during the getaway promo.</p>
              <p style="font-size:14px;color:#64748b;margin:0 0 12px;">They'll pick a destination at /getaway — you'll get a separate <strong>"ISSUE GETAWAY CERT"</strong> email with the exact destination once they choose. No action needed yet.</p>
              <p style="font-size:13px;color:#64748b;margin:0 0 4px;">Buyer: <strong>${upgradedUser.email}</strong></p>
              <p style="font-size:12px;color:#94a3b8;">${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET</p>
            </div>`,
            text: `Getaway promo sale: ${upgradedUser.name} <${upgradedUser.email}> — awaiting destination choice (separate ISSUE email to follow).`,
          });

          sendMail({
            to:      upgradedUser.email,
            subject: `🏝️ Choose your complimentary getaway`,
            html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
              <div style="background:linear-gradient(135deg,#005F4A,#1EB68F);border-radius:16px 16px 0 0;padding:24px;text-align:center;">
                <p style="font-size:26px;margin:0;color:#fff;font-weight:800;">🏝️ You've earned a getaway!</p>
              </div>
              <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px;">
                <p style="font-size:15px;color:#334155;margin:0 0 12px;">Hi ${upgradedUser.name}, thanks for going Lifetime with GasCap™ Pro! 🎉 As a thank-you, pick the complimentary resort getaway you'd like:</p>
                <p style="text-align:center;margin:0 0 16px;">
                  <a href="${chooseUrl}" style="display:inline-block;background:#1EB68F;color:#fff;font-weight:800;font-size:15px;text-decoration:none;padding:12px 28px;border-radius:12px;">Choose my destination →</a>
                </p>
                <div style="background:#f0fdf9;border:1px solid #99f6e4;border-radius:12px;padding:14px 16px;margin:0 0 12px;">
                  <p style="font-size:12px;color:#0f766e;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">Good to know</p>
                  ${GETAWAY_DISCLOSURE.full.map((l) => `<p style="font-size:13px;color:#334155;margin:0 0 4px;">• ${l}</p>`).join('')}
                </div>
                <p style="font-size:13px;color:#64748b;margin:0;">Questions? Just reply to this email.</p>
              </div>
            </div>`,
            text: `You've earned a complimentary getaway! Choose your destination: ${chooseUrl}. ${GETAWAY_DISCLOSURE.short}`,
          }).catch((e) => console.error('[GasCap] Getaway choose email failed:', e));

          // Bonus push alongside the email (app users w/ notifications only).
          sendUserPush(
            upgradedUser.id,
            '🏝️ You\'ve earned a getaway!',
            'Thanks for going Lifetime — tap to choose your complimentary resort getaway.',
            '/getaway',
          ).catch(() => { /* best-effort */ });

          console.info(`[GasCap webhook] Getaway promo — choose-destination email sent to ${upgradedUser.email}`);
        }

        // Only enroll if not already in the paid campaign (idempotent guard)
        if (!upgradedUser.paidCampaignEnrolledAt) {
          // Growth Sprint 1, P0B provenance fix — this IS a genuine Stripe
          // billing interval, safe to persist into stripeInterval.
          await enrollPaidCampaign(userId, interval, { persistStripeProvenance: true });
        }

        if (!upgradedUser.engagementEnrolledAt) {
          await enrollEngagementCampaign(upgradedUser.id, 'pro');
        }

        sendPaidCampaignEmail('P1', {
          id:       upgradedUser.id,
          name:     upgradedUser.name,
          email:    upgradedUser.email,
          tier:     planTier,
          interval,
        }).catch((err) => console.error('[paid-campaign] P1 send failed:', err));

        // Bonus welcome push alongside the P1 email (app users w/ notifications).
        sendUserPush(
          upgradedUser.id,
          `You're officially GasCap™ Pro 🎉`,
          'Welcome! Your Pro features are unlocked — tap to start tracking your fill-ups.',
          '/',
        ).catch(() => { /* best-effort */ });

        // ── Referral credit for lifetime purchases ─────────────────────────
        // For subscriptions, referral credit fires on invoice.payment_succeeded.
        // For lifetime (mode:'payment'), no invoice event fires — handle it here.
        if (
          interval === 'lifetime' &&
          session.payment_status === 'paid' &&
          upgradedUser.referredBy &&
          !upgradedUser.referralRewardCredited
        ) {
          const credited = await creditVerifiedReferral(upgradedUser.id);
          if (credited && upgradedUser.referredBy) {
            const referrer = await findByReferralCode(upgradedUser.referredBy);
            if (referrer && !referrer.isTestAccount) {
              const fresh = await findById(referrer.id);
              const totalCredits = fresh ? getActiveCredits(fresh).length : 1;
              sendReferralCreditEmail(
                referrer.id,
                referrer.email,
                referrer.name,
                totalCredits,
              ).catch((e) => console.error('[GasCap] Lifetime referral credit email failed:', e));
              console.info(`[GasCap webhook] Lifetime referral credit → ${referrer.email}`);
            }
          }
        }
      }

      console.info(`[GasCap webhook] Upgraded user ${userId} to ${planTier}`);
      break;
    }

    // Invoice paid → ensure plan stays active (handles renewals)
    case 'invoice.payment_succeeded': {
      const invoice    = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
      if (!customerId) break;

      const subId = typeof invoice.subscription === 'string' ? invoice.subscription : undefined;

      // Stripe Payment Authorization Hardening — retrieve the Subscription
      // BEFORE resolving a GasCap user via findByStripeCustomer(). A
      // genuine Lifetime owner can legitimately have stripeCustomerId=null
      // (their original Lifetime purchase went through a guest,
      // payment-mode Checkout Session — see lib/users.ts), so a brand-new
      // Stripe Customer created for their FIRST Lifetime Perks subscription
      // would never resolve through the old customer-first lookup: the
      // handler used to exit before ever learning it was looking at a
      // Perks subscription. Resolving provider evidence first, then the
      // user, fixes that without reintroducing a generic entitlement write
      // into the Perks path.
      let sub: Stripe.Subscription | null = null;
      if (stripe && subId) {
        try {
          sub = await stripe.subscriptions.retrieve(subId);
        } catch (err) {
          // Provider/API failure — distinct from "this isn't a Perks
          // subscription". Fail closed: do not fall through into generic
          // renewal logic when GasCap cannot establish what was actually
          // paid for. No Stripe IDs logged.
          console.error('[GasCap webhook] invoice.payment_succeeded subscription retrieval failed — failing closed for retry:', err);
          return NextResponse.json({ error: 'Unable to verify subscription.' }, { status: 502 });
        }
      }

      const priceId = sub?.items.data[0]?.price?.id ?? '';

      // ── Lifetime Perks activation (provider-authoritative) ─────────────────
      // A separate annual subscription ($9.99/yr) for Lifetime members. This
      // remains the SINGLE owner of setLifetimePerksActive() — checkout.
      // session.completed's Perks branch deliberately never calls it (see
      // that handler above), so activation can never double-fire or race
      // against itself across the two event types. Never calls
      // setUserPlan(); never touches plan/stripeInterval.
      if (sub && priceId === PRICES.lifetimePerks && subId) {
        const items = sub.items.data;
        const shapeOk = items.length === 1 && items[0].quantity === 1;
        const metaUserId = sub.metadata?.userId;
        const metaOk = shapeOk && !!metaUserId
          && sub.metadata?.tier === 'pro'
          && sub.metadata?.billing === 'lifetime-perks';

        if (!metaOk) {
          console.warn('[GasCap webhook] invoice.payment_succeeded — Lifetime Perks subscription failed shape/metadata verification. No activation.');
          break;
        }

        // Resolve identity from the subscription's own trusted metadata —
        // never from email, never guessed. Do not fall back if this
        // lookup misses.
        const metadataUser = await findById(metaUserId!);
        if (!metadataUser) {
          console.warn('[GasCap webhook] invoice.payment_succeeded — Lifetime Perks metadata.userId did not resolve to a GasCap user. No activation.');
          break;
        }

        // Customer mapping vs. subscription metadata must agree — never
        // activate for one identity based on a signal that points at
        // another.
        const customerMappedUser = await findByStripeCustomer(customerId);
        if (customerMappedUser && customerMappedUser.id !== metadataUser.id) {
          console.warn('[GasCap webhook] invoice.payment_succeeded — Lifetime Perks Customer mapping and subscription metadata identify different users. No activation.');
          break;
        }

        if (metadataUser.stripeCustomerId && metadataUser.stripeCustomerId !== customerId) {
          console.warn('[GasCap webhook] invoice.payment_succeeded — Lifetime Perks Customer ID does not match the stored user. No activation, no overwrite.');
          break;
        }

        if (!metadataUser.stripeCustomerId) {
          // Guest-Lifetime-purchase user — this is the first Stripe
          // Customer ID ever seen for them. Bind it via the narrowly-scoped
          // helper (writes ONLY stripeCustomerId, race-safe).
          const { bound } = await bindStripeCustomerIdIfMissing(metadataUser.id, customerId);
          if (!bound) {
            const recheck = await findById(metadataUser.id);
            if (recheck?.stripeCustomerId !== customerId) {
              console.warn('[GasCap webhook] invoice.payment_succeeded — Lifetime Perks Customer ID binding lost a race and does not match. No activation.');
              break;
            }
          }
        }

        await setLifetimePerksActive(metadataUser.id, subId);

        const baseUrl   = (process.env.NEXTAUTH_URL ?? 'https://www.gascap.app').replace(/\/$/, '');
        const chooseUrl = `${baseUrl}/getaway`;

        sendAdminMail({
          subject: `🏅 Lifetime Perks renewed — ${metadataUser.email} will choose a destination`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
            <p style="font-size:20px;margin:0 0 8px;">🏅 Lifetime Perks renewal</p>
            <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${metadataUser.name}</strong> renewed their Lifetime Perks ($9.99).</p>
            <p style="font-size:14px;color:#64748b;margin:0 0 12px;">${metadataUser.email}</p>
            <p style="font-size:14px;color:#334155;margin:0 0 4px;">They'll pick a destination at /getaway — sent automatically via Marketing Boost if it's in the live API catalog, otherwise you'll get a separate <strong>"ISSUE GETAWAY CERT"</strong> email. No action needed yet.</p>
            <p style="font-size:12px;color:#94a3b8;">${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET</p>
          </div>`,
          text: `Lifetime Perks renewal: ${metadataUser.name} <${metadataUser.email}> — awaiting destination choice (auto-sent via MB API if available, otherwise separate ISSUE email to follow).`,
        });

        sendMail({
          to:      metadataUser.email,
          subject: `🏝️ Your Lifetime Perks are renewed — choose your getaway`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#005F4A,#1EB68F);border-radius:16px 16px 0 0;padding:24px;text-align:center;">
              <p style="font-size:26px;margin:0;color:#fff;font-weight:800;">🏅 Lifetime Perks renewed!</p>
            </div>
            <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px;">
              <p style="font-size:15px;color:#334155;margin:0 0 12px;">Hi ${metadataUser.name}, your GasCap™ Lifetime Perks are active for another year. That means +20 bonus giveaway entries every week — and another complimentary resort getaway on us!</p>
              <p style="text-align:center;margin:0 0 16px;">
                <a href="${chooseUrl}" style="display:inline-block;background:#1EB68F;color:#fff;font-weight:800;font-size:15px;text-decoration:none;padding:12px 28px;border-radius:12px;">Choose my getaway →</a>
              </p>
              <p style="font-size:13px;color:#64748b;margin:0;">Questions? Reply to this email.</p>
            </div>
          </div>`,
          text: `Your Lifetime Perks are renewed! Choose your complimentary getaway: ${chooseUrl}`,
        }).catch((e) => console.error('[GasCap] Lifetime Perks renewal email failed:', e));

        console.info(`[GasCap webhook] Lifetime Perks renewed for ${metadataUser.id}`);
        break;
      }

      // ── Standard Pro / Annual renewal ─────────────────────────────────────
      const user = await findByStripeCustomer(customerId);
      if (!user) break;

      let tier: 'pro' | 'fleet' = user.plan === 'fleet' ? 'fleet' : 'pro';

      if (priceId) {
        const fleetPrices = [
          process.env.STRIPE_PRICE_FLEET_MONTHLY ?? '',
          process.env.STRIPE_PRICE_FLEET_ANNUAL  ?? '',
        ].filter(Boolean);
        if (fleetPrices.includes(priceId)) tier = 'fleet';
      }

      // Determine interval for annual renewal (keeps stripeInterval accurate for any
      // legacy annual subscription still renewing — Annual is shelved for NEW
      // purchases as of 2026-07-23, see lib/stripe.ts, so this is a defensive-only
      // check; read directly from env like the fleet check above since PRICES no
      // longer exposes proAnnual publicly).
      const renewalInterval: 'monthly' | 'annual' | undefined =
        priceId === (process.env.STRIPE_PRICE_PRO_ANNUAL ?? '') ? 'annual' : undefined;

      if (user.plan !== tier || renewalInterval) {
        await setUserPlan(user.id, tier, { subscriptionId: subId, ...(renewalInterval ? { interval: renewalInterval } : {}) });
        console.info(`[GasCap webhook] Activated ${tier}${renewalInterval ? '/annual' : ''} for user ${user.id} on renewal`);
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

    // Subscription cancelled / payment failed → revert to free OR deactivate addon
    case 'customer.subscription.deleted':
    case 'invoice.payment_failed': {
      const obj        = event.data.object as Stripe.Subscription | Stripe.Invoice;
      const customerId = typeof obj.customer === 'string' ? obj.customer : null;
      if (!customerId) break;

      const user = await findByStripeCustomer(customerId);
      if (user) {
        // Check if this is a Lifetime Perks add-on cancellation (not the main sub).
        // If so, just clear the perks — keep plan=pro + stripeInterval=lifetime.
        const cancelledSubId = event.type === 'customer.subscription.deleted'
          ? (event.data.object as Stripe.Subscription).id
          : null;
        if (cancelledSubId && user.lifetimePerksSubId === cancelledSubId) {
          await clearLifetimePerks(user.id);
          console.info(`[GasCap webhook] Lifetime Perks lapsed for ${user.id} — Pro access retained`);
          sendAdminMail({
            subject: `📉 Lifetime Perks cancelled — ${user.email}`,
            html: `<p>${user.name} (${user.email}) let their Lifetime Perks lapse. They keep Pro access but drop to +10 giveaway entries/week (no voucher).</p>`,
            text:  `Lifetime Perks cancelled: ${user.name} <${user.email}> — Pro retained, perks cleared.`,
          });
          break;
        }

        // Sprint 2: was a single ad-hoc check — "if stripeInterval ===
        // 'lifetime', skip" — which protected Lifetime owners from THIS
        // event but had no idea a coexisting RevenueCat entitlement could
        // also exist (the exact reverse of the bug found in the RevenueCat
        // webhook: a Stripe-side cancellation blowing away a legitimate
        // RevenueCat-granted Pro). Now resolves from every known source;
        // only actually downgrades if nothing else qualifies.
        const resolved = await revokeStripeSubscriptionEntitlement(user.id);

        if (resolved.pro) {
          console.info(`[GasCap webhook] ${event.type} for ${user.id} — Stripe subscription ended but Pro retained via: ${resolved.sources.join(', ')}`);
          sendAdminMail({
            subject: `ℹ️ Stripe subscription ended, Pro retained — ${user.email}`,
            html: `<p>${user.name} (${user.email})'s Stripe subscription ended (${event.type}), but they remain Pro via: <strong>${resolved.sources.join(', ')}</strong>. No action needed — this is expected multi-provider behavior, not a billing error.</p>`,
            text: `${user.name} <${user.email}> — Stripe subscription ended, Pro retained via ${resolved.sources.join(', ')}.`,
          });
          break;
        }

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
            interval: (user.stripeInterval ?? 'monthly') as 'monthly' | 'annual' | 'lifetime',
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

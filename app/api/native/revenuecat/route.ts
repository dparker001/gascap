/**
 * POST /api/native/revenuecat
 *
 * RevenueCat webhook → grants/revokes GasCap Pro on the user's account when they
 * buy (or lose) Pro via Apple In-App Purchase on iOS. Because Pro is account-based
 * and synced, an IAP purchase made on iOS unlocks Pro everywhere (web + app), just
 * like a Stripe purchase does. This is the IAP counterpart to the Stripe webhook.
 *
 * Setup:
 *  - RevenueCat dashboard → Project → Integrations → Webhooks → URL =
 *    https://www.gascap.app/api/native/revenuecat, Authorization header = a secret.
 *  - Set that same secret as REVENUECAT_WEBHOOK_AUTH on Railway.
 *  - The native app calls Purchases.logIn(<gascap userId>) so RevenueCat's
 *    app_user_id IS the GasCap user id (how we match the account below).
 *
 * Product IDs (App Store Connect):
 *  - gascap_pro_lifetime  → non-consumable  → interval 'lifetime'
 *  - gascap_pro_monthly   → auto-renew sub  → interval 'monthly'
 *
 * EXTERNAL SIDE-EFFECT SEMANTICS — stated honestly, post-Sprint-2 Revision 1.
 * The entitlement mutation itself (setUserPlan / revokeRevenueCatEntitlement)
 * IS exactly-once per event, guaranteed by the atomic claim in
 * lib/revenueCatEvents.ts. The SIDE EFFECTS fired alongside it are not all
 * equally protected — do not assume "idempotent event" implies "idempotent
 * everything that runs during it":
 *
 *  - Getaway choose-email (maybeSendGetaway): DURABLE one-time, via the
 *    getawayChooseEmailSentAt atomic claim (see that function). Chosen
 *    because this is the highest-consequence one-time business
 *    communication here — a duplicate would be a visibly broken customer
 *    experience for a Lifetime purchase, and the fix was cheap.
 *  - Welcome email / paid-campaign enrollment (sendPaidCampaignEmail,
 *    enrollPaidCampaign): protected by a durable USER-state check
 *    (`!user.paidCampaignEnrolledAt`) BEFORE firing, which is itself
 *    read-then-act (not atomic) — a sufficiently tight race between two
 *    concurrent deliveries for the same user's first purchase could send
 *    it twice. In practice this requires two GRANT events for the same
 *    user resolving concurrently, which the event-level claim already
 *    prevents for the SAME event.id but not for two genuinely different
 *    event ids (e.g. a real double-delivery from RevenueCat using
 *    different ids, which shouldn't happen but isn't structurally
 *    impossible). Not given a durable atomic claim in this revision — the
 *    existing user-state check meaningfully narrows the window and a
 *    duplicate welcome email is a much lower-consequence failure than a
 *    duplicate getaway offer.
 *  - Welcome/getaway push notifications (sendUserPush): best-effort,
 *    fire-and-forget, NOT deduplicated beyond whatever the email checks
 *    above already provide as a side effect of running in the same branch.
 *    A push arriving twice is a minor annoyance, not a business-consequence
 *    bug — deliberately not hardened further.
 *  - Admin notification emails (sendAdminMail): not deduplicated at all.
 *    These exist purely to inform a human; a duplicate costs nothing beyond
 *    an extra email in an inbox.
 *
 * Crash-window truth for anything NOT durably marked above: if the process
 * crashes after firing one of these (they are not awaited before
 * markProcessed runs) but the claim still succeeds in reaching
 * markProcessed, a retry of the same event is blocked by the event-level
 * claim and the side effect will NOT re-fire — but if the crash happens
 * BEFORE markProcessed (or markProcessed itself fails), a retry WILL re-run
 * this handler and re-fire every non-durably-marked side effect. This is
 * the same class of gap the getaway email had before this revision; it was
 * fixed there specifically because that side effect's consequence severity
 * justified it, not because every side effect in this handler is now safe.
 * If a future addition here is similarly consequential (e.g. a paid
 * one-time credit grant), give it the same atomic-claim treatment rather
 * than assuming the event-level idempotency covers it.
 */
import { NextResponse } from 'next/server';
import { setUserPlan, findById, findByEmail, enrollPaidCampaign, revokeRevenueCatEntitlement } from '@/lib/users';
import { prisma } from '@/lib/prisma';
import { sendMail } from '@/lib/email';
import { sendPaidCampaignEmail } from '@/lib/emailCampaignPaid';
import { sendUserPush } from '@/lib/userPush';
import { getawayPromoActive, GETAWAY_DISCLOSURE } from '@/lib/getawayPromo';
import { claimEvent, markProcessed, markFailed } from '@/lib/revenueCatEvents';
import { verifyRevenueCatHmac, HMAC_SIGNATURE_HEADER } from '@/lib/revenueCatHmac';

export const dynamic = 'force-dynamic';

const LIFETIME_PRODUCT = 'gascap_pro_lifetime';

/** Fire-and-forget admin notification (mirrors the Stripe webhook). */
function sendAdminMail(opts: { subject: string; html: string; text: string }) {
  sendMail({ to: 'info@gascap.app', ...opts })
    .catch((e) => console.error('[revenuecat] Admin notify failed:', e));
}

/**
 * Getaway promo fulfillment for IAP lifetime buyers — same as the Stripe webhook.
 * Lifetime purchase during the active promo earns a complimentary resort getaway;
 * the buyer picks a destination at /getaway (or via the success-page picker),
 * which fires the actionable "ISSUE GETAWAY CERT" email. Here we give the admin a
 * heads-up and email the buyer the choose link.
 *
 * Post-Sprint-2 Revision 1 fix — durable idempotency, not just "only on the
 * initial lifetime event type." Being keyed on event TYPE alone was not
 * actually crash-safe: if the process died after this function ran but
 * before the triggering webhook event was marked processed, a retry of that
 * SAME event would re-run this function and send a second getaway email —
 * the exact scenario named in the Sprint 2 review (send email → crash before
 * markProcessed → retry re-sends). `getawayChooseEmailSentAt` is claimed
 * atomically (a conditional UPDATE, not a plain write) immediately before
 * sending, so only one caller — ever, across any number of retries or
 * concurrent deliveries — can win the claim and actually send.
 */
async function maybeSendGetaway(user: { id: string; email: string; name?: string | null }, eventType: string) {
  if (!getawayPromoActive()) return;
  if (!INITIAL_GRANT_EVENTS.has(eventType)) return;

  const claim = await prisma.user.updateMany({
    where: { id: user.id, getawayChooseEmailSentAt: null },
    data:  { getawayChooseEmailSentAt: new Date().toISOString() },
  });
  if (claim.count === 0) {
    // Already sent (or a concurrent call just won the claim) — no-op.
    console.info(`[revenuecat] Getaway choose email already sent for ${user.email}, skipping duplicate.`);
    return;
  }

  const baseUrl   = (process.env.NEXTAUTH_URL ?? 'https://www.gascap.app').replace(/\/$/, '');
  const chooseUrl = `${baseUrl}/getaway`;
  const name      = user.name ?? 'there';

  sendAdminMail({
    subject: `🏝️ Getaway sale (IAP) — ${user.email} will choose a destination`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
      <p style="font-size:20px;margin:0 0 8px;">🏝️ Getaway promo sale (Apple IAP)</p>
      <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${name}</strong> bought Pro Lifetime via the app during the getaway promo.</p>
      <p style="font-size:14px;color:#64748b;margin:0 0 12px;">They'll pick a destination at /getaway — you'll get a separate <strong>"ISSUE GETAWAY CERT"</strong> email with the destination once they choose. No action needed yet.</p>
      <p style="font-size:13px;color:#64748b;margin:0 0 4px;">Buyer: <strong>${user.email}</strong></p>
    </div>`,
    text: `Getaway promo sale (IAP): ${name} <${user.email}> — awaiting destination choice (separate ISSUE email to follow).`,
  });

  sendMail({
    to:      user.email,
    subject: `🏝️ Choose your complimentary getaway`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#005F4A,#1EB68F);border-radius:16px 16px 0 0;padding:24px;text-align:center;">
        <p style="font-size:26px;margin:0;color:#fff;font-weight:800;">🏝️ You've earned a getaway!</p>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px;">
        <p style="font-size:15px;color:#334155;margin:0 0 12px;">Hi ${name}, thanks for going Lifetime with GasCap™ Pro! 🎉 As a thank-you, pick the complimentary resort getaway you'd like:</p>
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
  }).catch((e) => console.error('[revenuecat] Getaway choose email failed:', e));

  // Bonus push alongside the email (app users w/ notifications only).
  sendUserPush(
    user.id,
    '🏝️ You\'ve earned a getaway!',
    'Thanks for going Lifetime — tap to choose your complimentary resort getaway.',
    '/getaway',
  ).catch(() => { /* best-effort */ });

  console.info(`[revenuecat] Getaway promo — choose-destination email sent to ${user.email}`);
}

// Events that should GRANT / extend Pro.
const GRANT_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',   // lifetime (non-consumable)
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'TRANSFER',                // non-consumable restored/transferred to a new app_user_id
]);
// First-time grant events → trigger the welcome email + getaway (once).
const INITIAL_GRANT_EVENTS = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'TRANSFER']);
// Events that should REVOKE Pro. (CANCELLATION = auto-renew off but still active →
// NOT revoked here; access ends at EXPIRATION.)
const REVOKE_EVENTS = new Set(['EXPIRATION', 'REFUND']);

interface RcEvent {
  // `id` is RevenueCat's documented unique webhook-event identifier —
  // https://www.revenuecat.com/docs/integrations/webhooks — an
  // always-present field on every event, per RevenueCat's current
  // documentation (independently confirmed post-Sprint-2 Revision 1;
  // RevenueCat explicitly recommends it for dedup). Used below as the
  // idempotency key. Still typed optional because the payload is
  // attacker/network-observable input, not because presence is genuinely in
  // doubt — see the `!ev.id` fail-safe branch below for what happens if a
  // real payload ever violates this contract.
  id?:                   string;
  type?:                string;
  app_user_id?:         string;
  original_app_user_id?: string;
  aliases?:             string[];
  product_id?:          string;
}

/** Resolve the GasCap user from RevenueCat's app_user_id (we set it = userId). */
async function resolveUser(ev: RcEvent) {
  const candidates = [ev.app_user_id, ev.original_app_user_id, ...(ev.aliases ?? [])]
    .filter((v): v is string => !!v);
  for (const c of candidates) {
    const byId = await findById(c);
    if (byId) return byId;
  }
  // Fallback: some setups use email as the app_user_id.
  for (const c of candidates) {
    if (c.includes('@')) {
      const byEmail = await findByEmail(c);
      if (byEmail) return byEmail;
    }
  }
  return undefined;
}

/**
 * Constant-time string comparison.
 *
 * `!==` on secrets leaks length and first-difference position through timing.
 * The margin is small over a network, but this endpoint grants paid access and
 * the correct comparison costs nothing.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  // Auth: RevenueCat sends the Authorization header configured in its dashboard.
  //
  // FAILS CLOSED. This previously read `if (expected && supplied !== expected)`,
  // so a missing REVENUECAT_WEBHOOK_AUTH did not disable the check partially —
  // it disabled it entirely, and any unauthenticated POST could grant or revoke
  // Pro on any account. An absent secret is a misconfiguration, never a reason
  // to trust the caller.
  //
  // 503, not 401: the request may be perfectly valid — the SERVER is
  // misconfigured, so the response should say that rather than blame the
  // caller. (RevenueCat's documented webhook behavior treats ANY non-200
  // response as a failure and retries up to 5 times regardless of status
  // code, so 503 doesn't earn extra retries over 401 here — the choice is
  // about honest semantics, not about influencing whether RevenueCat retries.)
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected) {
    console.error(
      '[revenuecat] REVENUECAT_WEBHOOK_AUTH is not set — refusing to process. ' +
      'Pro grants/revocations via Apple IAP are halted until it is configured.',
    );
    return NextResponse.json(
      { error: 'Webhook authentication is not configured.' },
      { status: 503 },
    );
  }

  const supplied = req.headers.get('authorization');
  if (!supplied || !safeEqual(supplied, expected)) {
    // Deliberately no detail about which part failed, and the value is never logged.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // HMAC verification (Sprint 2) — additive defense in depth, OFF by default.
  // See lib/revenueCatHmac.ts for why this is gated behind an unset-by-default
  // env var rather than enabled: the exact header/algorithm were not
  // independently verified against RevenueCat's current live docs from this
  // environment. When REVENUECAT_HMAC_SECRET is unset, `checked` is false and
  // this is a complete no-op — the Authorization header check above remains
  // the sole auth mechanism, exactly as before this change.
  //
  // Read as raw text FIRST: HMAC needs the exact original bytes, and
  // req.json() would consume the stream before a signature could be computed
  // over it. Re-parsing this string below is the ONLY JSON parse — never
  // re-serialize-then-hash, which would silently break the signature.
  const rawBody = await req.text();
  const hmacResult = verifyRevenueCatHmac(rawBody, req.headers.get(HMAC_SIGNATURE_HEADER));
  if (hmacResult.checked && !hmacResult.valid) {
    console.error(`[revenuecat] HMAC verification failed: ${hmacResult.reason}`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = ((): { event?: RcEvent } | null => {
    try { return JSON.parse(rawBody) as { event?: RcEvent }; } catch { return null; }
  })();
  const ev = body?.event;
  if (!ev?.type) return NextResponse.json({ ok: true, skipped: 'no event' });

  // Ignore test/non-actionable event types we don't handle.
  if (!GRANT_EVENTS.has(ev.type) && !REVOKE_EVENTS.has(ev.type)) {
    return NextResponse.json({ ok: true, ignored: ev.type });
  }

  const user = await resolveUser(ev);
  if (!user) {
    console.error('[revenuecat] no matching user for app_user_id:', ev.app_user_id);
    // 200 so RevenueCat doesn't retry forever on an unmatched id.
    return NextResponse.json({ ok: true, unmatched: true });
  }

  // Idempotency (Sprint 2). RevenueCat delivers at-least-once, so the same
  // event.id can arrive more than once — without this, a duplicate delivery
  // re-ran every side effect (a second welcome email, a second getaway
  // offer, a second push) for the same purchase. See lib/revenueCatEvents.ts
  // for the claim/status model, including how a crash mid-processing is
  // safely retried rather than either repeated or permanently dropped.
  //
  // event.id IS CONFIRMED — post-Sprint-2 Revision 1: independently checked
  // against RevenueCat's current documentation, `event.id` is an
  // always-present field on every webhook event, and RevenueCat explicitly
  // recommends using it for dedup. The earlier "not independently verified"
  // caveat is removed.
  //
  // Because the id is now guaranteed by the provider's contract, a GRANT or
  // REVOKE event arriving WITHOUT one is anomalous, not an expected legacy
  // case — it no longer falls through to processing unconditionally.
  // Fail-safe instead: skip the grant/revoke, log it loudly, and return 200
  // (not 5xx — RevenueCat would just retry the same malformed payload).
  // Silently granting or revoking Pro from a payload that doesn't match the
  // provider's own documented shape is a worse failure mode than a rare
  // dropped event, especially given this endpoint can grant paid access.
  if (!ev.id) {
    console.error(`[revenuecat] actionable event (${ev.type}) for ${user.email} has NO event.id — this contradicts RevenueCat's documented contract (id is always present). Skipping to avoid processing an unverifiable/malformed payload.`);
    return NextResponse.json({ ok: true, skipped: 'missing_event_id' });
  }
  const claim = await claimEvent(ev.id, ev.type, user.id);
  if (claim.outcome !== 'claimed') {
    console.log(`[revenuecat] ${ev.type} for ${user.email} — ${claim.outcome}, skipping side effects`);
    return NextResponse.json({ ok: true, duplicate: true });
  }
  const claimToken = claim.claimToken;

  try {
    if (GRANT_EVENTS.has(ev.type)) {
      const interval: 'monthly' | 'lifetime' =
        ev.product_id === LIFETIME_PRODUCT ? 'lifetime' : 'monthly';
      // Deliberately NOT passing `interval` as the top-level Stripe param —
      // that would write it into `stripeInterval`, GasCap's Stripe/gift-only
      // provenance field, corrupting it with a RevenueCat value. Only the
      // `revenueCat` sub-object is populated; see setUserPlan's doc comment
      // and lib/entitlements.ts for the provenance-separation invariant this
      // depends on (ChatGPT Sprint 2 Revision 1 finding — provenance
      // corruption).
      await setUserPlan(user.id, 'pro', { revenueCat: { active: true, interval, productId: ev.product_id } });
      console.log(`[revenuecat] ${ev.type} → granted Pro (${interval}) to ${user.email}`);
      // First grant only (idempotent): welcome email + paid nurture, mirroring the
      // Stripe path so IAP buyers also get an upgrade-confirmation email.
      // Kept alongside the event-id claim above as defense in depth — this
      // check is against durable USER state, the claim is against the EVENT;
      // either one alone would have caught the reported duplicate-send risk.
      if (INITIAL_GRANT_EVENTS.has(ev.type) && !user.paidCampaignEnrolledAt) {
        await enrollPaidCampaign(user.id, interval)
          .catch((e) => console.error('[revenuecat] paid-campaign enroll failed:', e));
        sendPaidCampaignEmail('P1', {
          id: user.id, name: user.name, email: user.email, tier: 'pro', interval,
        }).catch((e) => console.error('[revenuecat] P1 welcome send failed:', e));
        // Bonus welcome push alongside the P1 email (app users w/ notifications).
        sendUserPush(
          user.id,
          "You're officially GasCap™ Pro 🎉",
          'Welcome! Your Pro features are unlocked — tap to start tracking your fill-ups.',
          '/',
        ).catch(() => { /* best-effort */ });
      }
      // Lifetime buyers earn the complimentary getaway during the active promo.
      if (interval === 'lifetime') await maybeSendGetaway(user, ev.type);
    } else {
      // EXPIRATION / REFUND → recompute aggregate entitlement rather than
      // unconditionally reverting to free (Sprint 2 — see lib/entitlements.ts).
      // A RevenueCat-side revocation must never wipe a DIFFERENT provider's
      // legitimate grant (Stripe Lifetime, a gift, Ambassador Pro-for-Life).
      await revokeRevenueCatEntitlement(user.id);
      console.log(`[revenuecat] ${ev.type} → cleared RevenueCat entitlement for ${user.email} (plan recalculated)`);
    }
    await markProcessed(ev.id, claimToken);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[revenuecat] grant/revoke failed:', e);
    await markFailed(ev.id, claimToken, e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

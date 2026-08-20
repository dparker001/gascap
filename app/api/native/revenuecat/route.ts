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
import { setUserPlan, findById, findByEmail, enrollPaidCampaign, revokeRevenueCatEntitlement, syncRevenueCatEntitlementFromProvider, type StoredUser } from '@/lib/users';
import { prisma } from '@/lib/prisma';
import { sendMail } from '@/lib/email';
import { sendPaidCampaignEmail } from '@/lib/emailCampaignPaid';
import { sendUserPush } from '@/lib/userPush';
import { getawayPromoActive, GETAWAY_DISCLOSURE } from '@/lib/getawayPromo';
import { claimEvent, markProcessed, markFailed } from '@/lib/revenueCatEvents';
import { verifyRevenueCatHmac, HMAC_SIGNATURE_HEADER } from '@/lib/revenueCatHmac';
import { fetchAuthoritativeRevenueCatState } from '@/lib/revenueCatApi';
import { recordAnalyticsEvent, type OriginPlatform } from '@/lib/analyticsEvents';

export const dynamic = 'force-dynamic';

const LIFETIME_PRODUCT = 'gascap_pro_lifetime';
const MONTHLY_PRODUCT  = 'gascap_pro_monthly';

/**
 * Growth Sprint 1, P0B — production-only purchase_completed classifier.
 *
 * Fail-closed by design: every ambiguous or unconfirmed case returns null
 * (no analytics event), never a guess. GasCap's internal 30-day trial
 * (grantNewSignupProTrial) is a SEPARATE mechanism from RevenueCat's own
 * period_type=TRIAL/is_trial_conversion — this classifier does not use
 * either of those RC fields to detect GasCap's trial (see
 * wasOnGasCapTrial, captured separately from the resolved user's own
 * isProTrial before the grant clears it).
 *
 * - environment must be exactly 'PRODUCTION' — SANDBOX (or any other/missing
 *   value) is fully excluded, not tagged-and-included, per the explicit
 *   fail-closed requirement: a sandbox/test transaction must never enter
 *   the same aggregate purchase_completed count real revenue is measured
 *   against.
 * - Monthly requires INITIAL_PURCHASE + the exact monthly product id +
 *   period_type === 'NORMAL'. A missing/other period_type (TRIAL, INTRO, or
 *   simply absent) is excluded — undercounting a genuine edge case is a far
 *   smaller cost than counting a trial start as a paid conversion.
 * - Lifetime requires NON_RENEWING_PURCHASE + the exact lifetime product id.
 *   period_type is not required for Lifetime (NON_RENEWING_PURCHASE has no
 *   renewal concept), but is not ignored either — see the guard below.
 */
function classifyRevenueCatPurchase(ev: RcEvent): 'monthly' | 'lifetime' | null {
  if (ev.environment !== 'PRODUCTION') return null;

  if (ev.type === 'INITIAL_PURCHASE' && ev.product_id === MONTHLY_PRODUCT && ev.period_type === 'NORMAL') {
    return 'monthly';
  }
  if (ev.type === 'NON_RENEWING_PURCHASE' && ev.product_id === LIFETIME_PRODUCT) {
    return 'lifetime';
  }
  return null;
}

/**
 * Explicit mapping only — never a heuristic. Any store value other than the
 * two confirmed here (APP_STORE from real GasCap payload evidence;
 * PLAY_STORE per RevenueCat's documented enum, not yet observed in a real
 * GasCap payload) resolves to 'unknown', including MAC_APP_STORE — not
 * mapped in this change per explicit instruction, since no current project
 * evidence requires it.
 */
const STORE_TO_ORIGIN_PLATFORM: Record<string, OriginPlatform> = {
  APP_STORE:  'ios',
  PLAY_STORE: 'android',
};

function resolveOriginPlatform(store: string | undefined): OriginPlatform {
  return (store && STORE_TO_ORIGIN_PLATFORM[store]) || 'unknown';
}

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

/**
 * POST-REVISION-2 EVENT MODEL — rewritten against RevenueCat's actual
 * documented event contract, independently rechecked. The Revision 2
 * assumptions here were wrong in several ways; each is corrected below with
 * the reasoning, not just the new set membership.
 *
 * Straightforward grant events — `product_id` is trustworthy for these, the
 * purchase/renewal is confirmed and immediately effective.
 */
const GRANT_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',   // lifetime (non-consumable)
  'UNCANCELLATION',
]);
// First-time grant events → trigger the welcome email + getaway (once).
const INITIAL_GRANT_EVENTS = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE']);

// Straightforward revoke events. `REFUND` is kept defensively — RevenueCat's
// current documentation reports a typical support-initiated refund via
// CANCELLATION with cancel_reason=CUSTOMER_SUPPORT (see the CANCELLATION
// handling below), not a distinct lifecycle REFUND event, so this branch may
// rarely or never fire in practice. It's harmless to keep: if RevenueCat
// ever does send a literal `REFUND` type, revoking is still the correct
// response.
const REVOKE_EVENTS = new Set(['EXPIRATION', 'REFUND']);

// A reversed refund restores whatever was refunded.
//
// Post-Sprint-2 Revision 4 fix: previously trusted the event's product_id
// (the same mechanism as GRANT_EVENTS). Now uses the same authoritative
// RevenueCat state-sync helper as CANCELLATION/TRANSFER
// (`syncRevenueCatEntitlementFromProvider`) instead — architecturally
// consistent with those, and doesn't rely on product_id being reliable for
// this event either. Never sends a welcome email / getaway offer — the user
// already had this entitlement before the erroneous refund, so that would
// be confusing, not helpful.
const RESTORE_EVENTS = new Set(['REFUND_REVERSED']);

// CANCELLATION and TRANSFER are handled by dedicated branches below, not the
// generic grant/revoke sets — see the POST handler. PRODUCT_CHANGE is
// deliberately NOT actionable at all (falls through to `ignored`) — see the
// comment at its check.
const ACTIONABLE_EVENTS = new Set([
  ...GRANT_EVENTS, ...REVOKE_EVENTS, ...RESTORE_EVENTS, 'CANCELLATION', 'TRANSFER',
]);

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
  id?:                    string;
  type?:                  string;
  app_user_id?:           string;
  original_app_user_id?:  string;
  aliases?:               string[];
  product_id?:            string;
  // CANCELLATION-specific: RevenueCat's documented reason code. Only
  // 'CUSTOMER_SUPPORT' is treated as a revoke trigger here — see the
  // CANCELLATION branch in the POST handler for why the others are not.
  cancel_reason?:         string;
  // TRANSFER-specific — the REAL documented shape (arrays of app_user_ids
  // whose entitlements moved), not `app_user_id`/`product_id` as an earlier
  // revision incorrectly assumed. See the TRANSFER branch below.
  transferred_from?:      string[];
  transferred_to?:        string[];
  // PRODUCT_CHANGE-specific, unused by this handler (PRODUCT_CHANGE is not
  // actionable — see its comment) but documented here for completeness:
  // RevenueCat's docs state `product_id` on a PRODUCT_CHANGE event may
  // represent the OLD product for a deferred change, with the future
  // product in `new_product_id` instead.
  new_product_id?:        string;
  // Growth Sprint 1, P0B — purchase_completed analytics classifier fields.
  // Added only because each is actually read by the classifier/metadata
  // below; not added speculatively. See the classifier comment near
  // classifyRevenueCatPurchase() for what each one gates.
  store?:                 string;
  period_type?:           string;
  environment?:           string;
  price?:                 number;
  currency?:              string;
}

/** Resolve a GasCap user from a list of candidate RevenueCat app_user_ids. */
async function resolveUserByIds(candidates: (string | undefined)[]) {
  const ids = candidates.filter((v): v is string => !!v);
  for (const c of ids) {
    const byId = await findById(c);
    if (byId) return byId;
  }
  // Fallback: some setups use email as the app_user_id.
  for (const c of ids) {
    if (c.includes('@')) {
      const byEmail = await findByEmail(c);
      if (byEmail) return byEmail;
    }
  }
  return undefined;
}

/** Resolve the GasCap user from RevenueCat's app_user_id (we set it = userId). */
async function resolveUser(ev: RcEvent) {
  return resolveUserByIds([ev.app_user_id, ev.original_app_user_id, ...(ev.aliases ?? [])]);
}

/**
 * Post-Sprint-2 Revision 4 fix — TRANSFER handling, rewritten entirely
 * against RevenueCat's actual documented contract: a TRANSFER moves
 * transactions/entitlements AWAY FROM every identity in `transferred_from`
 * and ADDS them TO every identity in `transferred_to`. The previous
 * revision granted the destination a conservative "monthly" guess and left
 * the source(s) untouched — this replaces both with authoritative
 * RevenueCat state for every resolvable GasCap identity on both sides.
 *
 * ORDERING GUARANTEE — gather before mutate: every RevenueCat lookup for
 * every involved identity happens FIRST, before any GasCap user is
 * mutated. If ANY required lookup fails, this function throws before
 * touching the database at all, so a partial-lookup failure can never
 * leave one user updated with authoritative data while another is left in
 * a guessed or stale state. The caller (POST) catches this exactly like
 * every other event-handling failure: the event is marked failed and the
 * response is 500, so RevenueCat retries the whole TRANSFER cleanly rather
 * than resuming from a half-applied state.
 *
 * Not wrapped in a single all-or-nothing SQL transaction (this codebase has
 * no existing multi-row `$transaction` usage to build on, and every
 * individual mutation below — via `syncRevenueCatEntitlementFromProvider`/
 * `revokeRevenueCatEntitlement` — is itself idempotent and safe to re-run).
 * A crash between mutating two different users' rows would leave a
 * genuinely correct (not guessed) partial state for whichever rows were
 * already written, and a retry of the same event would safely re-derive
 * and re-apply the same actions to the rest.
 */
async function handleTransfer(ev: RcEvent): Promise<Response> {
  const fromIds = ev.transferred_from ?? [];
  const toIds   = ev.transferred_to   ?? [];
  const allIds  = [...new Set([...fromIds, ...toIds])];

  const resolvedById = new Map<string, StoredUser>(); // keyed by the RC app_user_id from the event, not the GasCap user id
  for (const id of allIds) {
    const u = await resolveUserByIds([id]);
    if (u) resolvedById.set(id, u);
  }

  if (resolvedById.size === 0) {
    console.error('[revenuecat] TRANSFER — no resolvable GasCap identities in transferred_from/transferred_to:', fromIds, toIds);
    return NextResponse.json({ ok: true, unmatched: true });
  }

  if (!ev.id) {
    console.error(`[revenuecat] TRANSFER has NO event.id — this contradicts RevenueCat's documented contract (id is always present). Skipping to avoid processing an unverifiable/malformed payload.`);
    return NextResponse.json({ ok: true, skipped: 'missing_event_id' });
  }

  // The claim is keyed on the event, not any one user — the `userId`
  // parameter is purely informational for the claim row's own log, so any
  // one resolved identity is a fine choice.
  const anyResolvedUser = [...resolvedById.values()][0];
  const claim = await claimEvent(ev.id, ev.type ?? 'TRANSFER', anyResolvedUser.id);
  if (claim.outcome !== 'claimed') {
    console.log(`[revenuecat] TRANSFER for event ${ev.id} — ${claim.outcome}, skipping side effects`);
    return NextResponse.json({ ok: true, duplicate: true });
  }
  const claimToken = claim.claimToken;

  try {
    // STEP 1 — gather authoritative state for every resolvable identity on
    // EITHER side, before mutating anything. Deduped by GasCap user id
    // (not RC app_user_id) since resolveUserByIds already handles alias
    // resolution and two different RC ids could resolve to the same
    // GasCap account.
    const statesByGcUserId = new Map<string, Awaited<ReturnType<typeof fetchAuthoritativeRevenueCatState>>>();
    for (const rcAppUserId of resolvedById.keys()) {
      const gcUser = resolvedById.get(rcAppUserId)!;
      if (statesByGcUserId.has(gcUser.id)) continue; // already looked up via another alias
      // Throws on failure — intentionally uncaught here, propagates to the
      // outer catch below, which marks the event failed (not processed)
      // and returns 500 so RevenueCat retries rather than this function
      // proceeding to mutate anyone on unverifiable information.
      statesByGcUserId.set(gcUser.id, await fetchAuthoritativeRevenueCatState(rcAppUserId));
    }

    const destinationGcUserIds = new Set(
      toIds.map((id) => resolvedById.get(id)?.id).filter((v): v is string => !!v),
    );
    const sourceGcUserIds = new Set(
      fromIds.map((id) => resolvedById.get(id)?.id).filter((v): v is string => !!v),
    );

    // STEP 2 — mutate. Destinations first: persist EXACTLY what RevenueCat
    // says, never a guessed interval.
    for (const gcUserId of destinationGcUserIds) {
      const state = statesByGcUserId.get(gcUserId)!;
      if (state.active) {
        await setUserPlan(gcUserId, 'pro', {
          revenueCat: { active: true, interval: state.interval as 'monthly' | 'lifetime', productId: state.productId ?? undefined },
        });
        console.log(`[revenuecat] TRANSFER → destination ${gcUserId} granted Pro (${state.interval}, authoritative RC state) — no guessing`);
      } else {
        console.log(`[revenuecat] TRANSFER → destination ${gcUserId} has no active RC entitlement per authoritative lookup; no grant applied.`);
      }
    }

    // Sources: only clear if this identity ISN'T also a destination in the
    // same event (rare, but don't clear-then-immediately-need-to-re-add),
    // and only if RevenueCat confirms the entitlement is genuinely gone —
    // clearing only ever touches RC's own contribution
    // (revokeRevenueCatEntitlement), so a surviving Stripe/gift/Ambassador
    // source on the source identity is never affected.
    for (const gcUserId of sourceGcUserIds) {
      if (destinationGcUserIds.has(gcUserId)) continue;
      const state = statesByGcUserId.get(gcUserId)!;
      if (!state.active) {
        await revokeRevenueCatEntitlement(gcUserId);
        console.log(`[revenuecat] TRANSFER → source ${gcUserId} no longer has an active RC entitlement; RC contribution cleared, aggregate recomputed.`);
      } else {
        console.log(`[revenuecat] TRANSFER → source ${gcUserId} still shows an active RC entitlement per authoritative lookup; left untouched.`);
      }
    }

    await markProcessed(ev.id, claimToken);
    return NextResponse.json({
      ok: true,
      transferred: { from: [...sourceGcUserIds], to: [...destinationGcUserIds] },
    });
  } catch (e) {
    console.error('[revenuecat] TRANSFER handling failed:', e);
    await markFailed(ev.id, claimToken, e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
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

  // PRODUCT_CHANGE is deliberately NOT actionable — post-Revision-2 fix.
  // RevenueCat's documentation states the new subscription from a
  // PRODUCT_CHANGE may not be effective immediately: for a deferred change,
  // `product_id` can represent the OLD (still-active) product, with the
  // future product in `new_product_id`. Guessing an interval from this
  // event's product_id risks granting/recording the WRONG interval before
  // the change has actually taken effect. Rather than build a live
  // RevenueCat customer-state API integration (not present in this
  // codebase) just to resolve that ambiguity, this waits for the
  // corresponding lifecycle event instead — an immediate change arrives
  // with its own RENEWAL/INITIAL_PURCHASE-shaped confirmation, and a
  // deferred change is confirmed by the eventual RENEWAL when it actually
  // takes effect. Logged as ignored, not silently dropped.
  if (ev.type === 'PRODUCT_CHANGE') {
    console.info(`[revenuecat] PRODUCT_CHANGE ignored (product_id may not reflect the effective product yet — waiting for the confirming lifecycle event instead of guessing). app_user_id=${ev.app_user_id}`);
    return NextResponse.json({ ok: true, ignored: ev.type });
  }

  // Ignore test/other event types we don't handle.
  if (!ACTIONABLE_EVENTS.has(ev.type)) {
    return NextResponse.json({ ok: true, ignored: ev.type });
  }

  // TRANSFER has a genuinely different payload shape (transferred_from/
  // transferred_to arrays, potentially multiple GasCap identities on either
  // side) AND a genuinely different reconciliation model (both sides need
  // authoritative RevenueCat state, gathered before any GasCap mutation —
  // see handleTransfer's own doc comment) — routed to its own handler
  // entirely separate from the single-user model the rest of this function
  // uses, rather than shoehorned into it.
  if (ev.type === 'TRANSFER') {
    return handleTransfer(ev);
  }

  const user = await resolveUser(ev);
  if (!user) {
    console.error('[revenuecat] no matching user for event:', ev.type, ev.app_user_id ?? ev.transferred_to);
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
  // Stable, non-optional bindings for the closure below — `user`/`ev` are
  // already validated non-null above, but TS can't carry that narrowing
  // into a nested function declaration.
  const resolvedUser = user;
  const resolvedEv   = ev;
  // Growth Sprint 1, P0B — must be captured HERE, before doGrant()/
  // setUserPlan() ever runs, since the grant unconditionally clears
  // isProTrial/trialExpiresAt. Refers ONLY to GasCap's own internal 30-day
  // trial (grantNewSignupProTrial) — never derived from RevenueCat's
  // period_type/is_trial_conversion, which describe a different, currently
  // unused Apple/Google-native trial lifecycle.
  const wasOnGasCapTrial = resolvedUser.isProTrial === true;

  /**
   * Grant path for GRANT_EVENTS — trusts product_id (a genuine
   * INITIAL_PURCHASE/RENEWAL/NON_RENEWING_PURCHASE/UNCANCELLATION always
   * carries reliable product info per RevenueCat's docs). `sendWelcome`
   * controls whether this counts as a first-time grant for welcome-email/
   * getaway purposes.
   */
  async function doGrant(interval: 'monthly' | 'lifetime', productId: string | undefined, sendWelcome: boolean) {
    const user = resolvedUser;
    const ev   = resolvedEv;
    // Deliberately NOT passing `interval` as the top-level Stripe param —
    // that would write it into `stripeInterval`, GasCap's Stripe/gift-only
    // provenance field, corrupting it with a RevenueCat value. Only the
    // `revenueCat` sub-object is populated; see setUserPlan's doc comment
    // and lib/entitlements.ts for the provenance-separation invariant this
    // depends on (Sprint 2 Revision 1 finding — provenance corruption).
    await setUserPlan(user.id, 'pro', { revenueCat: { active: true, interval, productId } });
    console.log(`[revenuecat] ${ev.type} → granted Pro (${interval}) to ${user.email}`);

    // ── Growth Sprint 1, P0B — first-party purchase_completed analytics ──
    // Entitlement has already completed successfully above — this write is
    // strictly additive. Isolated in its own try/catch so an analytics
    // failure can NEVER cause markFailed()/a retry — the outer handler's
    // try/catch exists to retry genuine entitlement failures, and this must
    // never trigger it. See classifyRevenueCatPurchase() for the full
    // fail-closed rationale (production-only, exact product id, exact
    // period_type for monthly).
    const billing = classifyRevenueCatPurchase(ev);
    if (billing) {
      try {
        const result = await recordAnalyticsEvent({
          eventType:      'purchase_completed',
          originPlatform: resolveOriginPlatform(ev.store),
          emitter:        'webhook',
          userId:         user.id,
          provider:       'revenuecat',
          billing,
          source:         'revenuecat_iap',
          idempotencyKey: `revenuecat:${ev.id}`,
          metadata: {
            productId: ev.product_id,
            wasOnGasCapTrial,
            environment: ev.environment,
            ...(typeof ev.price === 'number' ? { price: ev.price } : {}),
            ...(ev.currency ? { currency: ev.currency } : {}),
          },
        });
        console.log(`[GasCap analytics] RevenueCat purchase_completed ${result.outcome} for event ${ev.id}`);
      } catch (err) {
        // Analytics failure must never affect entitlement, markProcessed,
        // or cause RevenueCat to retry this event. Logged only.
        console.error('[GasCap analytics] RevenueCat purchase event write failed:', err);
      }
    }

    if (sendWelcome && !user.paidCampaignEnrolledAt) {
      // Growth Sprint 1, P0B provenance fix — enrollPaidCampaign used to
      // unconditionally write `interval` into stripeInterval regardless of
      // caller, silently violating the exact provenance invariant the
      // comment above this function already documents. persistStripeProvenance:
      // false keeps paid-campaign enrollment (step/timestamp/nurture email)
      // unchanged while guaranteeing this RevenueCat-sourced interval never
      // reaches stripeInterval.
      await enrollPaidCampaign(user.id, interval, { persistStripeProvenance: false })
        .catch((e) => console.error('[revenuecat] paid-campaign enroll failed:', e));
      sendPaidCampaignEmail('P1', {
        id: user.id, name: user.name, email: user.email, tier: 'pro', interval,
      }).catch((e) => console.error('[revenuecat] P1 welcome send failed:', e));
      sendUserPush(
        user.id,
        "You're officially GasCap™ Pro 🎉",
        'Welcome! Your Pro features are unlocked — tap to start tracking your fill-ups.',
        '/',
      ).catch(() => { /* best-effort */ });
    }
    if (interval === 'lifetime') await maybeSendGetaway(user, ev.type ?? '');
  }

  try {
    if (GRANT_EVENTS.has(ev.type)) {
      const interval: 'monthly' | 'lifetime' =
        ev.product_id === LIFETIME_PRODUCT ? 'lifetime' : 'monthly';
      // First grant only (idempotent): welcome email + paid nurture, mirroring the
      // Stripe path so IAP buyers also get an upgrade-confirmation email.
      // Kept alongside the event-id claim above as defense in depth — this
      // check is against durable USER state, the claim is against the EVENT;
      // either one alone would have caught the reported duplicate-send risk.
      await doGrant(interval, ev.product_id, INITIAL_GRANT_EVENTS.has(ev.type));

    } else if (RESTORE_EVENTS.has(ev.type)) {
      // REFUND_REVERSED — post-Revision-4 fix: uses the same authoritative
      // RevenueCat state-sync as CANCELLATION/TRANSFER instead of trusting
      // product_id. Never sends a welcome email / getaway offer — the user
      // already had this entitlement before the erroneous refund.
      await syncRevenueCatEntitlementFromProvider(user.id);
      console.log(`[revenuecat] REFUND_REVERSED → synced RevenueCat entitlement for ${user.email} against authoritative state (plan recalculated)`);

    } else if (ev.type === 'CANCELLATION') {
      // Post-Revision-4 fix — RevenueCat's docs explicitly warn that
      // cancel_reason=CUSTOMER_SUPPORT does not necessarily mean the
      // subscription's auto-renewal preference was deactivated, and
      // instruct clients to check current subscription status rather than
      // assume revocation. Replaced the previous unconditional
      // revokeRevenueCatEntitlement() with a live authoritative-state sync
      // — if RevenueCat still shows the entitlement active, it's persisted
      // exactly as-is (not silently revoked on a signal that turned out not
      // to mean what it looked like); only if RevenueCat confirms inactive
      // is the RC contribution cleared and the aggregate recomputed.
      //
      // Any OTHER cancel_reason (UNSUBSCRIBE, etc.) is still the existing
      // no-op — auto-renew off is not loss of access; that's EXPIRATION's
      // job. Unchanged from Revision 2/3.
      if (ev.cancel_reason === 'CUSTOMER_SUPPORT') {
        // syncRevenueCatEntitlementFromProvider THROWS on a lookup failure
        // (deliberately not caught here) — propagates to the outer catch,
        // which marks the event failed and returns 500 so RevenueCat
        // retries, rather than guessing at a state we couldn't confirm.
        await syncRevenueCatEntitlementFromProvider(user.id);
        console.log(`[revenuecat] CANCELLATION (cancel_reason=CUSTOMER_SUPPORT) → synced RevenueCat entitlement for ${user.email} against authoritative state (plan recalculated)`);
      } else {
        console.log(`[revenuecat] CANCELLATION (cancel_reason=${ev.cancel_reason ?? 'unknown'}) — auto-renew off, access continues until EXPIRATION. No action taken.`);
      }

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
    console.error('[revenuecat] event handling failed:', e);
    await markFailed(ev.id, claimToken, e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

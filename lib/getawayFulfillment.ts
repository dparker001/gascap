/**
 * Getaway fulfillment — the 72-hour verification hold (2026-08-25, revised
 * same day after direct Marketing Boost support confirmation).
 *
 * WHY 72 HOURS, NOT 7 DAYS: this is a GasCap-only fraud/refund safeguard —
 * never described as an Apple-required wait or the point an Apple purchase
 * becomes "final" (Apple provides no guaranteed final-refund date). It
 * exists because Marketing Boost confirmed directly: once a certificate is
 * sent, GasCap/the sender has NO API to cancel, void, deactivate, or
 * retract it — even before the recipient activates it. That makes delaying
 * the irreversible external send GasCap's only dependable technical
 * safeguard against an immediate purchase → voucher → refund abuse pattern.
 * Lifetime APP ACCESS and the DESTINATION PICKER are never held — a buyer
 * sees and can pick their destination immediately; only the actual
 * Marketing Boost certificate SEND is delayed.
 *
 * Marketing Boost's OWN separate terms (confirmed directly, not GasCap's
 * hold): once a certificate is received, the recipient has 7 days to
 * activate it (pay taxes/fees), then 18 months to use it, with 30 days'
 * advance notice required before travel. That 7-day figure is Marketing
 * Boost's activation window, unrelated to and not to be confused with
 * GasCap's 72-hour pre-send verification hold.
 *
 * The GasCap DB alone is NOT trusted as proof of continued entitlement at
 * the end of the hold: the DB can be stale if a RevenueCat webhook was
 * delayed, retried, or (rarely) missed. Immediately before ANY fulfillment
 * attempt for an account whose Lifetime provenance is RevenueCat, this
 * module re-queries RevenueCat's own authoritative API and runs the result
 * through the SAME reconcileRevenueCatState() choke point every other
 * RevenueCat grant path uses — so the existing cross-account ownership
 * guard, single-snapshot behavior, and stripeInterval provenance rule all
 * apply here unchanged. A non-RevenueCat Lifetime (Stripe/gift/Ambassador)
 * is NOT re-verified against RevenueCat — that would be meaningless — its
 * own webhook already keeps the DB authoritative for it.
 *
 * getawayFulfillmentStatus stays exactly 'pending' | 'sent' | 'manual_required'
 * — unchanged from before this file existed. Qualification revocation is a
 * SEPARATE, durable, auditable marker (getawayQualificationRevokedAt) so the
 * external-send state machine and its ambiguity protections are untouched.
 */
import { prisma } from './prisma';
import { hasLifetimeEntitlement } from './entitlements';
import {
  fetchAuthoritativeRevenueCatState, isSandboxTestAccount,
} from './revenueCatApi';
import {
  reconcileRevenueCatState, CrossAccountLifetimeOwnershipError, UnverifiableLifetimeOwnershipError,
} from './users';
import { sendMail } from './email';
import { findGetawayDestination, GETAWAY_DISCLOSURE } from './getawayPromo';
import { sendVacationIncentive, type VacationIncentiveOutcome } from './marketingBoost';

// Field name kept as getawayHoldUntil (schema-stable) even though the
// duration changed from the originally-proposed 7 days to 72 hours.
export const GETAWAY_HOLD_HOURS = 72;

interface GetawayFulfillmentRow {
  id: string; email: string; name: string;
  stripeInterval: string | null;
  ambassadorProForLife: boolean;
  revenueCatActive: boolean;
  revenueCatInterval: string | null;
  getawayDestinationId: string | null;
  getawayFulfillmentStatus: string | null;
  getawayHoldUntil: string | null;
  getawayQualificationRevokedAt: string | null;
}

const GETAWAY_ROW_SELECT = {
  id: true, email: true, name: true,
  stripeInterval: true, ambassadorProForLife: true,
  revenueCatActive: true, revenueCatInterval: true,
  getawayDestinationId: true, getawayFulfillmentStatus: true,
  getawayHoldUntil: true, getawayQualificationRevokedAt: true,
} as const;

function notifyAdmin(opts: { subject: string; html: string; text: string }) {
  sendMail({ to: 'info@gascap.app', ...opts })
    .catch((e) => console.error('[GasCap] Getaway admin notify failed:', e));
}

/**
 * Stamp the 72-hour hold at the moment a qualifying Lifetime grant is
 * processed. Idempotent — the conditional WHERE (getawayHoldUntil IS NULL)
 * means a webhook retry for the same grant can never push the clock
 * forward. Safe to call unconditionally from any Lifetime grant path.
 */
export async function stampGetawayHoldUntil(userId: string): Promise<void> {
  const holdUntil = new Date(Date.now() + GETAWAY_HOLD_HOURS * 60 * 60 * 1000).toISOString();
  await prisma.user.updateMany({
    where: { id: userId, getawayHoldUntil: null },
    data:  { getawayHoldUntil: holdUntil },
  });
}

/**
 * Re-reads the user's CURRENT durable state and, if no qualifying Lifetime
 * source remains at all, stamps getawayQualificationRevokedAt — but only
 * when there's an actual unfulfilled getaway record to protect (a
 * destination chosen, status not yet 'sent', not already marked revoked).
 * An already-'sent' record is NEVER touched by this function — see the
 * module doc and app/api/getaway/choose/route.ts's existing state machine.
 * Call this after ANY reconciliation that could have reduced entitlement
 * (RevenueCat EXPIRATION/REFUND, CANCELLATION-confirmed-inactive, a TRANSFER
 * source losing its grant).
 */
export async function maybeRevokeGetawayQualification(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: GETAWAY_ROW_SELECT });
  if (!user) return;
  if (!user.getawayDestinationId) return;
  if (user.getawayQualificationRevokedAt) return;
  if (user.getawayFulfillmentStatus === 'sent') return; // never touch a completed send

  const stillQualifies = hasLifetimeEntitlement({
    stripeInterval:     user.stripeInterval,
    revenueCatActive:   user.revenueCatActive,
    revenueCatInterval: user.revenueCatInterval,
  }) || user.ambassadorProForLife;
  if (stillQualifies) return;

  const revoked = await prisma.user.updateMany({
    where: {
      id: userId, getawayQualificationRevokedAt: null,
      getawayFulfillmentStatus: { in: ['pending', 'manual_required'] },
    },
    data: { getawayQualificationRevokedAt: new Date().toISOString() },
  });
  if (revoked.count > 0) {
    console.error(`[GasCap] Getaway qualification revoked for ${user.email} — qualifying Lifetime no longer active. Marketing Boost fulfillment permanently blocked for this record.`);
    notifyAdmin({
      subject: `🚫 Getaway qualification revoked (refund/revocation) → ${user.email}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
        <p style="font-size:16px;margin:0 0 8px;color:#b91c1c;">🚫 The qualifying Lifetime purchase for <strong>${user.email}</strong> was refunded/revoked before their getaway certificate was fulfilled. No certificate will be sent.</p>
      </div>`,
      text: `Getaway qualification revoked (refund/revocation) for ${user.email} — no certificate will be sent.`,
    });
  }
}

export type AttemptFulfillmentOutcome =
  | { outcome: 'sent';            destination: string }
  | { outcome: 'manual_required'; destination: string }
  | { outcome: 'ambiguous';       destination: string }
  | { outcome: 'not_ready'; reason: 'no_destination' | 'not_pending' | 'hold_not_elapsed' | 'qualification_revoked' | 'entitlement_lost' | 'provider_unverifiable' };

function holdElapsed(row: GetawayFulfillmentRow): boolean {
  // Null getawayHoldUntil = granted before this feature shipped — grandfathered
  // in as already-satisfied rather than blocking existing members forever.
  if (!row.getawayHoldUntil) return true;
  const t = Date.parse(row.getawayHoldUntil);
  return Number.isNaN(t) || t <= Date.now();
}

/**
 * The ONLY path that may call Marketing Boost. Re-reads the user's current
 * durable row itself (never trusts a caller-supplied snapshot) and enforces,
 * in order: a destination exists, qualification hasn't been revoked, status
 * is still 'pending', the 72-hour hold has elapsed, and — for a RevenueCat-
 * provenance Lifetime specifically — a fresh authoritative RevenueCat
 * re-verification through reconcileRevenueCatState() (same ownership guard,
 * same single-snapshot behavior as every other grant path). A Stripe/gift/
 * Ambassador Lifetime is NOT re-verified against RevenueCat — its own
 * webhook already keeps the DB authoritative for it; a RevenueCat lookup
 * would be meaningless there and this never writes RevenueCat state into
 * Stripe provenance.
 *
 * If the RevenueCat lookup fails, is ambiguous, or the reconciled state
 * shows the Lifetime purchase belongs to a different GasCap identity
 * (CrossAccountLifetimeOwnershipError) or has no provable owner
 * (UnverifiableLifetimeOwnershipError) — NEVER send. The record is left
 * exactly as it was (still 'pending') for the next scheduled run / manual
 * review; provider unavailability is never interpreted as entitlement
 * validity.
 */
export async function attemptGetawayFulfillment(userId: string): Promise<AttemptFulfillmentOutcome> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: GETAWAY_ROW_SELECT });
  if (!user || !user.getawayDestinationId) return { outcome: 'not_ready', reason: 'no_destination' };
  if (user.getawayQualificationRevokedAt) return { outcome: 'not_ready', reason: 'qualification_revoked' };
  if (user.getawayFulfillmentStatus !== 'pending') return { outcome: 'not_ready', reason: 'not_pending' };
  if (!holdElapsed(user)) return { outcome: 'not_ready', reason: 'hold_not_elapsed' };

  const dest = findGetawayDestination(user.getawayDestinationId);
  if (!dest) {
    console.error(`[GasCap] Getaway fulfillment — unknown destination id '${user.getawayDestinationId}' for ${user.email}. Not fulfilling.`);
    return { outcome: 'not_ready', reason: 'no_destination' };
  }

  // ── Provenance-appropriate entitlement re-verification ──────────────────
  const isRevenueCatProvenance =
    !(user.stripeInterval === 'lifetime') && !user.ambassadorProForLife &&
    user.revenueCatActive && user.revenueCatInterval === 'lifetime';

  if (isRevenueCatProvenance) {
    let reconciled: Awaited<ReturnType<typeof reconcileRevenueCatState>>;
    try {
      const environment = isSandboxTestAccount(user.email) ? 'sandbox' : 'production';
      const state = await fetchAuthoritativeRevenueCatState(user.id, environment);
      reconciled = await reconcileRevenueCatState(user.id, state);
    } catch (err) {
      if (err instanceof CrossAccountLifetimeOwnershipError || err instanceof UnverifiableLifetimeOwnershipError) {
        console.error(`[GasCap] Getaway fulfillment — ownership check failed for ${user.email}: ${err.message}. Not fulfilling; left pending for review.`);
      } else {
        console.error(`[GasCap] Getaway fulfillment — authoritative RevenueCat lookup failed for ${user.email}:`, err);
      }
      // Provider unavailable/ambiguous — NEVER interpreted as entitlement
      // validity, and NEVER auto-marked as revoked (that's reserved for a
      // proven revocation). Left pending for the next scheduled run.
      return { outcome: 'not_ready', reason: 'provider_unverifiable' };
    }
    if (!reconciled.pro || reconciled.effectiveInterval !== 'lifetime') {
      await maybeRevokeGetawayQualification(userId);
      return { outcome: 'not_ready', reason: 'entitlement_lost' };
    }
  } else {
    // Non-RevenueCat provenance (Stripe/gift/Ambassador) — trust the
    // existing source of truth (that provider's own webhook), re-checked
    // fresh from the row just read above. Never call RevenueCat for this.
    const stillQualifies = hasLifetimeEntitlement({
      stripeInterval:     user.stripeInterval,
      revenueCatActive:   user.revenueCatActive,
      revenueCatInterval: user.revenueCatInterval,
    }) || user.ambassadorProForLife;
    if (!stillQualifies) {
      await maybeRevokeGetawayQualification(userId);
      return { outcome: 'not_ready', reason: 'entitlement_lost' };
    }
  }

  // ── Entitlement confirmed — proceed with the existing atomic Marketing
  // Boost fulfillment logic (unchanged from app/api/getaway/choose/route.ts). ──
  let mb: VacationIncentiveOutcome;
  try {
    mb = await sendVacationIncentive({ destinationId: dest.mbDestinationId, name: user.name, email: user.email });
  } catch (err) {
    console.error(`[GasCap] sendVacationIncentive threw unexpectedly for ${user.email} → ${dest.name}:`, err);
    mb = { outcome: 'unknown', error: `threw: ${String(err)}` };
  }

  if (mb.outcome === 'unknown') {
    console.error(`[GasCap] MB send outcome UNKNOWN (ambiguous transport failure) for ${user.email} → ${dest.name}:`, mb.error);
    notifyAdmin({
      subject: `⚠️ AMBIGUOUS getaway send — verify before issuing → ${dest.name} → ${user.email}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
        <p style="font-size:16px;margin:0 0 8px;color:#b45309;">⚠️ The Marketing Boost API call for this getaway did not return a definitive response (network/transport error) — it may or may not have actually sent.</p>
        <p style="font-size:14px;color:#334155;margin:0 0 8px;"><strong>${user.name}</strong> (${user.email}) chose <strong>${dest.name}</strong>.</p>
        <p style="font-size:14px;color:#0f766e;margin:0;"><strong>Action:</strong> Check the Marketing Boost portal directly for whether a certificate for ${user.email} / ${dest.name} already exists BEFORE issuing a new one — issuing without checking risks a duplicate.</p>
        <p style="font-size:12px;color:#94a3b8;margin-top:8px;">Transport error: ${mb.error}</p>
      </div>`,
      text: `AMBIGUOUS getaway send (transport error, no definitive MB response) — ${dest.name} → ${user.name} <${user.email}>. Verify in the Marketing Boost portal before issuing manually. Error: ${mb.error}`,
    });
    return { outcome: 'ambiguous', destination: dest.id };
  }

  const nextStatus: 'sent' | 'manual_required' = mb.outcome === 'sent' ? 'sent' : 'manual_required';
  const transition = await prisma.user.updateMany({
    where: { id: userId, getawayDestinationId: dest.id, getawayFulfillmentStatus: 'pending' },
    data:  nextStatus === 'sent'
      ? { getawayFulfillmentStatus: 'sent', getawayFulfilledAt: new Date().toISOString() }
      : { getawayFulfillmentStatus: 'manual_required' },
  });

  if (transition.count === 0) {
    console.error(`[GasCap] Getaway pending->${nextStatus} transition matched 0 rows for ${user.email} — MB outcome '${mb.outcome}'. State divergence — investigate. Not re-notifying.`);
    return { outcome: 'not_ready', reason: 'not_pending' };
  }

  if (nextStatus === 'sent') {
    notifyAdmin({
      subject: `🏝️ Getaway cert auto-sent → ${dest.name} → ${user.email}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
        <p style="font-size:16px;margin:0 0 8px;">✅ No action needed — sent automatically via Marketing Boost API (after 72-hour verification).</p>
        <p style="font-size:14px;color:#334155;margin:0;"><strong>${user.name}</strong> (${user.email}) chose <strong>${dest.name}</strong>.</p>
      </div>`,
      text: `Getaway cert auto-sent via MB API (after 72-hour verification): ${dest.name} → ${user.name} <${user.email}>`,
    });
  } else {
    const rejectedError = mb.outcome === 'rejected' ? mb.error : 'unknown error';
    console.error(`[GasCap] MB auto-send rejected for ${user.email} → ${dest.name}:`, rejectedError);
    notifyAdmin({
      subject: `🏝️ ISSUE GETAWAY CERT → ${dest.name} → ${user.email}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
        <p style="font-size:20px;margin:0 0 8px;">🏝️ Issue a getaway certificate</p>
        <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${user.name}</strong> chose <strong>${dest.name}</strong>.</p>
        <p style="font-size:14px;color:#0f766e;margin:0 0 12px;"><strong>Action:</strong> In Marketing Boost → online-bookings vacation → issue a destination-based <strong>${dest.name}</strong> getaway to <strong>${user.email}</strong>.</p>
        <p style="font-size:13px;color:#64748b;margin:0 0 4px;">Recipient: <strong>${user.email}</strong> · Destination: <strong>${dest.name}</strong> (${dest.id})</p>
        <p style="font-size:12px;color:#b45309;margin-top:8px;">(Marketing Boost rejected the request: ${rejectedError} — needs manual fulfillment.)</p>
      </div>`,
      text: `ISSUE GETAWAY CERT in Marketing Boost (online-bookings) — destination ${dest.name} → ${user.name} <${user.email}> (rejected: ${rejectedError})`,
    });
  }

  sendMail({
    to:      user.email,
    subject: `🏝️ Your ${dest.name} getaway is being sent`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#005F4A,#1EB68F);border-radius:16px 16px 0 0;padding:24px;text-align:center;">
        <p style="font-size:26px;margin:0;color:#fff;font-weight:800;">${dest.emoji} ${dest.name}</p>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px;">
        <p style="font-size:15px;color:#334155;margin:0 0 12px;">Great pick, ${user.name}! Your complimentary <strong>${dest.name}</strong> resort getaway certificate is being issued — watch your inbox (and spam folder) over the next <strong>24 hours</strong> for an email from Marketing Boost / RedeemVacations.</p>
        <div style="background:#f0fdf9;border:1px solid #99f6e4;border-radius:12px;padding:14px 16px;margin:0 0 12px;">
          <p style="font-size:12px;color:#0f766e;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">Good to know</p>
          ${GETAWAY_DISCLOSURE.full.map((l) => `<p style="font-size:13px;color:#334155;margin:0 0 4px;">• ${l}</p>`).join('')}
        </div>
        <p style="font-size:13px;color:#64748b;margin:0;">Questions? Just reply to this email.</p>
      </div>
    </div>`,
    text: `Your ${dest.name} getaway certificate is being issued — watch your inbox within 24 hours. ${GETAWAY_DISCLOSURE.short}`,
  }).catch((e) => console.error('[GasCap] Getaway buyer confirmation failed:', e));

  console.info(`[GasCap] Getaway destination fulfilled: ${dest.name} for ${user.email} (${nextStatus})`);
  return { outcome: nextStatus, destination: dest.id };
}

/**
 * GET/POST /api/getaway/choose
 * A Lifetime buyer picks their complimentary getaway destination.
 *
 * All 6 destinations now send automatically via the Marketing Boost API,
 * using the mbDestinationId verified directly with MB support and confirmed
 * with a real test send against their live API (2026-07-26) — see
 * lib/getawayPromo.ts. No manual admin action needed for any of them.
 *
 * Fallback path kept for safety: if the API call fails for any reason (rate
 * limit, MB outage, a destination ID that stops working), we fall back to
 * the original manual flow — email the admin the exact destination to issue
 * by hand in the Marketing Boost portal — so a buyer never gets left with
 * no certificate at all.
 *
 * ── Fulfillment state machine (2026-08-24) ──────────────────────────────────
 * Marketing Boost's send API accepts no idempotency key or request ID of any
 * kind, and this integration has no lookup/status endpoint to verify a past
 * send (checked: lib/marketingBoost.ts only wraps send + a destination
 * catalog GET; no public MB API docs describe a status endpoint either — see
 * docs/reviews/2026-08-24-getaway-fulfillment-idempotency.md). That means an
 * automatic retry can never be proven safe once a request has been sent to
 * MB — a crash between MB accepting the request and GasCap recording the
 * outcome is a real, unresolvable-in-band ambiguous window.
 *
 * So: getawayDestinationId is claimed ATOMICALLY first (via a conditional
 * `getawayDestinationId IS NULL` update) — this is what makes "only one
 * request may ever call Marketing Boost for this user" true even under
 * concurrent/retried requests, before any external call happens. Only the
 * request that wins that claim proceeds to call Marketing Boost. The
 * outcome then transitions getawayFulfillmentStatus 'pending' -> 'sent' or
 * 'pending' -> 'manual_required', ALSO via a conditional update (only from
 * 'pending', so a stale/duplicate request can never clobber an
 * already-resolved terminal state). Any later request for an
 * already-claimed user — regardless of status, including a still-'pending'
 * one from an ambiguous crash window — returns the existing destination and
 * status and NEVER calls Marketing Boost again. A stuck 'pending' row is
 * surfaced by the daily integrity-check cron for manual investigation, not
 * auto-resolved (see app/api/cron/integrity-check/route.ts).
 *
 * getawayFulfillmentStatus is null for two different reasons the GET
 * handler distinguishes: no destination chosen yet, OR a historical row
 * from before this field existed (computed client-facing 'legacy' status —
 * never backfilled in the DB, since no durable record exists proving which
 * historical sends actually succeeded vs. fell back to manual).
 *
 * Body: { destination: string }  // one of GETAWAY_DESTINATIONS ids
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById }         from '@/lib/users';
import { prisma }           from '@/lib/prisma';
import { sendMail }         from '@/lib/email';
import { getawayPromoActive, findGetawayDestination, GETAWAY_DISCLOSURE } from '@/lib/getawayPromo';
import { hasLifetimeEntitlement } from '@/lib/entitlements';
import { attemptGetawayFulfillment } from '@/lib/getawayFulfillment';

export type GetawayFulfillmentStatus = 'pending' | 'sent' | 'manual_required';
export type GetawayClientStatus = GetawayFulfillmentStatus | 'legacy' | null;

/** getawayFulfillmentStatus=null + a destination present means a pre-fix
 *  historical row — computed as 'legacy' for clients, never stored as such. */
function computeClientStatus(destinationId: string | null, status: string | null): GetawayClientStatus {
  if (!destinationId) return null;
  if (status === 'pending' || status === 'sent' || status === 'manual_required') return status;
  return 'legacy';
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Sign in to view your getaway.' }, { status: 401 });
  }
  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = await findById(userId);
  if (!user) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }
  const destinationId = user.getawayDestinationId ?? null;
  return NextResponse.json({
    chosen:            destinationId != null,
    destination:       destinationId,
    fulfillmentStatus: computeClientStatus(destinationId, user.getawayFulfillmentStatus ?? null),
  });
}

export async function POST(req: Request) {
  if (!getawayPromoActive()) {
    return NextResponse.json({ error: 'The getaway promo is not active.' }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Sign in to choose your getaway.' }, { status: 401 });
  }

  let body: { destination?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const dest = findGetawayDestination(body.destination);
  if (!dest) {
    return NextResponse.json({ error: 'Please choose a valid destination.' }, { status: 400 });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = await findById(userId);
  if (!user) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }

  // Only Lifetime owners earn the getaway. (Defensive — the picker only shows to them.)
  // Provider-neutral: a native IAP (RevenueCat) Lifetime purchase is just as
  // valid as a Stripe/gift one — see lib/entitlements.ts's PROVENANCE
  // INVARIANT. A raw `stripeInterval` check here permanently rejects a
  // genuine RevenueCat Lifetime owner (found via live native IAP testing,
  // 2026-08-24 — see docs/reviews/2026-08-24-lifetime-entitlement-check-gap.md).
  const isLifetime = hasLifetimeEntitlement({
    stripeInterval:     user.stripeInterval     ?? null,
    revenueCatActive:   user.revenueCatActive   ?? false,
    revenueCatInterval: user.revenueCatInterval ?? null,
  });
  if (!isLifetime) {
    return NextResponse.json({ error: 'The getaway is included with Pro Lifetime.' }, { status: 403 });
  }

  // ── Atomic claim — the ONLY thing that decides who may call Marketing
  // Boost. Conditional on getawayDestinationId being null so a concurrent
  // or retried request can never win twice. Destination is immutable from
  // this point on, regardless of what a later request asks for.
  const claim = await prisma.user.updateMany({
    where: { id: userId, getawayDestinationId: null },
    data:  {
      getawayDestinationId:       dest.id,
      getawayDestinationChosenAt: new Date().toISOString(),
      getawayFulfillmentStatus:   'pending',
    },
  });

  if (claim.count === 0) {
    // Already claimed — by this exact request racing itself, a genuine
    // retry, or an earlier successful/failed/still-pending choice. Never
    // call Marketing Boost again, never overwrite the destination.
    const existing = await findById(userId);
    if (!existing?.getawayDestinationId) {
      // Fail closed. claim.count===0 means SOME row already had a non-null
      // getawayDestinationId at the instant of the conditional update — if
      // the re-read now shows none, the two reads are contradictory (a
      // concurrent clear, a read replica lag, or a genuine bug). Substituting
      // the requested destination and claiming alreadyChosen:true here would
      // fabricate a fact we don't actually have. Never call Marketing Boost
      // in this state.
      console.error(
        `[GasCap] Getaway choose — claim.count=0 for ${user.email} but re-read shows no getawayDestinationId. ` +
        `Contradictory durable state — investigate.`,
      );
      return NextResponse.json(
        { error: 'Could not confirm your getaway selection — please try again in a moment.' },
        { status: 503 },
      );
    }
    const existingStatus = computeClientStatus(existing.getawayDestinationId, existing.getawayFulfillmentStatus ?? null);
    console.info(`[GasCap] Getaway choose — already claimed for ${user.email}, no MB call (status=${existingStatus})`);
    return NextResponse.json({
      ok: true, destination: existing.getawayDestinationId, alreadyChosen: true, fulfillmentStatus: existingStatus,
    });
  }

  // ── 7-day verification hold (2026-08-25) ─────────────────────────────────
  // Destination selection is immediate — the claim above already happened.
  // Certificate FULFILLMENT (the external, unrecoverable Marketing Boost
  // call) must not occur until the hold has elapsed. `user.getawayHoldUntil`
  // was stamped once at the qualifying grant (see lib/getawayFulfillment.ts);
  // null means granted before this feature shipped — grandfathered as
  // already-satisfied. If the hold hasn't elapsed yet, record the choice and
  // stop here — no Marketing Boost call, no attemptGetawayFulfillment().
  const holdUntil    = user.getawayHoldUntil ?? null;
  const holdElapsed  = !holdUntil || Number.isNaN(Date.parse(holdUntil)) || Date.parse(holdUntil) <= Date.now();

  if (!holdElapsed) {
    // Copy deliberately does not name "72 hours" or attribute the wait to
    // Apple — this is GasCap's own brief fraud/refund verification, not an
    // Apple deadline or the point a purchase becomes "final."
    sendMail({
      to:      user.email,
      subject: `🏝️ Your ${dest.name} getaway is reserved`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#005F4A,#1EB68F);border-radius:16px 16px 0 0;padding:24px;text-align:center;">
          <p style="font-size:26px;margin:0;color:#fff;font-weight:800;">${dest.emoji} ${dest.name}</p>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px;">
          <p style="font-size:15px;color:#334155;margin:0 0 12px;">Your vacation choice is reserved, ${user.name}! Your GasCap Lifetime membership is active now. We'll email your <strong>${dest.name}</strong> vacation certificate after a brief purchase-verification period.</p>
          <div style="background:#f0fdf9;border:1px solid #99f6e4;border-radius:12px;padding:14px 16px;margin:0 0 12px;">
            <p style="font-size:12px;color:#0f766e;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">Good to know</p>
            ${GETAWAY_DISCLOSURE.full.map((l) => `<p style="font-size:13px;color:#334155;margin:0 0 4px;">• ${l}</p>`).join('')}
          </div>
          <p style="font-size:13px;color:#64748b;margin:0;">Questions? Just reply to this email.</p>
        </div>
      </div>`,
      text: `Your vacation choice (${dest.name}) is reserved! Your GasCap Lifetime membership is active now. We'll email your vacation certificate after a brief purchase-verification period. ${GETAWAY_DISCLOSURE.short}`,
    }).catch((e) => console.error('[GasCap] Getaway pending-verification email failed:', e));

    console.info(`[GasCap] Getaway destination chosen: ${dest.name} by ${user.email} (pending — 72-hour verification hold not yet elapsed)`);
    return NextResponse.json({ ok: true, destination: dest.id, fulfillmentStatus: 'pending' });
  }

  // Hold already elapsed at the moment of selection (e.g. a late chooser
  // reached via the reminder cron) — fulfill immediately via the same
  // shared, re-verified path the recurring cron uses. No logic is
  // duplicated here; see lib/getawayFulfillment.ts for the full
  // authoritative-reconciliation + Marketing Boost + state-machine flow.
  const result = await attemptGetawayFulfillment(userId);
  if (result.outcome === 'sent' || result.outcome === 'manual_required' || result.outcome === 'ambiguous') {
    return NextResponse.json({ ok: true, destination: result.destination, fulfillmentStatus: result.outcome === 'ambiguous' ? 'pending' : result.outcome });
  }
  // 'not_ready' at this point (hold just proven elapsed, claim just won) is
  // unexpected but not fabricated — re-read and report actual durable state.
  const recheck = await findById(userId);
  console.error(`[GasCap] Getaway immediate fulfillment returned '${result.reason}' for ${user.email} right after a successful claim — investigate.`);
  if (!recheck?.getawayDestinationId) {
    // Fail closed — same principle as the claim-loser branch above. If the
    // re-read shows NO durable destination at all, fabricating alreadyChosen
    // would claim a fact the database does not actually contain.
    return NextResponse.json(
      { error: 'Could not confirm your getaway selection — please try again in a moment.' },
      { status: 503 },
    );
  }
  const durableStatus = computeClientStatus(recheck.getawayDestinationId, recheck.getawayFulfillmentStatus ?? null);
  return NextResponse.json({ ok: true, destination: recheck.getawayDestinationId, alreadyChosen: true, fulfillmentStatus: durableStatus });
}

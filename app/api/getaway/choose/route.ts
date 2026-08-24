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
import { sendVacationIncentive, type VacationIncentiveOutcome } from '@/lib/marketingBoost';
import { hasLifetimeEntitlement } from '@/lib/entitlements';

export type GetawayFulfillmentStatus = 'pending' | 'sent' | 'manual_required';
export type GetawayClientStatus = GetawayFulfillmentStatus | 'legacy' | null;

/** Fire-and-forget admin notification */
function notifyAdmin(opts: { subject: string; html: string; text: string }) {
  sendMail({ to: 'info@gascap.app', ...opts })
    .catch((e) => console.error('[GasCap] Getaway admin notify failed:', e));
}

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

  // This request owns fulfillment — call Marketing Boost exactly once.
  // sendVacationIncentive() distinguishes a definitive provider response
  // ('sent'/'rejected') from a genuinely ambiguous transport failure
  // ('unknown' — fetch threw before any response was read, so Marketing
  // Boost may already have accepted and sent the certificate). Only
  // 'unknown' must never be treated as a reason to tell the customer/admin
  // this failed — see lib/marketingBoost.ts's VacationIncentiveOutcome.
  let mb: VacationIncentiveOutcome;
  try {
    mb = await sendVacationIncentive({
      destinationId: dest.mbDestinationId,
      name:          user.name,
      email:         user.email,
    });
  } catch (err) {
    // sendVacationIncentive() is documented to always catch internally and
    // never throw — but defensively treated as 'unknown' regardless, so a
    // future violation of that contract still fails safe (ambiguous, not a
    // fabricated 'rejected') rather than stranding the row with zero
    // notification.
    console.error(`[GasCap] sendVacationIncentive threw unexpectedly for ${user.email} → ${dest.name}:`, err);
    mb = { outcome: 'unknown', error: `threw: ${String(err)}` };
  }

  if (mb.outcome === 'unknown') {
    // Genuinely ambiguous — Marketing Boost may already have sent the
    // certificate. LEAVE the durable row 'pending'. Never auto-resend,
    // never send the "ISSUE GETAWAY CERT" manual-fulfillment fallback
    // (that fallback tells an admin to issue a NEW certificate by hand,
    // which would risk a duplicate if MB actually did receive this one).
    // Alert admin with language that makes the ambiguity explicit instead.
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
    console.info(`[GasCap] Getaway destination chosen: ${dest.name} by ${user.email} (pending — ambiguous send outcome)`);
    return NextResponse.json({ ok: true, destination: dest.id, fulfillmentStatus: 'pending' });
  }

  const nextStatus: GetawayFulfillmentStatus = mb.outcome === 'sent' ? 'sent' : 'manual_required';
  const transition = await prisma.user.updateMany({
    where: { id: userId, getawayDestinationId: dest.id, getawayFulfillmentStatus: 'pending' },
    data:  nextStatus === 'sent'
      ? { getawayFulfillmentStatus: 'sent', getawayFulfilledAt: new Date().toISOString() }
      : { getawayFulfillmentStatus: 'manual_required' },
  });

  if (transition.count === 0) {
    // The durable row is no longer 'pending' for this destination —
    // something else changed it between the claim and now (should not
    // happen given the single-writer design, but this is the compare-and-
    // set safety net, not a log-and-ignore). Never fabricate a response
    // status from the in-memory MB result when the DB disagrees — re-read
    // and return what's actually durable. The external send may genuinely
    // have succeeded even though the DB transition didn't land; that fact
    // is preserved in the alert, not silently discarded, but it is NOT
    // reported to the customer as fact unless the DB itself says so.
    const recheck = await findById(userId);
    const durableStatus = computeClientStatus(recheck?.getawayDestinationId ?? null, recheck?.getawayFulfillmentStatus ?? null);

    if (!recheck?.getawayDestinationId) {
      // Fail closed — same principle as the claim-loser branch above. If
      // the re-read shows NO durable destination at all, substituting
      // `dest.id` and claiming alreadyChosen:true would fabricate a fact
      // the database does not actually contain.
      console.error(
        `[GasCap] Getaway pending->${nextStatus} transition matched 0 rows for ${user.email}, AND the re-read ` +
        `shows no durable getawayDestinationId at all. Marketing Boost outcome was '${mb.outcome}'. ` +
        `Contradictory durable state — investigate. No notification sent for this attempt.`,
      );
      notifyAdmin({
        subject: `🚨 Getaway contradictory state — no durable destination after transition mismatch → ${user.email}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
          <p style="font-size:16px;margin:0 0 8px;color:#b91c1c;">🚨 Marketing Boost outcome was '${mb.outcome}' for <strong>${user.email}</strong> / <strong>${dest.name}</strong>, the pending→${nextStatus} transition matched 0 rows, AND the re-read shows no destination on the account at all. This is a contradictory state — investigate before taking any action.</p>
        </div>`,
        text: `Getaway contradictory state for ${user.email} / ${dest.name}: MB outcome '${mb.outcome}', transition matched 0 rows, re-read shows no destination. Investigate.`,
      });
      return NextResponse.json(
        { error: 'Could not confirm your getaway selection — please try again in a moment.' },
        { status: 503 },
      );
    }

    console.error(
      `[GasCap] Getaway pending->${nextStatus} transition matched 0 rows for ${user.email} — ` +
      `Marketing Boost outcome was '${mb.outcome}' but durable status is actually '${durableStatus}'. ` +
      `State divergence — investigate. No notification sent for this attempt.`,
    );
    notifyAdmin({
      subject: `⚠️ Getaway state divergence — durable status disagrees with MB outcome → ${user.email}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
        <p style="font-size:16px;margin:0 0 8px;color:#b45309;">⚠️ Marketing Boost outcome was '${mb.outcome}' for <strong>${user.email}</strong> / <strong>${dest.name}</strong>, but the durable database transition did not apply (durable status is now '${durableStatus}'). Investigate before assuming either outcome.</p>
      </div>`,
      text: `Getaway state divergence for ${user.email} / ${dest.name}: MB outcome '${mb.outcome}', durable status '${durableStatus}'. Investigate.`,
    });
    return NextResponse.json({ ok: true, destination: recheck.getawayDestinationId, alreadyChosen: true, fulfillmentStatus: durableStatus });
  }

  if (nextStatus === 'sent') {
    notifyAdmin({
      subject: `🏝️ Getaway cert auto-sent → ${dest.name} → ${user.email}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
        <p style="font-size:16px;margin:0 0 8px;">✅ No action needed — sent automatically via Marketing Boost API.</p>
        <p style="font-size:14px;color:#334155;margin:0;"><strong>${user.name}</strong> (${user.email}) chose <strong>${dest.name}</strong>.</p>
      </div>`,
      text: `Getaway cert auto-sent via MB API: ${dest.name} → ${user.name} <${user.email}>`,
    });
  } else {
    const rejectedError = mb.outcome === 'rejected' ? mb.error : 'unknown error';
    console.error(`[GasCap] MB auto-send rejected for ${user.email} → ${dest.name}:`, rejectedError);
    // ── Fallback: MB definitively rejected — issue manually so the buyer isn't left empty-handed ──
    notifyAdmin({
      subject: `🏝️ ISSUE GETAWAY CERT → ${dest.name} → ${user.email}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
        <p style="font-size:20px;margin:0 0 8px;">🏝️ Issue a getaway certificate</p>
        <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${user.name}</strong> chose <strong>${dest.name}</strong>.</p>
        <p style="font-size:14px;color:#0f766e;margin:0 0 12px;"><strong>Action:</strong> In Marketing Boost → online-bookings vacation → issue a destination-based <strong>${dest.name}</strong> getaway to <strong>${user.email}</strong>.</p>
        <p style="font-size:13px;color:#64748b;margin:0 0 4px;">Recipient: <strong>${user.email}</strong> · Destination: <strong>${dest.name}</strong> (${dest.id})</p>
        <p style="font-size:12px;color:#94a3b8;">${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET</p>
        <p style="font-size:12px;color:#b45309;margin-top:8px;">(Marketing Boost rejected the request: ${rejectedError} — needs manual fulfillment.)</p>
      </div>`,
      text: `ISSUE GETAWAY CERT in Marketing Boost (online-bookings) — destination ${dest.name} → ${user.name} <${user.email}> (rejected: ${rejectedError})`,
    });
  }

  // ── Buyer confirmation ───────────────────────────────────────────────────────
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

  console.info(`[GasCap] Getaway destination chosen: ${dest.name} by ${user.email} (${nextStatus})`);
  return NextResponse.json({ ok: true, destination: dest.id, fulfillmentStatus: nextStatus });
}

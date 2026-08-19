/**
 * Sprint 2 hardening — durable RevenueCat webhook idempotency.
 *
 * RevenueCat delivers webhooks at-least-once: the same event.id can arrive
 * more than once (retry after a slow 200, a network blip, etc.). Before this,
 * nothing recorded which events had been seen, so a duplicate delivery would
 * re-run every side effect — a second welcome email, a second getaway offer,
 * a second push notification — for the exact same purchase.
 *
 * event.id is the dedup key, claimed atomically via the RevenueCatWebhookEvent
 * table's primary key. The status model exists specifically so a crash
 * between claiming an event and finishing its side effects doesn't
 * permanently swallow it:
 *
 *   received   → row exists, about to start (used only transiently here;
 *                claimEvent moves straight to 'processing' on a fresh claim)
 *   processing → claimed, side effects in flight
 *   processed  → side effects completed — a later duplicate is a true no-op
 *   failed     → attempted and errored — safe to retry
 *
 * A 'processing' row older than PROCESSING_STALE_MS is treated as crashed
 * (the process died mid-flight) and reclaimed rather than trusted — without
 * this, one crash would permanently block that event's entitlement change,
 * since RevenueCat would keep retrying and every retry would see
 * "processing" and back off forever.
 *
 * POST-SPRINT-2 REVISION 1 FIX — CLAIM OWNERSHIP IS NOW ATOMIC.
 * The original failed/stale-processing reclaim paths used a plain
 * `update()` after a `findUnique()` read — two concurrent retries could both
 * read the same failed/stale row, both update it, and both believe they'd
 * claimed it, running the side effects twice. Every claim (fresh or
 * reclaimed) now gets a unique `claimToken`, and reclaiming uses an atomic
 * `updateMany()` with the row's PRIOR state (status, and for stale-processing
 * reclaim, the exact `receivedAt` lease timestamp) in the `where` clause —
 * only the caller whose `updateMany` actually matches a row (count === 1)
 * wins the claim. `markProcessed`/`markFailed` require both the event id AND
 * the claimToken to match `status: 'processing'` before writing, so a
 * claimant whose ownership was already superseded by a newer reclaim cannot
 * overwrite that newer claimant's state.
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/generated/prisma/client';

/** How long a 'processing' row is trusted before being treated as crashed and reclaimed. */
const PROCESSING_STALE_MS = 2 * 60 * 1000;

function newClaimToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type ClaimResult =
  | { outcome: 'claimed'; claimToken: string } // first time (or safely reclaimed) — go process it
  | { outcome: 'duplicate-processed' }         // already fully handled — no-op, return 200
  | { outcome: 'duplicate-in-flight' };        // another request is actively processing it right now — no-op, return 200

/**
 * Atomically claim an event for processing. Returns the `claimToken` on a
 * successful claim — callers MUST pass it to markProcessed/markFailed so
 * those calls only take effect if this claim is still the current owner.
 */
export async function claimEvent(eventId: string, eventType: string, userId: string | null): Promise<ClaimResult> {
  const now = new Date().toISOString();
  const token = newClaimToken();

  try {
    await prisma.revenueCatWebhookEvent.create({
      data: { id: eventId, eventType, userId, status: 'processing', claimToken: token, receivedAt: now },
    });
    return { outcome: 'claimed', claimToken: token };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    // Row already exists — figure out what to do with the duplicate.
  }

  const existing = await prisma.revenueCatWebhookEvent.findUnique({ where: { id: eventId } });
  if (!existing) {
    // Vanishingly unlikely (deleted between the failed create and this read).
    // Use the same atomic upsert-as-CAS shape as everywhere else rather than
    // a plain upsert, so a genuinely concurrent recreation can't double-claim.
    //
    // Post-Revision-2 fix: only a genuine P2002 (someone else's concurrent
    // create won this exact race) collapses into 'duplicate-in-flight'. An
    // arbitrary DB error here (connection drop, timeout, anything else) must
    // NOT be silently treated as "someone else claimed it" — that would
    // convert a real outage into a false-positive successful no-op, telling
    // the caller to skip processing an event that was never actually
    // claimed by anyone. Unexpected errors are re-thrown so the webhook
    // handler 500s and RevenueCat retries, exactly as an unrecoverable
    // failure should be handled.
    try {
      await prisma.revenueCatWebhookEvent.create({
        data: { id: eventId, eventType, userId, status: 'processing', claimToken: token, receivedAt: now },
      });
      return { outcome: 'claimed', claimToken: token };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      return { outcome: 'duplicate-in-flight' };
    }
  }

  if (existing.status === 'processed') return { outcome: 'duplicate-processed' };

  if (existing.status === 'failed') {
    // Safe to retry — reclaim it, but only if it's STILL 'failed' at the
    // instant of the write (CAS on status). If a concurrent retry reclaimed
    // it first, this updateMany matches zero rows.
    const result = await prisma.revenueCatWebhookEvent.updateMany({
      where: { id: eventId, status: 'failed' },
      data:  { status: 'processing', claimToken: token, receivedAt: now, error: null },
    });
    if (result.count === 1) return { outcome: 'claimed', claimToken: token };
    return { outcome: 'duplicate-in-flight' }; // someone else won the reclaim race
  }

  // status === 'processing'
  const age = Date.now() - new Date(existing.receivedAt).getTime();
  if (age > PROCESSING_STALE_MS) {
    // The original claimant almost certainly crashed. Reclaim rather than
    // block this event forever — this is the "crash after insert, before
    // side effects" case the brief specifically calls out. CAS on BOTH
    // status AND the exact receivedAt we just read: if another concurrent
    // reclaimer already moved receivedAt forward (or finished the event),
    // this updateMany matches zero rows and we back off instead of
    // clobbering their claim.
    const result = await prisma.revenueCatWebhookEvent.updateMany({
      where: { id: eventId, status: 'processing', receivedAt: existing.receivedAt },
      data:  { status: 'processing', claimToken: token, receivedAt: now, error: null },
    });
    if (result.count === 1) return { outcome: 'claimed', claimToken: token };
    return { outcome: 'duplicate-in-flight' }; // someone else won the reclaim race
  }
  // Recent and still processing — a genuinely concurrent delivery. Let the
  // original finish; don't repeat its side effects.
  return { outcome: 'duplicate-in-flight' };
}

/**
 * Mark a claimed event as successfully processed. Only takes effect if
 * `claimToken` still matches the row's current owner AND the row is still
 * 'processing' — an old claimant that lost ownership to a newer reclaim
 * (because it was mistakenly judged stale, or is finishing very late) cannot
 * overwrite the newer claimant's in-flight or already-finished state.
 */
export async function markProcessed(eventId: string, claimToken: string): Promise<void> {
  const result = await prisma.revenueCatWebhookEvent.updateMany({
    where: { id: eventId, claimToken, status: 'processing' },
    data:  { status: 'processed', processedAt: new Date().toISOString() },
  });
  if (result.count === 0) {
    console.warn(`[revenueCatEvents] markProcessed(${eventId}) — claim ownership no longer current, write skipped`);
  }
}

/**
 * Mark a claimed event as failed. Deliberately does NOT re-throw — a webhook
 * handler that 500s here causes RevenueCat to retry, which is fine, but the
 * caller decides that; this just records the failure durably so it's visible
 * (docs/SECURITY_AUDIT.md observability item) whether or not a retry follows.
 * Same ownership check as markProcessed — see its doc comment.
 */
export async function markFailed(eventId: string, claimToken: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.revenueCatWebhookEvent.updateMany({
    where: { id: eventId, claimToken, status: 'processing' },
    // Truncated — this is a diagnostic string, not a place to accumulate
    // unbounded stack traces across retries.
    data:  { status: 'failed', error: message.slice(0, 500) },
  }).catch(() => { /* best-effort — the original error is what matters */ });
}

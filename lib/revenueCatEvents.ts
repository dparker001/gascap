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
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/generated/prisma/client';

/** How long a 'processing' row is trusted before being treated as crashed and reclaimed. */
const PROCESSING_STALE_MS = 2 * 60 * 1000;

export type ClaimResult =
  | { outcome: 'claimed' }                 // first time seeing this event — go process it
  | { outcome: 'duplicate-processed' }     // already fully handled — no-op, return 200
  | { outcome: 'duplicate-in-flight' };    // another request is actively processing it right now — no-op, return 200

/**
 * Atomically claim an event for processing.
 *
 * Uses Prisma's unique-constraint violation (P2002) on the primary key as the
 * concurrency primitive: only one caller's `create()` can succeed for a given
 * event.id, so this is safe under concurrent delivery without a separate lock.
 */
export async function claimEvent(eventId: string, eventType: string, userId: string | null): Promise<ClaimResult> {
  const now = new Date().toISOString();

  try {
    await prisma.revenueCatWebhookEvent.create({
      data: { id: eventId, eventType, userId, status: 'processing', receivedAt: now },
    });
    return { outcome: 'claimed' };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    // Row already exists — figure out what to do with the duplicate.
  }

  const existing = await prisma.revenueCatWebhookEvent.findUnique({ where: { id: eventId } });
  if (!existing) {
    // Vanishingly unlikely (deleted between the failed create and this read),
    // but if it happens, treat it as a fresh claim rather than throw.
    await prisma.revenueCatWebhookEvent.upsert({
      where:  { id: eventId },
      create: { id: eventId, eventType, userId, status: 'processing', receivedAt: now },
      update: { status: 'processing', receivedAt: now },
    });
    return { outcome: 'claimed' };
  }

  if (existing.status === 'processed') return { outcome: 'duplicate-processed' };

  if (existing.status === 'failed') {
    // Safe to retry — reclaim it.
    await prisma.revenueCatWebhookEvent.update({
      where: { id: eventId },
      data:  { status: 'processing', receivedAt: now, error: null },
    });
    return { outcome: 'claimed' };
  }

  // status === 'processing'
  const age = Date.now() - new Date(existing.receivedAt).getTime();
  if (age > PROCESSING_STALE_MS) {
    // The original claimant almost certainly crashed. Reclaim rather than
    // block this event forever — this is the "crash after insert, before
    // side effects" case the brief specifically calls out.
    await prisma.revenueCatWebhookEvent.update({
      where: { id: eventId },
      data:  { status: 'processing', receivedAt: now, error: null },
    });
    return { outcome: 'claimed' };
  }
  // Recent and still processing — a genuinely concurrent delivery. Let the
  // original finish; don't repeat its side effects.
  return { outcome: 'duplicate-in-flight' };
}

/** Mark a claimed event as successfully processed. */
export async function markProcessed(eventId: string): Promise<void> {
  await prisma.revenueCatWebhookEvent.update({
    where: { id: eventId },
    data:  { status: 'processed', processedAt: new Date().toISOString() },
  });
}

/**
 * Mark a claimed event as failed. Deliberately does NOT re-throw — a webhook
 * handler that 500s here causes RevenueCat to retry, which is fine, but the
 * caller decides that; this just records the failure durably so it's visible
 * (docs/SECURITY_AUDIT.md observability item) whether or not a retry follows.
 */
export async function markFailed(eventId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.revenueCatWebhookEvent.update({
    where: { id: eventId },
    // Truncated — this is a diagnostic string, not a place to accumulate
    // unbounded stack traces across retries.
    data:  { status: 'failed', error: message.slice(0, 500) },
  }).catch(() => { /* best-effort — the original error is what matters */ });
}

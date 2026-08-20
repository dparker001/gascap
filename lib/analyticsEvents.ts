/**
 * Growth Sprint 1, P0A — first-party funnel/conversion event log.
 *
 * Two clearly separated trust boundaries write to the same AnalyticsEvent
 * table:
 *
 *   - recordAnalyticsEvent()   — TRUSTED. Server code only (webhooks,
 *     mutation routes, cron jobs). No HTTP-reachable entry point. Callers
 *     supply eventType/originPlatform/emitter directly; this function does
 *     not re-validate business logic, it only handles the idempotent-write
 *     mechanics.
 *   - app/api/analytics/event/route.ts — UNTRUSTED. The public, heavily
 *     validated client-ingest endpoint (see that file for the allowlists).
 *     It resolves userId from the session itself and calls
 *     recordAnalyticsEvent() only after its own strict validation passes —
 *     it never lets a caller-supplied eventType bypass the allowlist there.
 *
 * P0A ships this infrastructure only. No real business mutation path calls
 * recordAnalyticsEvent() yet — that's P0B (payment webhooks) / P0C
 * (activation events) / P0D (Rental Return instrumentation), none of which
 * are authorized yet.
 */

import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';

export type OriginPlatform = 'web' | 'ios' | 'android' | 'unknown';
export type Emitter = 'client' | 'server' | 'webhook';

export interface RecordAnalyticsEventInput {
  eventType:       string;
  originPlatform:  OriginPlatform;
  emitter:         Emitter;
  userId?:         string | null;
  source?:         string | null;
  provider?:       'stripe' | 'revenuecat' | null;
  billing?:        'monthly' | 'lifetime' | null;
  /** Small, non-secret context only — never request bodies, secrets, full
   *  payloads, or PII beyond what's already in userId. */
  metadata?:       Record<string, unknown> | null;
  /** Required for anything that must never be double-counted (an
   *  at-least-once webhook redelivery, a legitimately-repeatable business
   *  event keyed on its specific instance). Omit for pure client UX events. */
  idempotencyKey?: string | null;
}

export type RecordAnalyticsEventResult =
  | { outcome: 'written'; id: string }
  /** idempotencyKey collided with an existing row — treated as a successful
   *  no-op, same pattern already established for RevenueCatWebhookEvent's
   *  claim-token dedup in lib/revenueCatEvents.ts. Not an error. */
  | { outcome: 'duplicate' };

/**
 * Write one AnalyticsEvent row. Idempotency-conflict-safe: if
 * `idempotencyKey` is set and a row with that key already exists, this is a
 * no-op that returns `{outcome: 'duplicate'}` rather than throwing.
 */
export async function recordAnalyticsEvent(
  input: RecordAnalyticsEventInput,
): Promise<RecordAnalyticsEventResult> {
  try {
    const row = await prisma.analyticsEvent.create({
      data: {
        eventType:      input.eventType,
        originPlatform: input.originPlatform,
        emitter:        input.emitter,
        userId:         input.userId ?? null,
        source:         input.source ?? null,
        provider:       input.provider ?? null,
        billing:        input.billing ?? null,
        metadata:       (input.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      select: { id: true },
    });
    return { outcome: 'written', id: row.id };
  } catch (err) {
    // A genuine P2002 (idempotencyKey collision) is the expected, common
    // case for a webhook redelivery — treat it as success, not failure.
    // Anything else (a real DB error, a different constraint) must still
    // surface to the caller.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { outcome: 'duplicate' };
    }
    throw err;
  }
}

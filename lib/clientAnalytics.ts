'use client';

/**
 * Growth Sprint 1, P0C-2A — fire-and-forget client-side write into the
 * first-party AnalyticsEvent table via the public, untrusted ingest route
 * (app/api/analytics/event/route.ts). This is client-side infrastructure
 * only — it never touches recordAnalyticsEvent() or the trusted server
 * writer directly.
 *
 * userId is deliberately never sent — the ingest route resolves identity
 * exclusively from the authenticated server session and structurally
 * rejects any request body containing unexpected top-level keys (userId,
 * provider, emitter, billing, idempotencyKey, ...). This helper only ever
 * sends the fields that route actually accepts: eventType, originPlatform,
 * and metadata when supplied.
 *
 * Analytics must never break product behavior: the outer try/catch covers
 * platform detection and serialization (not just the network call), and
 * the fetch itself is fire-and-forget — callers never await this function
 * and a network failure is silently swallowed.
 */
import { detectNativePlatform } from '@/hooks/useIsNative';

export function trackClientEvent(
  eventType: string,
  metadata?: Record<string, unknown>,
): void {
  try {
    const originPlatform = detectNativePlatform() ?? 'web';

    void fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        eventType,
        originPlatform,
        ...(metadata ? { metadata } : {}),
      }),
    }).catch(() => { /* analytics must never break UX */ });
  } catch {
    // Platform detection / serialization failure — still nonfatal.
  }
}

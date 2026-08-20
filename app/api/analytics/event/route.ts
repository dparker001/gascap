/**
 * Growth Sprint 1, P0A — POST /api/analytics/event
 *
 * The UNTRUSTED half of the AnalyticsEvent write path (see
 * lib/analyticsEvents.ts's header for the full trust-boundary explanation).
 * This route is deliberately NOT a generic arbitrary event sink:
 *
 *   - userId is NEVER accepted from the client body — resolved exclusively
 *     from the authenticated server session. Enforced structurally: the
 *     top-level request body is validated against a strict key allowlist
 *     (ALLOWED_TOP_LEVEL_KEYS below), so `userId` (or any other unexpected
 *     field — `provider`, `idempotencyKey`, `emitter`, etc.) is rejected
 *     with 400 rather than silently ignored.
 *   - Anonymous (no session) writes are allowed only for an explicit
 *     allowlist of events.
 *   - eventType must be one of a fixed, client-emittable allowlist —
 *     server/webhook-only event types (purchase_completed, signup_completed,
 *     trial_started, vehicle_saved, fillup_logged, rental_setup_completed,
 *     trial_expired, subscription_renewed) are structurally unreachable
 *     here: they are not in CLIENT_EVENT_TYPES, so they're rejected by the
 *     allowlist check before anything else runs, AND this route never calls
 *     recordAnalyticsEvent() with emitter other than 'client' — a caller
 *     cannot claim to be a server/webhook write through this endpoint.
 *   - originPlatform must be exactly 'web' | 'ios' | 'android' — the client
 *     never gets to claim 'unknown' (that value is reserved for server-side
 *     resolution failures, not a client shortcut).
 *   - metadata is validated per-eventType against a strict allowlist of
 *     keys; unknown keys are rejected outright, not silently stripped.
 *   - a small denylist defends against secrets/PII/URLs leaking into any
 *     accepted string field, as defense in depth beyond the strict schemas.
 *   - rate-limited via the existing Postgres-backed limiter (lib/rateLimitDb),
 *     keyed on userId when authenticated, on IP otherwise.
 *
 * P0A note: no real business event fires through this route in production
 * use yet — no signup/vehicle/fill-up/Rental Return/payment instrumentation
 * has been wired to call it (that's P0B/P0C/P0D, not yet authorized). This
 * route exists so the ingest infrastructure itself can be built and tested.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { recordAnalyticsEvent, type OriginPlatform } from '@/lib/analyticsEvents';
import { checkRateLimitDb, hashRateLimitIdentifier } from '@/lib/rateLimitDb';
import { getTrustedClientIp } from '@/lib/clientIp';

const VALID_ORIGIN_PLATFORMS = new Set<OriginPlatform>(['web', 'ios', 'android']);

/**
 * Strict top-level request-body allowlist. Any key outside this set —
 * userId, provider, billing, emitter, idempotencyKey, or anything else —
 * causes the whole request to be rejected with 400. This is what makes
 * "userId is never accepted from the client" an enforced structural
 * property rather than a convention the handler happens to follow: a
 * caller cannot smuggle in a field this route simply never reads, because
 * the field's mere presence fails validation before any per-field logic
 * runs.
 */
const ALLOWED_TOP_LEVEL_KEYS = new Set(['eventType', 'originPlatform', 'source', 'metadata']);

/**
 * Fixed allowlist of event types a client is permitted to submit through
 * this route. Every other event type in the Growth Sprint 1 taxonomy
 * (purchase_completed, signup_completed, trial_started, vehicle_saved,
 * fillup_logged, rental_setup_completed, trial_expired,
 * subscription_renewed) is server/webhook-authoritative and intentionally
 * absent from this set — see lib/analyticsEvents.ts's header.
 */
const CLIENT_EVENT_TYPES = new Set([
  'calculator_completed',
  'rental_assistant_opened',
  'rental_setup_started',
  'rental_setup_step_viewed',
  'rental_fuel_needed_calculated',
  'paywall_viewed',
  'checkout_started',
]);

/**
 * Events an unauthenticated (no session) caller may submit. A guest can use
 * the calculator and view the paywall/rental-return marketing surfaces
 * without an account — everything else in CLIENT_EVENT_TYPES requires a
 * session (an anonymous rental_setup_started, for example, should not be
 * possible today since starting a rental is Pro-gated behind sign-in, but
 * this allowlist is the actual enforcement, not an assumption about what
 * the UI currently permits).
 */
const ANONYMOUS_ALLOWED_EVENT_TYPES = new Set([
  'calculator_completed',
  'paywall_viewed',
  'rental_assistant_opened',
]);

const MAX_SOURCE_LENGTH = 64;
const MAX_BODY_BYTES = 2048;

/** Reject (not strip) anything that looks like it's carrying PII/secrets. */
const DENYLIST_PATTERNS: RegExp[] = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/,           // email-shaped
  /\b\+?\d[\d\s().-]{7,}\d\b/,          // phone-number-shaped
  /\bBearer\s+\S+/i,                    // bearer token
  /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT-shaped
  /\bhttps?:\/\//i,                     // arbitrary URL
];

type MetadataSchema = Record<string, (v: unknown) => boolean>;

/**
 * Strict per-eventType metadata contracts. An event not listed here (i.e.
 * every event with no meaningful metadata) accepts only null/undefined
 * metadata — any provided object is rejected, not silently passed through.
 */
const METADATA_SCHEMAS: Record<string, MetadataSchema> = {
  rental_setup_step_viewed: {
    step: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7,
  },
  checkout_started: {
    billing: (v) => v === 'monthly' || v === 'lifetime',
    method:  (v) => v === 'stripe' || v === 'iap',
  },
  paywall_viewed: {
    showGetaway: (v) => typeof v === 'boolean',
    wb:          (v) => typeof v === 'boolean',
  },
};

function containsDenylistedContent(value: unknown): boolean {
  if (typeof value === 'string') {
    return DENYLIST_PATTERNS.some((re) => re.test(value));
  }
  if (Array.isArray(value)) return value.some(containsDenylistedContent);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(containsDenylistedContent);
  }
  return false;
}

function validateMetadata(eventType: string, metadata: unknown): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
  const schema = METADATA_SCHEMAS[eventType];

  if (!schema) {
    if (metadata === undefined || metadata === null) return { ok: true, value: null };
    return { ok: false, error: `${eventType} does not accept metadata` };
  }

  if (metadata === undefined || metadata === null) {
    // Every field in every current schema is optional at the type level
    // (paywall_viewed in particular has none required) — an event with an
    // all-optional schema may omit metadata entirely.
    return { ok: true, value: null };
  }

  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { ok: false, error: 'metadata must be an object' };
  }

  const obj = metadata as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(key in schema)) return { ok: false, error: `unknown metadata key: ${key}` };
    if (!schema[key](obj[key])) return { ok: false, error: `invalid value for metadata.${key}` };
  }

  if (containsDenylistedContent(obj)) {
    return { ok: false, error: 'metadata contains disallowed content' };
  }

  return { ok: true, value: obj };
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;

  // Strict top-level schema: reject the whole request if it carries any key
  // outside the allowlist — this is the structural enforcement for "userId
  // (or provider/idempotencyKey/emitter/anything else) is never accepted
  // from the client," not a per-field special case.
  for (const key of Object.keys(input)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      return NextResponse.json({ error: `unknown field: ${key}` }, { status: 400 });
    }
  }

  // userId is never read from the client body — resolved from the session
  // only. A client-supplied `userId` key is rejected above, before this
  // point is ever reached.
  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id ?? null;

  // ── Rate limit — Postgres-backed, keyed on the authenticated user when
  //    present, otherwise on the trusted client IP. ────────────────────────
  const rlKey = sessionUserId
    ? `analytics-event:user:${hashRateLimitIdentifier(sessionUserId)}`
    : `analytics-event:ip:${hashRateLimitIdentifier(getTrustedClientIp(req) ?? 'unknown')}`;
  const rl = await checkRateLimitDb(rlKey, 60, 60 * 1000); // 60/min
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  const eventType = input.eventType;
  if (typeof eventType !== 'string' || !CLIENT_EVENT_TYPES.has(eventType)) {
    return NextResponse.json({ error: 'invalid eventType' }, { status: 400 });
  }

  if (!sessionUserId && !ANONYMOUS_ALLOWED_EVENT_TYPES.has(eventType)) {
    return NextResponse.json({ error: 'authentication required for this eventType' }, { status: 401 });
  }

  const originPlatform = input.originPlatform;
  if (typeof originPlatform !== 'string' || !VALID_ORIGIN_PLATFORMS.has(originPlatform as OriginPlatform)) {
    return NextResponse.json({ error: 'invalid originPlatform' }, { status: 400 });
  }

  let source: string | null = null;
  if (input.source !== undefined) {
    if (typeof input.source !== 'string' || input.source.length > MAX_SOURCE_LENGTH || containsDenylistedContent(input.source)) {
      return NextResponse.json({ error: 'invalid source' }, { status: 400 });
    }
    source = input.source;
  }

  const metaResult = validateMetadata(eventType, input.metadata);
  if (!metaResult.ok) {
    return NextResponse.json({ error: metaResult.error }, { status: 400 });
  }

  await recordAnalyticsEvent({
    eventType,
    originPlatform: originPlatform as OriginPlatform,
    emitter: 'client',
    userId: sessionUserId,
    source,
    metadata: metaResult.value ?? undefined,
    // Client-fired UX events never carry an idempotencyKey — occasional
    // duplicates from this class of event are an acceptable, expected
    // characteristic, not a correctness bug (see lib/analyticsEvents.ts).
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}

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
 *     trial_expired, subscription_renewed, checkout_started) are
 *     structurally unreachable here: they are not in CLIENT_EVENT_TYPES, so
 *     they're rejected by the allowlist check before anything else runs,
 *     AND this route never calls recordAnalyticsEvent() with emitter other
 *     than 'client' — a caller cannot claim to be a server/webhook write
 *     through this endpoint. checkout_started specifically is authoritative
 *     from app/api/stripe/checkout/route.ts only, fired exclusively after a
 *     genuine Stripe Checkout Session is created — see the Analytics
 *     Authority Correction note on CLIENT_EVENT_TYPES below for why it was
 *     removed from client-emittable status.
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
 * subscription_renewed, checkout_started) is server/webhook-authoritative
 * and intentionally absent from this set — see lib/analyticsEvents.ts's
 * header.
 *
 * Analytics Authority Correction — checkout_started was briefly present
 * here during early P0C-1B design, before app/api/stripe/checkout/route.ts
 * became its sole authoritative source (fired only after a genuine Stripe
 * Checkout Session is created — see that file). Leaving it client-emittable
 * here let an authenticated client submit a self-reported checkout_started
 * that was never a real Stripe session — it couldn't grant entitlement
 * (Stripe/webhook logic doesn't read this route's writes), but it could
 * pollute first-party funnel counts. Removed to match the same
 * server-only authority class as the other events listed above.
 */
const CLIENT_EVENT_TYPES = new Set([
  'calculator_completed',
  'rental_assistant_opened',
  'rental_setup_started',
  'rental_setup_step_viewed',
  'rental_fuel_needed_calculated',
  'paywall_viewed',
  // Growth Sprint 1 — native IAP funnel. Deliberately a DIFFERENT event name
  // from the web `checkout_started` (which is server-authoritative, fired
  // only after a real Stripe Checkout Session exists — see the removed-entry
  // comment below). Native purchases run entirely in the RevenueCat
  // Capacitor SDK inside the WebView; there is no server round-trip at
  // "purchase attempt started" time to hook into, so this can only ever be
  // a self-reported client signal, same trust class as paywall_viewed —
  // never used to gate or verify entitlement. Fired from lib/iap.ts's
  // purchasePro(), immediately before the native purchase sheet is invoked.
  'iap_checkout_started',
  // Phase 2A conversion analytics (2026-08-25) — fired client-side, before
  // the existing purchase flow starts; never gates or verifies entitlement,
  // same trust class as iap_checkout_started/paywall_viewed.
  'upgrade_plan_selected',
  // Fired once per page load when the Rental Return Mode line renders on
  // the upgrade page — an impression, not a measured-visibility "viewed"
  // event (no IntersectionObserver here), named accordingly.
  'rental_return_feature_impression',
  // Phase 3A (2026-08-25) — fired once per Calculate Fill interaction inside
  // Rental Return Mode. No gallons/price/cost values — those are the user's
  // own transaction data, not funnel metadata. rental_fill_logged /
  // rental_final_fill_logged / rental_session_completed are server-
  // authoritative (fired from lib/rentalFillups.ts / lib/rentalSessions.ts
  // directly) and deliberately absent from this client-facing allowlist,
  // same pattern as rental_setup_completed and purchase_completed.
  'rental_fill_calculated',
  // Phase 4 (2026-08-25) — fired once when the user CONFIRMS a new fuel
  // gauge visual style (vehicle edit form or the Rental Return Mode
  // shortcut), never on preview taps, gauge movement, or default
  // resolution. Presentation-only preference — no fuel/gallons data.
  'fuel_gauge_style_selected',
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
  // Same page context as paywall_viewed — the upgrade page and its Rental
  // Return Mode line are both visible pre-signup.
  'upgrade_plan_selected',
  'rental_return_feature_impression',
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

interface MetadataSchema {
  fields:   Record<string, (v: unknown) => boolean>;
  /** Keys in `fields` that MUST be present — an omitted or empty metadata
   *  object is rejected for a schema with any required field. A schema
   *  with no required fields (paywall_viewed) may omit metadata entirely. */
  required: string[];
}

/**
 * Strict per-eventType metadata contracts. An event not listed here (i.e.
 * every event with no meaningful metadata) accepts only null/undefined
 * metadata — any provided object is rejected, not silently passed through.
 */
const METADATA_SCHEMAS: Record<string, MetadataSchema> = {
  // Growth Sprint 1, P0C-2B1 — bounded to the three existing calculator
  // modes only. No dollar amounts, fuel/gallon/vehicle data, or any other
  // input value is ever accepted here — see components/TargetFillForm.tsx,
  // BudgetForm.tsx, EvCalculatorForm.tsx.
  calculator_completed: {
    fields: {
      calculator: (v) => v === 'target' || v === 'budget' || v === 'ev',
    },
    required: ['calculator'],
  },
  rental_setup_step_viewed: {
    fields: {
      step: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7,
    },
    required: ['step'],
  },
  // checkout_started has no entry here — it is server-authoritative
  // (app/api/stripe/checkout/route.ts) and structurally unreachable through
  // this route now that it's absent from CLIENT_EVENT_TYPES above.
  iap_checkout_started: {
    fields: {
      billing: (v) => v === 'monthly' || v === 'lifetime',
    },
    required: ['billing'],
  },
  paywall_viewed: {
    fields: {
      showGetaway: (v) => typeof v === 'boolean',
      wb:          (v) => typeof v === 'boolean',
    },
    required: [],
  },
  upgrade_plan_selected: {
    fields: {
      billing: (v) => v === 'monthly' || v === 'lifetime',
    },
    required: ['billing'],
  },
  // No metadata needed — fired once per page render, originPlatform (the
  // top-level, already-validated field) is sufficient.
  rental_return_feature_impression: {
    fields: {},
    required: [],
  },
  fuel_gauge_style_selected: {
    fields: {
      style:   (v) => v === 'analog_needle' || v === 'horizontal_segments' || v === 'vertical_segments' || v === 'quarter_marks',
      context: (v) => v === 'vehicle' || v === 'rental',
    },
    required: ['style', 'context'],
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

/** Own-property check that cannot be fooled by prototype-chain-inherited
 *  properties (`toString`, `constructor`, `hasOwnProperty`, etc.) or by a
 *  crafted `__proto__` key — `key in schema.fields` would treat any of
 *  those as "present" even though the caller never actually set them,
 *  since `in` also matches inherited properties. */
function hasOwnKey(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function validateMetadata(eventType: string, metadata: unknown): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
  const schema = METADATA_SCHEMAS[eventType];

  if (!schema) {
    if (metadata === undefined || metadata === null) return { ok: true, value: null };
    return { ok: false, error: `${eventType} does not accept metadata` };
  }

  if (metadata === undefined || metadata === null) {
    if (schema.required.length > 0) {
      return { ok: false, error: `${eventType} requires metadata: ${schema.required.join(', ')}` };
    }
    // No required fields (paywall_viewed) — an all-optional schema may
    // omit metadata entirely.
    return { ok: true, value: null };
  }

  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { ok: false, error: 'metadata must be an object' };
  }

  const obj = metadata as Record<string, unknown>;

  for (const requiredKey of schema.required) {
    if (!hasOwnKey(obj, requiredKey)) {
      return { ok: false, error: `${eventType} requires metadata.${requiredKey}` };
    }
  }

  for (const key of Object.keys(obj)) {
    // Object.keys() only ever returns the object's own enumerable string
    // keys, so this loop already can't be tricked by inherited/prototype
    // properties — the hasOwnKey check below is what protects the
    // schema.fields lookup itself (a plain `key in schema.fields` would
    // incorrectly treat 'toString'/'constructor'/etc. as valid schema
    // fields, since `in` matches inherited properties too).
    if (!hasOwnKey(schema.fields, key)) return { ok: false, error: `unknown metadata key: ${key}` };
    if (!schema.fields[key](obj[key])) return { ok: false, error: `invalid value for metadata.${key}` };
  }

  if (containsDenylistedContent(obj)) {
    return { ok: false, error: 'metadata contains disallowed content' };
  }

  return { ok: true, value: obj };
}

export async function POST(req: Request) {
  const raw = await req.text();
  // `raw.length` is a JS UTF-16 code-unit count, not a byte count — a body
  // whose character count is under MAX_BODY_BYTES can still exceed it in
  // actual UTF-8 bytes once multibyte characters are involved. Measure the
  // real wire size instead.
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
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

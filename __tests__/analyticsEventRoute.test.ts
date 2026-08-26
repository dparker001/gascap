/**
 * Route-level tests for POST /api/analytics/event — the UNTRUSTED public
 * client-ingest endpoint. Verifies the hardening contract: no client-
 * supplied userId, fixed eventType allowlist, strict originPlatform enum,
 * strict per-eventType metadata schemas with unknown-key rejection, PII/
 * secret denylist, and that server/webhook-only event types are unreachable
 * through this route. See __tests__/analyticsEvents.test.ts for the
 * trusted internal writer this route calls into.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getServerSession = vi.fn(async (..._args: unknown[]) => null as unknown);
const recordAnalyticsEvent = vi.fn(async (..._args: unknown[]) => ({ outcome: 'written' as const, id: 'evt_1' }));
const checkRateLimitDb = vi.fn(async (..._args: unknown[]) => ({ allowed: true, remaining: 59, resetInSeconds: 60 }));

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/analyticsEvents', () => ({
  recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])),
}));
vi.mock('@/lib/rateLimitDb', () => ({
  checkRateLimitDb: (...a: unknown[]) => checkRateLimitDb(...(a as [])),
  hashRateLimitIdentifier: (s: string) => `hashed:${s}`,
}));
vi.mock('@/lib/clientIp', () => ({ getTrustedClientIp: () => '203.0.113.7' }));

async function post(body: unknown) {
  const { POST } = await import('@/app/api/analytics/event/route');
  const req = new Request('https://www.gascap.app/api/analytics/event', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue(null);
  checkRateLimitDb.mockResolvedValue({ allowed: true, remaining: 59, resetInSeconds: 60 });
});

describe('POST /api/analytics/event', () => {
  it('accepts a valid anonymous calculator_completed event', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', metadata: { calculator: 'target' } });
    expect(res.status).toBe(202);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.userId).toBeNull();
    expect(call.emitter).toBe('client');
  });

  it('rejects a client-supplied userId — the strict top-level schema rejects the whole request, not just that field', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'real-session-user' } });
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', userId: 'attacker-supplied-id' });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('resolves userId from the session for a legitimate request with no userId field at all', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'real-session-user' } });
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', metadata: { calculator: 'target' } });
    expect(res.status).toBe(202);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.userId).toBe('real-session-user');
  });

  it('rejects any other unexpected top-level field, e.g. a client trying to claim provider', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', provider: 'stripe' });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied idempotencyKey', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', idempotencyKey: 'fake-key' });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects an eventType not in the client allowlist', async () => {
    const res = await post({ eventType: 'purchase_completed', originPlatform: 'web' });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('AUTH-CS5. rejects every server/webhook-only event type through this route, not just purchase_completed — includes checkout_started', async () => {
    const serverOnly = [
      'signup_completed', 'trial_started', 'vehicle_saved', 'fillup_logged',
      'rental_setup_completed', 'trial_expired', 'subscription_renewed',
      'checkout_started',
    ];
    for (const eventType of serverOnly) {
      const res = await post({ eventType, originPlatform: 'web' });
      expect(res.status).toBe(400);
    }
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied emitter field outright — the strict schema does not even let it through to be overridden', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', emitter: 'webhook' });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('always writes emitter: "client" for a legitimate request, since the caller has no way to supply it', async () => {
    await post({ eventType: 'calculator_completed', originPlatform: 'web', metadata: { calculator: 'target' } });
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.emitter).toBe('client');
  });

  it('rejects an invalid originPlatform', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'roku' });
    expect(res.status).toBe(400);
  });

  it('rejects the client claiming originPlatform "unknown" — reserved for server-side resolution failures', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'unknown' });
    expect(res.status).toBe(400);
  });

  it('requires authentication for an event not in the anonymous allowlist', async () => {
    const res = await post({ eventType: 'rental_setup_started', originPlatform: 'web' });
    expect(res.status).toBe(401);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('allows rental_setup_started when authenticated', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({ eventType: 'rental_setup_started', originPlatform: 'ios' });
    expect(res.status).toBe(202);
  });

  it('accepts valid rental_setup_step_viewed metadata', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({ eventType: 'rental_setup_step_viewed', originPlatform: 'web', metadata: { step: 3 } });
    expect(res.status).toBe(202);
  });

  it('rejects an out-of-range step value', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({ eventType: 'rental_setup_step_viewed', originPlatform: 'web', metadata: { step: 9 } });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown metadata key rather than silently stripping it', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({
      eventType: 'rental_setup_step_viewed',
      originPlatform: 'web',
      metadata: { step: 2, extraField: 'sneaky' },
    });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects rental_setup_step_viewed with omitted metadata — step is required', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({ eventType: 'rental_setup_step_viewed', originPlatform: 'web' });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects rental_setup_step_viewed with an empty metadata object', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({ eventType: 'rental_setup_step_viewed', originPlatform: 'web', metadata: {} });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  // ── Analytics Authority Correction — checkout_started is now strictly
  // server-authoritative (app/api/stripe/checkout/route.ts only). It was
  // briefly client-emittable here during early P0C-1B design; an
  // authenticated client submitting it here could never grant Stripe
  // entitlement, but could still pollute first-party funnel counts with a
  // self-reported "checkout started" that never touched Stripe. These
  // tests replace the old "accepts a valid checkout_started" coverage.

  it('AUTH-CS1. authenticated client submits checkout_started (Monthly-shaped metadata) → 400, no write', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({
      eventType: 'checkout_started',
      originPlatform: 'web',
      metadata: { billing: 'monthly', method: 'stripe' },
    });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('AUTH-CS2. authenticated client submits checkout_started (Lifetime-shaped metadata) → 400, no write', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({
      eventType: 'checkout_started',
      originPlatform: 'web',
      metadata: { billing: 'lifetime', method: 'stripe' },
    });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('AUTH-CS3. anonymous checkout_started → 400, no write', async () => {
    const res = await post({ eventType: 'checkout_started', originPlatform: 'web' });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('AUTH-CS4. checkout_started is rejected even with otherwise-schema-valid client metadata — the eventType allowlist rejects it before metadata is ever inspected', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({
      eventType: 'checkout_started',
      originPlatform: 'web',
      metadata: { billing: 'monthly', method: 'iap' },
    });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('paywall_viewed remains valid with no metadata at all — it has no required fields', async () => {
    const res = await post({ eventType: 'paywall_viewed', originPlatform: 'web' });
    expect(res.status).toBe(202);
  });

  // ── iap_checkout_started — native purchase-attempt funnel signal ────────
  // Deliberately NOT the same event type as the server-authoritative web
  // checkout_started (AUTH-CS1-5 above) — this is a self-reported client
  // event, requires an authenticated session (native purchase requires
  // sign-in), and requires `billing`.

  it('IAP1. authenticated iap_checkout_started with valid billing → 202, written', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({
      eventType: 'iap_checkout_started',
      originPlatform: 'ios',
      metadata: { billing: 'lifetime' },
    });
    expect(res.status).toBe(202);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({ eventType: 'iap_checkout_started', emitter: 'client', userId: 'u1' });
  });

  it('IAP2. anonymous iap_checkout_started → rejected, no write (not in ANONYMOUS_ALLOWED_EVENT_TYPES)', async () => {
    const res = await post({
      eventType: 'iap_checkout_started',
      originPlatform: 'ios',
      metadata: { billing: 'monthly' },
    });
    expect(res.status).toBe(401);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('IAP3. authenticated iap_checkout_started missing billing → 400, no write', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({ eventType: 'iap_checkout_started', originPlatform: 'ios' });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('IAP4. authenticated iap_checkout_started with invalid billing value → 400, no write', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({
      eventType: 'iap_checkout_started',
      originPlatform: 'android',
      metadata: { billing: 'annual' },
    });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects metadata containing a "toString" key rather than treating it as a valid schema field via prototype-chain matching', async () => {
    // Growth Sprint 1, Analytics Authority Correction — moved off
    // checkout_started (now server-only, rejected before metadata is ever
    // inspected) onto calculator_completed, a remaining metadata-bearing
    // CLIENT event, so this protection is still meaningfully exercised.
    const req = new Request('https://www.gascap.app/api/analytics/event', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: '{"eventType":"calculator_completed","originPlatform":"web","metadata":{"calculator":"target","toString":"x"}}',
    });
    const { POST } = await import('@/app/api/analytics/event/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects metadata containing a "constructor" key', async () => {
    const req = new Request('https://www.gascap.app/api/analytics/event', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: '{"eventType":"calculator_completed","originPlatform":"web","metadata":{"calculator":"target","constructor":"x"}}',
    });
    const { POST } = await import('@/app/api/analytics/event/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects metadata containing a "__proto__" key without throwing and without polluting Object.prototype', async () => {
    const req = new Request('https://www.gascap.app/api/analytics/event', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: '{"eventType":"calculator_completed","originPlatform":"web","metadata":{"calculator":"target","__proto__":{"polluted":true}}}',
    });
    const { POST } = await import('@/app/api/analytics/event/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects metadata on an event that accepts none', async () => {
    // Growth Sprint 1, P0C-2B1 — calculator_completed now has a required
    // schema (see below), so an event that genuinely accepts NO metadata
    // is needed here instead.
    const res = await post({ eventType: 'rental_assistant_opened', originPlatform: 'web', metadata: { anything: 1 } });
    expect(res.status).toBe(400);
  });

  it('rejects a source field containing an email address', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', source: 'referred-by:someone@example.com' });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects a source field containing a URL', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', source: 'https://evil.example.com/track' });
    expect(res.status).toBe(400);
  });

  it('rejects metadata containing a bearer-token-shaped string', async () => {
    // calculator_completed's schema only allows enum-valued fields, so this
    // exercises the enum check rejecting the string outright — the denylist
    // is defense in depth for a future looser schema, tested at the
    // metadata-object level via containsDenylistedContent below.
    const res = await post({
      eventType: 'calculator_completed',
      originPlatform: 'web',
      metadata: { calculator: 'Bearer abc.def.ghi' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects an oversized payload with 413, before any field-level validation runs', async () => {
    const res = await post({
      eventType: 'calculator_completed',
      originPlatform: 'web',
      source: 'x'.repeat(5000),
    });
    expect(res.status).toBe(413);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects a source field over the max length even when the overall payload is small', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', source: 'x'.repeat(100) });
    expect(res.status).toBe(400);
  });

  it('measures the body limit in real UTF-8 bytes, not JS string length — a multibyte body under 2048 characters but over 2048 bytes is rejected', async () => {
    // '中' is one UTF-16 code unit (JS string length 1) but 3 bytes in UTF-8.
    // 1000 repeats: string length ~1000 (well under 2048), but byte length
    // ~3000 (over 2048). A byte-blind `raw.length > MAX_BODY_BYTES` check
    // would incorrectly accept this; Buffer.byteLength must catch it.
    const multibyteSource = '中'.repeat(1000);
    const rawBody = JSON.stringify({ eventType: 'calculator_completed', originPlatform: 'web', source: multibyteSource });
    expect(rawBody.length).toBeLessThan(2048);
    expect(Buffer.byteLength(rawBody, 'utf8')).toBeGreaterThan(2048);

    const { POST } = await import('@/app/api/analytics/event/route');
    const req = new Request('https://www.gascap.app/api/analytics/event', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: rawBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('enforces rate limiting', async () => {
    checkRateLimitDb.mockResolvedValueOnce({ allowed: false, remaining: 0, resetInSeconds: 30 });
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web' });
    expect(res.status).toBe(429);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('keys the rate limit on the session user when authenticated', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    await post({ eventType: 'paywall_viewed', originPlatform: 'web' });
    const key = checkRateLimitDb.mock.calls[0][0] as string;
    expect(key).toContain('user:');
  });

  it('keys the rate limit on IP when anonymous', async () => {
    await post({ eventType: 'paywall_viewed', originPlatform: 'web' });
    const key = checkRateLimitDb.mock.calls[0][0] as string;
    expect(key).toContain('ip:');
  });

  it('rejects malformed JSON', async () => {
    const { POST } = await import('@/app/api/analytics/event/route');
    const req = new Request('https://www.gascap.app/api/analytics/event', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ── Growth Sprint 1, P0C-2B1 — calculator_completed metadata contract ────

  it('ING-CALC1. calculator_completed + {calculator:"target"} → accepted', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', metadata: { calculator: 'target' } });
    expect(res.status).toBe(202);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.metadata).toEqual({ calculator: 'target' });
  });

  it('ING-CALC2. calculator_completed + {calculator:"budget"} → accepted', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', metadata: { calculator: 'budget' } });
    expect(res.status).toBe(202);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.metadata).toEqual({ calculator: 'budget' });
  });

  it('ING-CALC3. calculator_completed + {calculator:"ev"} → accepted', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', metadata: { calculator: 'ev' } });
    expect(res.status).toBe(202);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.metadata).toEqual({ calculator: 'ev' });
  });

  it('ING-CALC4. calculator_completed with no metadata → 400 (calculator is required)', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web' });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('ING-CALC5. unknown calculator enum value → 400', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', metadata: { calculator: 'trip' } });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('ING-CALC6. extra metadata field beyond calculator → 400, not silently stripped', async () => {
    const res = await post({
      eventType: 'calculator_completed',
      originPlatform: 'web',
      metadata: { calculator: 'target', gallons: 12 },
    });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('ING-CALC7. PII/secret-shaped unexpected metadata cannot bypass the strict schema', async () => {
    const res = await post({
      eventType: 'calculator_completed',
      originPlatform: 'web',
      metadata: { calculator: 'target', email: 'someone@example.com' },
    });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('ING-CALC8. anonymous calculator_completed remains accepted', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', metadata: { calculator: 'budget' } });
    expect(res.status).toBe(202);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.userId).toBeNull();
  });

  it('ING-CALC9. client-supplied userId is still rejected at the top level, even with valid calculator metadata', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'real-session-user' } });
    const res = await post({
      eventType: 'calculator_completed',
      originPlatform: 'web',
      userId: 'attacker-supplied-id',
      metadata: { calculator: 'target' },
    });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });
});

// ── Phase 2A conversion analytics (2026-08-25) ──────────────────────────────
describe('POST /api/analytics/event — upgrade_plan_selected', () => {
  it('accepts a valid anonymous upgrade_plan_selected event with billing metadata', async () => {
    const res = await post({ eventType: 'upgrade_plan_selected', originPlatform: 'web', metadata: { billing: 'lifetime' } });
    expect(res.status).toBe(202);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.userId).toBeNull();
    expect(call.emitter).toBe('client');
  });

  it('accepts billing: monthly too', async () => {
    const res = await post({ eventType: 'upgrade_plan_selected', originPlatform: 'ios', metadata: { billing: 'monthly' } });
    expect(res.status).toBe(202);
  });

  it('rejects a missing billing field', async () => {
    const res = await post({ eventType: 'upgrade_plan_selected', originPlatform: 'web' });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects an invalid billing value', async () => {
    const res = await post({ eventType: 'upgrade_plan_selected', originPlatform: 'web', metadata: { billing: 'annual' } });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects an unknown metadata key (e.g. an attempted getawayShown claim)', async () => {
    const res = await post({ eventType: 'upgrade_plan_selected', originPlatform: 'web', metadata: { billing: 'lifetime', getawayShown: true } });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('does not accept a client-supplied userId', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'real-session-user' } });
    const res = await post({ eventType: 'upgrade_plan_selected', originPlatform: 'web', userId: 'attacker', metadata: { billing: 'lifetime' } });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/analytics/event — rental_return_feature_impression', () => {
  it('accepts the event with no metadata at all (impression, not a measured-visibility event)', async () => {
    const res = await post({ eventType: 'rental_return_feature_impression', originPlatform: 'web' });
    expect(res.status).toBe(202);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.userId).toBeNull();
  });

  it('rejects any metadata, since this event carries none', async () => {
    const res = await post({ eventType: 'rental_return_feature_impression', originPlatform: 'web', metadata: { anything: true } });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('is anonymous-allowed, same page context as paywall_viewed', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await post({ eventType: 'rental_return_feature_impression', originPlatform: 'web' });
    expect(res.status).toBe(202);
  });
});

// Phase 4 (2026-08-25)
describe('POST /api/analytics/event — fuel_gauge_style_selected', () => {
  it('accepts a valid vehicle-context selection', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({ eventType: 'fuel_gauge_style_selected', originPlatform: 'web', metadata: { style: 'quarter_marks', context: 'vehicle' } });
    expect(res.status).toBe(202);
  });

  it('accepts a valid rental-context selection', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await post({ eventType: 'fuel_gauge_style_selected', originPlatform: 'web', metadata: { style: 'horizontal_segments', context: 'rental' } });
    expect(res.status).toBe(202);
  });

  it('rejects a missing style or context', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const res1 = await post({ eventType: 'fuel_gauge_style_selected', originPlatform: 'web', metadata: { context: 'vehicle' } });
    expect(res1.status).toBe(400);
    const res2 = await post({ eventType: 'fuel_gauge_style_selected', originPlatform: 'web', metadata: { style: 'quarter_marks' } });
    expect(res2.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects an invalid style value or context value', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    expect((await post({ eventType: 'fuel_gauge_style_selected', originPlatform: 'web', metadata: { style: 'digital_percent', context: 'vehicle' } })).status).toBe(400);
    expect((await post({ eventType: 'fuel_gauge_style_selected', originPlatform: 'web', metadata: { style: 'quarter_marks', context: 'garage' } })).status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('requires a signed-in session — not anonymous-allowed', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await post({ eventType: 'fuel_gauge_style_selected', originPlatform: 'web', metadata: { style: 'quarter_marks', context: 'vehicle' } });
    expect(res.status).toBe(401);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });
});

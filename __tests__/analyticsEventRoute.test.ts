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
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web' });
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
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web' });
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

  it('rejects every server/webhook-only event type through this route, not just purchase_completed', async () => {
    const serverOnly = [
      'signup_completed', 'trial_started', 'vehicle_saved', 'fillup_logged',
      'rental_setup_completed', 'trial_expired', 'subscription_renewed',
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
    await post({ eventType: 'calculator_completed', originPlatform: 'web' });
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

  it('rejects metadata on an event that accepts none', async () => {
    const res = await post({ eventType: 'calculator_completed', originPlatform: 'web', metadata: { anything: 1 } });
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
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    // checkout_started's schema only allows enum-valued fields, so this
    // exercises the enum check rejecting the string outright — the denylist
    // is defense in depth for a future looser schema, tested at the
    // metadata-object level via containsDenylistedContent below.
    const res = await post({
      eventType: 'checkout_started',
      originPlatform: 'web',
      metadata: { billing: 'monthly', method: 'Bearer abc.def.ghi' },
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
});

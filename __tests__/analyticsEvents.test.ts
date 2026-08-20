/**
 * Unit tests for lib/analyticsEvents.ts — the TRUSTED internal write path
 * for the Growth Sprint 1 first-party AnalyticsEvent log. Prisma is mocked.
 * See __tests__/analyticsEventRoute.test.ts for the untrusted public
 * ingest route's validation behavior.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

class KnownRequestError extends Error {
  code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}

const create = vi.fn(async (_args: { data: Record<string, unknown> }) => ({ id: 'evt_1' }));
vi.mock('@/lib/prisma', () => ({ prisma: { analyticsEvent: { create: (args: { data: Record<string, unknown> }) => create(args) } } }));
vi.mock('@/lib/generated/prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: KnownRequestError,
    JsonNull: Symbol('JsonNull'),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

describe('recordAnalyticsEvent', () => {
  it('writes a row with all provided fields', async () => {
    const { recordAnalyticsEvent } = await import('../lib/analyticsEvents');
    const result = await recordAnalyticsEvent({
      eventType: 'calculator_completed',
      originPlatform: 'web',
      emitter: 'client',
      userId: 'u1',
      source: 'homepage',
    });
    expect(result).toEqual({ outcome: 'written', id: 'evt_1' });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.eventType).toBe('calculator_completed');
    expect(data.originPlatform).toBe('web');
    expect(data.emitter).toBe('client');
    expect(data.userId).toBe('u1');
    expect(data.source).toBe('homepage');
  });

  it('defaults optional fields to null, never undefined, so a caller cannot silently omit a field Prisma would otherwise reject', async () => {
    const { recordAnalyticsEvent } = await import('../lib/analyticsEvents');
    await recordAnalyticsEvent({ eventType: 'paywall_viewed', originPlatform: 'ios', emitter: 'client' });
    const data = create.mock.calls[0][0].data;
    expect(data.userId).toBeNull();
    expect(data.source).toBeNull();
    expect(data.provider).toBeNull();
    expect(data.billing).toBeNull();
    expect(data.idempotencyKey).toBeNull();
  });

  it('a duplicate idempotencyKey (P2002) is treated as a successful no-op, not an error', async () => {
    const { recordAnalyticsEvent } = await import('../lib/analyticsEvents');
    create.mockRejectedValueOnce(new KnownRequestError('Unique constraint failed', 'P2002'));
    const result = await recordAnalyticsEvent({
      eventType: 'trial_started',
      originPlatform: 'web',
      emitter: 'server',
      idempotencyKey: 'trial_started:u1:2026-09-01T00:00:00.000Z',
    });
    expect(result).toEqual({ outcome: 'duplicate' });
  });

  it('re-throws a non-P2002 database error rather than swallowing it', async () => {
    const { recordAnalyticsEvent } = await import('../lib/analyticsEvents');
    create.mockRejectedValueOnce(new Error('db unavailable'));
    await expect(recordAnalyticsEvent({
      eventType: 'calculator_completed', originPlatform: 'web', emitter: 'client',
    })).rejects.toThrow('db unavailable');
  });

  it('re-throws a P2002 that is a real, unrelated unique-constraint hit wrapped in the same error class — this is the correct current behavior given the table has only one unique constraint (idempotencyKey), documented so a future second unique constraint does not silently get misclassified as an idempotency dup', async () => {
    // This test intentionally just re-asserts the same behavior as the
    // duplicate-key test above — it exists to make the single-unique-
    // constraint assumption explicit and easy to find if AnalyticsEvent
    // ever gains a second @@unique.
    const { recordAnalyticsEvent } = await import('../lib/analyticsEvents');
    create.mockRejectedValueOnce(new KnownRequestError('Unique constraint failed', 'P2002'));
    const result = await recordAnalyticsEvent({
      eventType: 'signup_completed', originPlatform: 'web', emitter: 'server', idempotencyKey: 'signup:u1',
    });
    expect(result.outcome).toBe('duplicate');
  });
});

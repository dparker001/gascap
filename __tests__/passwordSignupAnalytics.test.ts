/**
 * TC-2B-A (2026-09-01) — regression coverage for lib/users.ts's createUser()
 * emitting signup_completed on genuine email/password account creation.
 *
 * Mirrors createGoogleUser()'s existing, already-tested pattern exactly
 * (see __tests__/signupTrialAnalytics.test.ts for the Google-path sibling).
 * Behavioral: invokes the real createUser() with mocked prisma/analytics.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const userFindFirst = vi.fn(async () => null as unknown);
const userCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
  id: args.data.id, email: args.data.email, name: args.data.name, plan: 'free',
  createdAt: args.data.createdAt, passwordHash: args.data.passwordHash,
  isProTrial: false, trialExpiresAt: null, activeDays: [], badges: [],
  ambassadorTierRewardsSent: [],
}));
const recordAnalyticsEvent = vi.fn(async (..._a: unknown[]) => ({ outcome: 'written' as const, id: 'evt_1' }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: (...a: unknown[]) => userFindFirst(...(a as [])),
      create: (args: { data: Record<string, unknown> }) => userCreate(args),
    },
  },
}));
vi.mock('@/lib/analyticsEvents', () => ({
  recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])),
}));
vi.mock('bcryptjs', () => ({ default: { hash: async () => 'hashed-password' } }));

describe('createUser() emits signup_completed exactly once on genuine account creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindFirst.mockResolvedValue(null);
    userCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: args.data.id, email: args.data.email, name: args.data.name, plan: 'free',
      createdAt: args.data.createdAt, passwordHash: args.data.passwordHash,
      isProTrial: false, trialExpiresAt: null, activeDays: [], badges: [],
      ambassadorTierRewardsSent: [],
    }));
  });

  it('1. successful createUser() emits exactly one signup_completed', async () => {
    const { createUser } = await import('@/lib/users');
    await createUser('Jane Doe', 'jane@example.com', 'password123', 'en');
    const calls = recordAnalyticsEvent.mock.calls.filter(
      (c) => (c[0] as { eventType?: string }).eventType === 'signup_completed',
    );
    expect(calls.length).toBe(1);
  });

  it('2. event contains the exact required shape', async () => {
    const { createUser } = await import('@/lib/users');
    const user = await createUser('Jane Doe', 'jane@example.com', 'password123', 'en');
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.eventType).toBe('signup_completed');
    expect(call.emitter).toBe('server');
    expect(call.userId).toBe(user.id);
    expect(call.source).toBe('auth_signup');
    expect(call.idempotencyKey).toBe(`signup_completed:${user.id}`);
    expect((call.metadata as { signupMethod?: string }).signupMethod).toBe('password');
    expect(call.originPlatform).toBe('unknown');
  });

  it('3. an analytics-write failure does NOT cause createUser() to reject', async () => {
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('db unavailable'));
    const { createUser } = await import('@/lib/users');
    await expect(createUser('Jane Doe', 'jane2@example.com', 'password123', 'en')).resolves.toBeDefined();
  });

  it('4. a failed User INSERT does not emit signup_completed', async () => {
    userCreate.mockRejectedValueOnce(new Error('unique constraint'));
    const { createUser } = await import('@/lib/users');
    await expect(createUser('Jane Doe', 'jane3@example.com', 'password123', 'en')).rejects.toThrow();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('5. an existing-account rejection does not emit signup_completed', async () => {
    userFindFirst.mockResolvedValueOnce({ id: 'existing-user', email: 'jane4@example.com' });
    const { createUser } = await import('@/lib/users');
    await expect(createUser('Jane Doe', 'jane4@example.com', 'password123', 'en')).rejects.toThrow(
      'An account with that email already exists.',
    );
    expect(userCreate).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });
});

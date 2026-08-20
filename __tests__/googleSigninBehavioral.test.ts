/**
 * Growth Sprint 1, P0C-1A Google-race correction — behavioral (not
 * source-inspection) coverage for lib/auth.ts's authOptions.callbacks.signIn
 * Google branch.
 *
 * authOptions.callbacks.signIn is a plain top-level property, not something
 * passed into CredentialsProvider()/GoogleProvider() — so it can be invoked
 * directly after importing authOptions, once those two provider factories
 * are stubbed out (they only need to not throw at module-load time; nothing
 * in this test exercises them). No live database is used anywhere.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => ({ id: 'credentials', type: 'credentials', ...(config as object) }) }));
vi.mock('next-auth/providers/google', () => ({ default: (config: unknown) => ({ id: 'google', type: 'oauth', ...(config as object) }) }));

vi.mock('@/lib/prisma', () => ({ pgPool: { query: vi.fn(async () => ({ rows: [] })) }, prisma: {} }));

const findByEmail = vi.fn(async (_email: string) => undefined as unknown);
const createGoogleUser = vi.fn(async (..._a: unknown[]) => ({ user: {} as unknown, created: true }));
const grantNewSignupProTrial = vi.fn(async (_id: string, _days: number) => null as unknown);
const recordLogin = vi.fn(async (_id: string) => {});
const enrollEmailCampaign = vi.fn(async (_id: string) => {});
vi.mock('@/lib/users', () => ({
  findByEmail: (...a: unknown[]) => findByEmail(...(a as [string])),
  findById: vi.fn(async () => undefined),
  verifyPassword: vi.fn(async () => false),
  createGoogleUser: (...a: unknown[]) => createGoogleUser(...(a as [])),
  nameFromEmail: (e: string) => e.split('@')[0],
  grantNewSignupProTrial: (...a: unknown[]) => grantNewSignupProTrial(...(a as [string, number])),
  enrollEmailCampaign: (...a: unknown[]) => enrollEmailCampaign(...(a as [string])),
  recordLogin: (...a: unknown[]) => recordLogin(...(a as [string])),
  findByReferralCode: vi.fn(async () => null),
  setReferredBy: vi.fn(async () => {}),
}));

const recordAnalyticsEvent = vi.fn(async (..._a: unknown[]) => ({ outcome: 'written' as const, id: 'evt_1' }));
vi.mock('@/lib/analyticsEvents', () => ({
  recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])),
}));

vi.mock('@/lib/ghl', () => ({ upsertGhlContact: vi.fn(async () => true) }));
vi.mock('@/lib/email', () => ({ sendMail: vi.fn(async () => {}) }));
vi.mock('@/lib/emailCampaign', () => ({ sendCampaignEmail: vi.fn(async () => {}) }));
vi.mock('@/lib/emailLog', () => ({ hasEmailBeenSent: vi.fn(async () => true) }));
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 10, resetInSeconds: 60 })) }));

const EMAIL = 'buyer@example.com';
const NEW_USER = { id: 'new-google-user-1', email: EMAIL, name: 'New Buyer', plan: 'free', isProTrial: false, trialExpiresAt: null, createdAt: '2026-08-20T00:00:00.000Z' };
const EXISTING_USER = { id: 'existing-google-user-1', email: EMAIL, name: 'Returning Buyer', plan: 'pro', isProTrial: false, trialExpiresAt: null, createdAt: '2026-01-01T00:00:00.000Z' };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  findByEmail.mockResolvedValue(undefined);
  createGoogleUser.mockResolvedValue({ user: NEW_USER, created: true });
  grantNewSignupProTrial.mockResolvedValue(null);
  recordAnalyticsEvent.mockResolvedValue({ outcome: 'written', id: 'evt_1' });
});

async function callSignIn(overrides: { user?: Record<string, unknown> } = {}) {
  const { authOptions } = await import('@/lib/auth');
  const user = { id: 'placeholder', email: EMAIL, name: 'Buyer', ...overrides.user };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signIn = authOptions.callbacks!.signIn as any;
  return signIn({ user, account: { provider: 'google' }, profile: { picture: null } });
}

describe('Google signIn() callback — behavioral', () => {
  it('GOOGLE1. real new user — trial granted, trial_started fires once with the new user id, campaign/login/onboarding proceed', async () => {
    findByEmail.mockResolvedValueOnce(undefined);
    createGoogleUser.mockResolvedValueOnce({ user: NEW_USER, created: true });
    grantNewSignupProTrial.mockResolvedValueOnce({ id: NEW_USER.id, isProTrial: true });

    const result = await callSignIn();

    expect(result).toBe(true);
    expect(grantNewSignupProTrial).toHaveBeenCalledTimes(1);
    expect(grantNewSignupProTrial).toHaveBeenCalledWith(NEW_USER.id, 30);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({ eventType: 'trial_started', userId: NEW_USER.id, idempotencyKey: `trial_started:${NEW_USER.id}` });
    expect(enrollEmailCampaign).toHaveBeenCalledWith(NEW_USER.id);
    expect(recordLogin).toHaveBeenCalledWith(NEW_USER.id);
  });

  it('GOOGLE2. normal returning user — createGoogleUser not called, no trial grant, no trial_started, recordLogin called once', async () => {
    findByEmail.mockResolvedValueOnce(EXISTING_USER);

    const result = await callSignIn();

    expect(result).toBe(true);
    expect(createGoogleUser).not.toHaveBeenCalled();
    expect(grantNewSignupProTrial).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
    expect(recordLogin).toHaveBeenCalledTimes(1);
    expect(recordLogin).toHaveBeenCalledWith(EXISTING_USER.id);
  });

  it('GOOGLE3. CRITICAL REGRESSION — race case: outer lookup found nothing, but createGoogleUser reports created:false — must be treated exactly like a returning login, never mutate trial state', async () => {
    findByEmail.mockResolvedValueOnce(undefined); // outer lookup: nothing yet
    createGoogleUser.mockResolvedValueOnce({ user: EXISTING_USER, created: false }); // race loser

    const result = await callSignIn();

    expect(result).toBe(true);
    expect(grantNewSignupProTrial).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled(); // no trial_started, no signup_completed from this callback
    expect(enrollEmailCampaign).not.toHaveBeenCalled();
    expect(recordLogin).toHaveBeenCalledTimes(1);
    expect(recordLogin).toHaveBeenCalledWith(EXISTING_USER.id);
  });

  it('GOOGLE4. actual create + trial grant returns null — signup remains successful, no trial_started', async () => {
    findByEmail.mockResolvedValueOnce(undefined);
    createGoogleUser.mockResolvedValueOnce({ user: NEW_USER, created: true });
    grantNewSignupProTrial.mockResolvedValueOnce(null);

    const result = await callSignIn();

    expect(result).toBe(true);
    expect(grantNewSignupProTrial).toHaveBeenCalledTimes(1);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
    expect(enrollEmailCampaign).toHaveBeenCalledWith(NEW_USER.id);
  });

  it('GOOGLE5. trial_started analytics write throws — signIn still succeeds, granted trial remains intact, onboarding proceeds', async () => {
    findByEmail.mockResolvedValueOnce(undefined);
    createGoogleUser.mockResolvedValueOnce({ user: NEW_USER, created: true });
    grantNewSignupProTrial.mockResolvedValueOnce({ id: NEW_USER.id, isProTrial: true });
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('db unavailable'));

    const result = await callSignIn();

    expect(result).toBe(true);
    expect(grantNewSignupProTrial).toHaveBeenCalledTimes(1);
    expect(enrollEmailCampaign).toHaveBeenCalledWith(NEW_USER.id);
    expect(recordLogin).toHaveBeenCalledWith(NEW_USER.id);
  });
});

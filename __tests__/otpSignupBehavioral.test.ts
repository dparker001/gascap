/**
 * Growth Sprint 1, P0C-1A — behavioral (not source-inspection) coverage for
 * the OTP CredentialsProvider's authorize() callback, specifically its
 * signup_completed / trial_started analytics wiring.
 *
 * Strategy: mock next-auth/providers/credentials so the config objects
 * passed to CredentialsProvider() are captured, then invoke the captured
 * 'credentials-otp' provider's authorize() function directly with a mocked
 * pgPool, findByEmail, grantNewSignupProTrial, recordLogin, and every other
 * side effect authorize() touches. No live database is used anywhere.
 *
 * No production code was changed to make this possible — everything
 * authorize() calls was already an imported function, mockable via vi.mock.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Capture the real authorize() functions passed to CredentialsProvider ───
type AuthorizeFn = (credentials: Record<string, string> | undefined, req?: unknown) => Promise<unknown>;
const capturedProviders: Record<string, { authorize: AuthorizeFn }> = {};

vi.mock('next-auth/providers/credentials', () => ({
  default: (config: { id?: string; name?: string; authorize: AuthorizeFn }) => {
    const key = config.id ?? config.name ?? 'credentials';
    capturedProviders[key] = { authorize: config.authorize };
    return { id: key, type: 'credentials', ...config };
  },
}));
vi.mock('next-auth/providers/google', () => ({
  default: (config: unknown) => ({ id: 'google', type: 'oauth', ...(config as object) }),
}));

// ── pgPool: raw SQL used by the OTP path directly ───────────────────────────
const pgQuery = vi.fn(async (..._a: unknown[]) => ({ rows: [] as unknown[] }));
vi.mock('@/lib/prisma', () => ({
  pgPool: { query: (...a: unknown[]) => pgQuery(...a) },
  prisma: {},
}));

// ── lib/users functions authorize() calls ───────────────────────────────────
const findByEmail = vi.fn(async (_email: string) => undefined as unknown);
const grantNewSignupProTrial = vi.fn(async (_id: string, _days: number) => null as unknown);
const recordLogin = vi.fn(async (_id: string) => {});
const verifyPassword = vi.fn(async () => false);
const createGoogleUser = vi.fn(async () => ({}) as unknown);
const nameFromEmail = (email: string) => email.split('@')[0];
const enrollEmailCampaign = vi.fn(async () => {});
vi.mock('@/lib/users', () => ({
  findByEmail: (...a: unknown[]) => findByEmail(...(a as [string])),
  findById: vi.fn(async () => undefined),
  verifyPassword: (...a: unknown[]) => verifyPassword(...(a as [])),
  recordLogin: (...a: unknown[]) => recordLogin(...(a as [string])),
  createGoogleUser: (...a: unknown[]) => createGoogleUser(...(a as [])),
  nameFromEmail: (e: string) => nameFromEmail(e),
  grantNewSignupProTrial: (...a: unknown[]) => grantNewSignupProTrial(...(a as [string, number])),
  enrollEmailCampaign: (...a: unknown[]) => enrollEmailCampaign(...(a as [])),
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

const NEW_USER_ID = 'new-user-uuid-1';
const OTP_CODE = '123456';
const EMAIL = 'buyer@example.com';

function mockOtpCodeRow() {
  // First pgQuery call reads the OtpCode row; matches authorize()'s SELECT.
  pgQuery.mockImplementationOnce(async () => ({
    rows: [{ code: OTP_CODE, name: 'Test Buyer', expires: new Date(Date.now() + 5 * 60_000) }],
  }));
  // Second call: DELETE FROM "OtpCode" (consume).
  pgQuery.mockImplementationOnce(async () => ({ rows: [] }));
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  findByEmail.mockResolvedValue(undefined);
  grantNewSignupProTrial.mockResolvedValue(null);
  recordAnalyticsEvent.mockResolvedValue({ outcome: 'written', id: 'evt_1' });
});

async function getOtpAuthorize() {
  await import('@/lib/auth'); // constructs authOptions, populating capturedProviders
  const provider = capturedProviders['credentials-otp'];
  if (!provider) throw new Error('credentials-otp provider was not captured');
  return provider.authorize;
}

describe('OTP authorize() — behavioral, signup_completed / trial_started', () => {
  it('OTP1. new user, trial grant succeeds — signup_completed and trial_started both fire correctly, authorize succeeds', async () => {
    mockOtpCodeRow();
    // INSERT ... RETURNING id, name, plan
    pgQuery.mockImplementationOnce(async () => ({ rows: [{ id: NEW_USER_ID, name: 'Test Buyer', plan: 'free' }] }));
    findByEmail
      .mockResolvedValueOnce(undefined) // pre-INSERT existence check → new user
      .mockResolvedValueOnce({ id: NEW_USER_ID, email: EMAIL, name: 'Test Buyer', plan: 'free', isProTrial: false, trialExpiresAt: null }) // post-INSERT lookup
      .mockResolvedValueOnce({ id: NEW_USER_ID, email: EMAIL, name: 'Test Buyer', plan: 'pro', isProTrial: true, trialExpiresAt: '2026-09-19T00:00:00.000Z' }); // post-trial-grant refresh
    grantNewSignupProTrial.mockResolvedValueOnce({ id: NEW_USER_ID, isProTrial: true });

    const authorize = await getOtpAuthorize();
    const result = await authorize({ email: EMAIL, code: OTP_CODE, platform: 'ios' });

    expect(result).toMatchObject({ id: NEW_USER_ID, email: EMAIL });

    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(2);
    const signupCall = recordAnalyticsEvent.mock.calls.find((c) => (c[0] as Record<string, unknown>).eventType === 'signup_completed')?.[0] as Record<string, unknown>;
    const trialCall  = recordAnalyticsEvent.mock.calls.find((c) => (c[0] as Record<string, unknown>).eventType === 'trial_started')?.[0] as Record<string, unknown>;

    expect(signupCall).toMatchObject({
      eventType: 'signup_completed', userId: NEW_USER_ID, originPlatform: 'ios',
      emitter: 'server', source: 'auth_signup', idempotencyKey: `signup_completed:${NEW_USER_ID}`,
    });
    expect((signupCall.metadata as Record<string, unknown>).signupMethod).toBe('otp');

    expect(trialCall).toMatchObject({
      eventType: 'trial_started', userId: NEW_USER_ID,
      idempotencyKey: `trial_started:${NEW_USER_ID}`,
    });
  });

  it('OTP2. returning user — no User INSERT, no signup_completed, no trial_started, login still succeeds', async () => {
    mockOtpCodeRow();
    findByEmail.mockResolvedValue({ id: 'existing-user-1', email: EMAIL, name: 'Existing', plan: 'pro', isProTrial: false, trialExpiresAt: null });

    const authorize = await getOtpAuthorize();
    const result = await authorize({ email: EMAIL, code: OTP_CODE, platform: 'web' });

    expect(result).toMatchObject({ id: 'existing-user-1' });
    // Only the OTP-row SELECT + DELETE — no INSERT INTO "User".
    const insertCalls = pgQuery.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO "User"'));
    expect(insertCalls.length).toBe(0);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
    expect(grantNewSignupProTrial).not.toHaveBeenCalled();
    expect(recordLogin).toHaveBeenCalledWith('existing-user-1');
  });

  it('OTP3. create succeeds, trial grant returns null — signup_completed still fires exactly once, trial_started does not fire, authorize still succeeds', async () => {
    mockOtpCodeRow();
    pgQuery.mockImplementationOnce(async () => ({ rows: [{ id: NEW_USER_ID, name: 'Test Buyer', plan: 'free' }] }));
    findByEmail
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: NEW_USER_ID, email: EMAIL, name: 'Test Buyer', plan: 'free', isProTrial: false, trialExpiresAt: null })
      .mockResolvedValueOnce({ id: NEW_USER_ID, email: EMAIL, name: 'Test Buyer', plan: 'free', isProTrial: false, trialExpiresAt: null });
    grantNewSignupProTrial.mockResolvedValueOnce(null); // simulates the internal catch(() => null)

    const authorize = await getOtpAuthorize();
    const result = await authorize({ email: EMAIL, code: OTP_CODE, platform: 'web' });

    expect(result).toMatchObject({ id: NEW_USER_ID });
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.eventType).toBe('signup_completed');
  });

  it('OTP4. signup analytics write throws — account creation and authorize() still succeed, trial grant is still attempted', async () => {
    mockOtpCodeRow();
    pgQuery.mockImplementationOnce(async () => ({ rows: [{ id: NEW_USER_ID, name: 'Test Buyer', plan: 'free' }] }));
    findByEmail
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: NEW_USER_ID, email: EMAIL, name: 'Test Buyer', plan: 'free', isProTrial: false, trialExpiresAt: null })
      .mockResolvedValueOnce({ id: NEW_USER_ID, email: EMAIL, name: 'Test Buyer', plan: 'pro', isProTrial: true, trialExpiresAt: '2026-09-19T00:00:00.000Z' });
    grantNewSignupProTrial.mockResolvedValueOnce({ id: NEW_USER_ID, isProTrial: true });
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('db unavailable')); // signup_completed write fails

    const authorize = await getOtpAuthorize();
    const result = await authorize({ email: EMAIL, code: OTP_CODE, platform: 'web' });

    expect(result).toMatchObject({ id: NEW_USER_ID });
    expect(grantNewSignupProTrial).toHaveBeenCalledTimes(1);
    // Second (trial_started) call still attempted despite the first rejecting.
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(2);
  });

  it('OTP5. trial analytics write throws — authorize still succeeds, account and trial remain intact', async () => {
    mockOtpCodeRow();
    pgQuery.mockImplementationOnce(async () => ({ rows: [{ id: NEW_USER_ID, name: 'Test Buyer', plan: 'free' }] }));
    findByEmail
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: NEW_USER_ID, email: EMAIL, name: 'Test Buyer', plan: 'free', isProTrial: false, trialExpiresAt: null })
      .mockResolvedValueOnce({ id: NEW_USER_ID, email: EMAIL, name: 'Test Buyer', plan: 'pro', isProTrial: true, trialExpiresAt: '2026-09-19T00:00:00.000Z' });
    grantNewSignupProTrial.mockResolvedValueOnce({ id: NEW_USER_ID, isProTrial: true });
    recordAnalyticsEvent
      .mockResolvedValueOnce({ outcome: 'written', id: 'evt_1' }) // signup_completed succeeds
      .mockRejectedValueOnce(new Error('db unavailable'));         // trial_started fails

    const authorize = await getOtpAuthorize();
    const result = await authorize({ email: EMAIL, code: OTP_CODE, platform: 'web' });

    expect(result).toMatchObject({ id: NEW_USER_ID, isProTrial: true });
    expect(grantNewSignupProTrial).toHaveBeenCalledTimes(1);
  });

  it('OTP6. invalid/expired OTP code — authorize returns null, no signup_completed, no trial_started, no User INSERT', async () => {
    pgQuery.mockImplementationOnce(async () => ({ rows: [] })); // no matching OtpCode row

    const authorize = await getOtpAuthorize();
    const result = await authorize({ email: EMAIL, code: 'wrong-code', platform: 'web' });

    expect(result).toBeNull();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
    expect(grantNewSignupProTrial).not.toHaveBeenCalled();
    const insertCalls = pgQuery.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO "User"'));
    expect(insertCalls.length).toBe(0);
  });
});

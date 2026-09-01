/**
 * TC-2B-A (2026-09-01) — regression coverage for app/api/auth/register's
 * POST handler emitting trial_started only when grantNewSignupProTrial()
 * actually succeeds (mirrors the OTP path's existing pattern — see
 * __tests__/otpSignupBehavioral.test.ts). Behavioral: invokes the real
 * POST route with the entire @/lib/users module mocked (this route only
 * needs the shape of those functions, not their real bodies — real
 * createUser()/grantNewSignupProTrial() behavior is covered separately by
 * __tests__/passwordSignupAnalytics.test.ts and pre-existing tests).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const createUser = vi.fn(async (name: string, email: string) => {
  // Mirrors createUser()'s real signup_completed emission (see
  // __tests__/passwordSignupAnalytics.test.ts for the behavioral proof
  // against the REAL function) so this file's tests can honestly assert
  // "signup_completed still fires even when the later trial grant fails"
  // without re-implementing createUser()'s full real body here.
  await recordAnalyticsEvent({
    eventType: 'signup_completed',
    originPlatform: 'unknown',
    emitter: 'server',
    userId: 'new-user-1',
    source: 'auth_signup',
    idempotencyKey: 'signup_completed:new-user-1',
    metadata: { signupMethod: 'password' },
  });
  return {
    id: 'new-user-1', email, name, plan: 'free', createdAt: new Date().toISOString(),
    isProTrial: false, trialExpiresAt: null,
  };
});
const findByEmail = vi.fn(async () => null as unknown);
const findByReferralCode = vi.fn(async () => null as unknown);
const setReferredBy = vi.fn(async () => {});
const createEmailVerifyToken = vi.fn(async () => 'verify-token');
const grantNewSignupProTrial = vi.fn(async (): Promise<{ id: string; plan: string; isProTrial: boolean; trialExpiresAt: string } | null> =>
  ({ id: 'new-user-1', plan: 'pro', isProTrial: true, trialExpiresAt: '2026-10-01' }));
const enrollEmailCampaign = vi.fn(async () => {});
const updateUserProfile = vi.fn(async () => {});
const nameFromEmail = vi.fn((email: string) => email.split('@')[0]);
const recordAnalyticsEvent = vi.fn(async (..._a: unknown[]) => ({ outcome: 'written' as const, id: 'evt_1' }));
const checkRateLimit = vi.fn(() => ({ allowed: true, remaining: 9, resetInSeconds: 3600 }));
const sendMail = vi.fn(async () => {});
const sendCampaignEmail = vi.fn(async () => {});
const hasEmailBeenSent = vi.fn(async () => false);
const upsertGhlContact = vi.fn(async () => {});
const upsertGhlContactWithCampaign = vi.fn(async () => {});
const getPlacementByCode = vi.fn(async () => null);
const logEvent = vi.fn(async () => {});

vi.mock('@/lib/users', () => ({
  createUser: (...a: unknown[]) => createUser(...(a as [string, string])),
  findByEmail: (...a: unknown[]) => findByEmail(...(a as [])),
  findByReferralCode: (...a: unknown[]) => findByReferralCode(...(a as [])),
  setReferredBy: (...a: unknown[]) => setReferredBy(...(a as [])),
  createEmailVerifyToken: (...a: unknown[]) => createEmailVerifyToken(...(a as [])),
  grantNewSignupProTrial: (...a: unknown[]) => grantNewSignupProTrial(...(a as [])),
  enrollEmailCampaign: (...a: unknown[]) => enrollEmailCampaign(...(a as [])),
  updateUserProfile: (...a: unknown[]) => updateUserProfile(...(a as [])),
  nameFromEmail: (...a: unknown[]) => nameFromEmail(...(a as [string])),
}));
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...(a as [])) }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])) }));
vi.mock('@/lib/email', () => ({ sendMail: (...a: unknown[]) => sendMail(...(a as [])), verificationEmailHtml: () => '<html></html>' }));
vi.mock('@/lib/emailCampaign', () => ({ sendCampaignEmail: (...a: unknown[]) => sendCampaignEmail(...(a as [])) }));
vi.mock('@/lib/emailLog', () => ({ hasEmailBeenSent: (...a: unknown[]) => hasEmailBeenSent(...(a as [])) }));
vi.mock('@/lib/ghl', () => ({
  upsertGhlContact: (...a: unknown[]) => upsertGhlContact(...(a as [])),
  upsertGhlContactWithCampaign: (...a: unknown[]) => upsertGhlContactWithCampaign(...(a as [])),
}));
vi.mock('@/lib/campaigns', () => ({
  getPlacementByCode: (...a: unknown[]) => getPlacementByCode(...(a as [])),
  logEvent: (...a: unknown[]) => logEvent(...(a as [])),
}));

describe('POST /api/auth/register emits trial_started only on a successful trial grant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByEmail.mockResolvedValue(null);
    checkRateLimit.mockReturnValue({ allowed: true, remaining: 9, resetInSeconds: 3600 });
    grantNewSignupProTrial.mockResolvedValue({ id: 'new-user-1', plan: 'pro', isProTrial: true, trialExpiresAt: '2026-10-01' });
    // createUser keeps its module-level implementation (declared above),
    // which itself emits signup_completed via recordAnalyticsEvent —
    // overriding it here with a bare mockResolvedValue would silently
    // bypass that emission for every test in this file.
    recordAnalyticsEvent.mockResolvedValue({ outcome: 'written', id: 'evt_1' });
  });

  function post(body: Record<string, unknown>) {
    return import('@/app/api/auth/register/route').then(({ POST }) =>
      POST(new Request('https://www.gascap.app/api/auth/register', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      })),
    );
  }

  const validBody = { email: 'jane@example.com', password: 'password123', firstName: 'Jane' };

  it('6. a successful grant causes exactly one trial_started', async () => {
    await post(validBody);
    const calls = recordAnalyticsEvent.mock.calls.filter(
      (c) => (c[0] as { eventType?: string }).eventType === 'trial_started',
    );
    expect(calls.length).toBe(1);
  });

  it('7. event contains the exact required shape', async () => {
    await post(validBody);
    const call = recordAnalyticsEvent.mock.calls.find(
      (c) => (c[0] as { eventType?: string }).eventType === 'trial_started',
    )![0] as Record<string, unknown>;
    expect(call.emitter).toBe('server');
    expect(call.userId).toBe('new-user-1');
    expect(call.source).toBe('signup_trial');
    expect(call.idempotencyKey).toBe('trial_started:new-user-1');
    expect(call.originPlatform).toBe('unknown');
  });

  it('8. a trial grant returning null still succeeds registration (201) and still records signup_completed, but emits NO trial_started', async () => {
    grantNewSignupProTrial.mockResolvedValueOnce(null);
    const res = await post(validBody);
    expect(res.status).toBe(201);
    const signupCompletedCalls = recordAnalyticsEvent.mock.calls.filter(
      (c) => (c[0] as { eventType?: string }).eventType === 'signup_completed',
    );
    expect(signupCompletedCalls.length).toBe(1);
    const trialStartedCalls = recordAnalyticsEvent.mock.calls.filter(
      (c) => (c[0] as { eventType?: string }).eventType === 'trial_started',
    );
    expect(trialStartedCalls.length).toBe(0);
  });

  it('9. a trial_started analytics-write failure does not turn registration into an HTTP failure', async () => {
    recordAnalyticsEvent.mockImplementation(async (arg: unknown) => {
      if ((arg as { eventType?: string }).eventType === 'trial_started') throw new Error('db unavailable');
      return { outcome: 'written' as const, id: 'evt_1' };
    });
    const res = await post(validBody);
    expect(res.status).toBe(201);
  });

  it('12. neither event appears in the public client analytics route source (no client-side emitter added)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/api/analytics/event/route.ts'), 'utf8',
    );
    expect(src).not.toContain("'signup_completed'");
    expect(src).not.toContain("'trial_started'");
  });

  it('13. Google/OTP signup analytics behavior unchanged — files untouched by this fix', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const authSrc = fs.readFileSync(path.join(process.cwd(), 'lib/auth.ts'), 'utf8');
    expect(authSrc).toContain('idempotencyKey: `trial_started:${user!.id}`');
    const usersSrc = fs.readFileSync(path.join(process.cwd(), 'lib/users.ts'), 'utf8');
    expect(usersSrc).toContain("signupMethod: 'google'");
  });

  it('14. trial duration remains 30 days', async () => {
    await post(validBody);
    expect(grantNewSignupProTrial).toHaveBeenCalledWith('new-user-1', 30);
  });
});

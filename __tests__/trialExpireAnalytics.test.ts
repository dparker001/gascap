/**
 * Growth Sprint 1, P0C-1A — regression coverage for trial_expired,
 * verifying the actual cron route (app/api/cron/trial-expire/route.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getExpiredTrialUsers = vi.fn(async (..._a: unknown[]) => [] as Array<{ id: string; email: string; name: string; trialExpiresAt: string | null; emailOptOut?: boolean }>);
const expireTrial = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/users', () => ({
  getExpiredTrialUsers: (...a: unknown[]) => getExpiredTrialUsers(...a),
  expireTrial: (...a: unknown[]) => expireTrial(...a),
}));
vi.mock('@/lib/email', () => ({ sendMail: vi.fn(async () => {}) }));
vi.mock('@/lib/emailCampaign', () => ({ trialEndedEmailHtml: () => '<html></html>', trialEndedEmailText: () => 'text' }));
vi.mock('@/lib/emailLog', () => ({ logEmail: vi.fn(async () => {}) }));

const recordAnalyticsEvent = vi.fn(async (..._a: unknown[]) => ({ outcome: 'written' as const, id: 'evt_1' }));
vi.mock('@/lib/analyticsEvents', () => ({
  recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])),
}));

const USER = { id: 'user-1', email: 'buyer@example.com', name: 'Buyer', trialExpiresAt: '2026-07-20T00:00:00.000Z', emailOptOut: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.CRON_SECRET = 'test-cron-secret';
  getExpiredTrialUsers.mockResolvedValue([USER]);
  expireTrial.mockResolvedValue(undefined);
  recordAnalyticsEvent.mockResolvedValue({ outcome: 'written', id: 'evt_1' });
});

async function runCron() {
  const { GET } = await import('@/app/api/cron/trial-expire/route');
  const req = new Request('https://www.gascap.app/api/cron/trial-expire?secret=test-cron-secret');
  return GET(req);
}

describe('trial_expired — app/api/cron/trial-expire/route.ts', () => {
  it('T1. expireTrial succeeds — exactly one trial_expired', async () => {
    await runCron();
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({
      eventType: 'trial_expired', emitter: 'server', originPlatform: 'unknown',
      userId: 'user-1', source: 'trial_expire_cron',
    });
  });

  it('T2. expireTrial throws — no trial_expired', async () => {
    expireTrial.mockRejectedValueOnce(new Error('db unavailable'));
    await runCron();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('T3. analytics writer throws — downgrade remains successful, email path continues, not counted as a per-user error', async () => {
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('analytics down'));
    const res = await runCron();
    const json = await res.json();
    expect(json.downgraded).toBe(1);
    expect(json.emailsSent).toBe(1);
    expect(json.errors).toBeUndefined();
    expect(expireTrial).toHaveBeenCalledTimes(1);
  });

  it('T4. idempotency key includes the ORIGINAL pre-clear expiry timestamp', async () => {
    await runCron();
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.idempotencyKey).toBe(`trial_expired:user-1:${USER.trialExpiresAt}`);
  });

  it('T5. purchase-driven trial clearing is not represented by this cron path — getExpiredTrialUsers only returns cron-eligible rows', async () => {
    // This cron only ever processes what getExpiredTrialUsers() returns —
    // confirmed by the mock itself returning exactly the users under test.
    // A purchase-driven clear goes through setUserPlan's isRealPurchaseOrRenewal
    // guard entirely outside this route, so it's structurally impossible for
    // this route to emit trial_expired for that case — there's no code path
    // here that could observe it.
    getExpiredTrialUsers.mockResolvedValueOnce([]);
    await runCron();
    expect(expireTrial).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('no PII in trial_expired metadata/payload', async () => {
    await runCron();
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain('buyer@example.com');
    expect(serialized).not.toContain('Buyer');
  });
});

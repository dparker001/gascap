/**
 * GET /api/cron/trial-conversion — C4 recipient-gating regression coverage.
 *
 * Per ChatGPT's review of PR #17: C4's copy states "your trial is ending
 * soon", but isProTrial alone doesn't guarantee that — a 30-day trial user
 * on day 1 still has isProTrial: true. This proves the actual `where`
 * clause the route builds for step=4 (captured from the real prisma.user.findMany
 * call, not reimplemented separately) correctly restricts to trials expiring
 * within the 48-hour window, in addition to the pre-existing engagement and
 * opt-out/test-account conditions.
 *
 * The evaluator below applies the CAPTURED where object against synthetic
 * user records — it exercises the actual object the route builds, not an
 * assumption about it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FakeUser {
  id: string; name: string; email: string;
  plan: string; isProTrial: boolean; emailOptOut: boolean; isTestAccount: boolean;
  calcCount: number; streak: number; trialExpiresAt: string | null;
}

let dataset: FakeUser[] = [];
const findMany = vi.fn(async (...args: unknown[]) => {
  const { where } = args[0] as { where: Record<string, unknown> };
  return dataset.filter((u) => matchesWhere(u, where)).map((u) => ({ id: u.id, name: u.name, email: u.email }));
});

// Minimal evaluator for exactly the where shapes this route builds —
// equality, `not`, `gte`, `OR` array, and `trialExpiresAt: { not, gt, lte }`.
function matchesWhere(u: FakeUser, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      const branches = cond as Record<string, unknown>[];
      if (!branches.some((b) => matchesWhere(u, b))) return false;
      continue;
    }
    const actual = (u as unknown as Record<string, unknown>)[key];
    if (cond !== null && typeof cond === 'object') {
      const c = cond as { not?: unknown; gte?: number; gt?: string; lte?: string };
      if ('not' in c && actual === c.not) return false;
      if (c.gte !== undefined && !(typeof actual === 'number' && actual >= c.gte)) return false;
      if (c.gt !== undefined && !(typeof actual === 'string' && actual !== null && actual > c.gt)) return false;
      if (c.lte !== undefined && !(typeof actual === 'string' && actual !== null && actual <= c.lte)) return false;
    } else if (actual !== cond) {
      return false;
    }
  }
  return true;
}

const hasEmailBeenSent = vi.fn(async () => false);
const sendConversionEmail = vi.fn(async () => {});
const logEmailError = vi.fn(async () => {});

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: (...a: unknown[]) => findMany(...(a as [])) } } }));
vi.mock('@/lib/emailTrialConversion', () => ({ sendConversionEmail: (...a: unknown[]) => sendConversionEmail(...(a as [])) }));
vi.mock('@/lib/emailLog', () => ({
  hasEmailBeenSent: (...a: unknown[]) => hasEmailBeenSent(...(a as [])),
  logEmailError: (...a: unknown[]) => logEmailError(...(a as [])),
}));

const SECRET = 'test-cron-secret';

function isoInHours(h: number): string {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

function baseUser(overrides: Partial<FakeUser>): FakeUser {
  return {
    id: 'u1', name: 'Test User', email: 'test@example.com',
    plan: 'pro', isProTrial: true, emailOptOut: false, isTestAccount: false,
    calcCount: 0, streak: 0, trialExpiresAt: null,
    ...overrides,
  };
}

async function getStep4() {
  const { GET } = await import('@/app/api/cron/trial-conversion/route');
  const req = new Request(`https://www.gascap.app/api/cron/trial-conversion?secret=${SECRET}&step=4`);
  return GET(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', SECRET);
  dataset = [];
  hasEmailBeenSent.mockResolvedValue(false);
});

describe('GET /api/cron/trial-conversion — C4 (step=4) recipient gating', () => {
  it('C4-1. engaged trial expiring inside the 48h window → eligible, email sent', async () => {
    dataset = [baseUser({ id: 'in-window', calcCount: 3, trialExpiresAt: isoInHours(24) })];
    const res = await getStep4();
    const json = await res.json() as { sent: number };
    expect(res.status).toBe(200);
    expect(json.sent).toBe(1);
    expect(sendConversionEmail).toHaveBeenCalledWith(4, expect.objectContaining({ id: 'in-window' }));
  });

  it('C4-2. engaged active trial expiring well outside the window (e.g. 10 days out) → not eligible, no email', async () => {
    dataset = [baseUser({ id: 'far-out', calcCount: 5, trialExpiresAt: isoInHours(240) })];
    const res = await getStep4();
    const json = await res.json() as { sent: number };
    expect(json.sent).toBe(0);
    expect(sendConversionEmail).not.toHaveBeenCalled();
  });

  it('C4-3. already-expired trial → not eligible, no email', async () => {
    dataset = [baseUser({ id: 'expired', calcCount: 5, streak: 10, trialExpiresAt: isoInHours(-2) })];
    const res = await getStep4();
    const json = await res.json() as { sent: number };
    expect(json.sent).toBe(0);
    expect(sendConversionEmail).not.toHaveBeenCalled();
  });

  it('C4-4. near-expiry but non-engaged trial (calcCount < 2 AND streak < 3) → not eligible, no email', async () => {
    dataset = [baseUser({ id: 'unengaged', calcCount: 1, streak: 1, trialExpiresAt: isoInHours(12) })];
    const res = await getStep4();
    const json = await res.json() as { sent: number };
    expect(json.sent).toBe(0);
    expect(sendConversionEmail).not.toHaveBeenCalled();
  });

  it('C4-5. opted-out and test-account users remain excluded even when otherwise eligible', async () => {
    dataset = [
      baseUser({ id: 'opted-out',  calcCount: 5, emailOptOut: true,   trialExpiresAt: isoInHours(24) }),
      baseUser({ id: 'test-acct',  calcCount: 5, isTestAccount: true, trialExpiresAt: isoInHours(24) }),
      baseUser({ id: 'legit',      calcCount: 5, trialExpiresAt: isoInHours(24) }),
    ];
    const res = await getStep4();
    const json = await res.json() as { sent: number };
    expect(json.sent).toBe(1);
    expect(sendConversionEmail).toHaveBeenCalledTimes(1);
    expect(sendConversionEmail).toHaveBeenCalledWith(4, expect.objectContaining({ id: 'legit' }));
  });

  it('C4-6. steps 1-3 are unaffected by the trialExpiresAt window — any active trial qualifies regardless of expiration distance', async () => {
    dataset = [baseUser({ id: 'far-out-step1', calcCount: 0, streak: 0, trialExpiresAt: isoInHours(500) })];
    const { GET } = await import('@/app/api/cron/trial-conversion/route');
    const req = new Request(`https://www.gascap.app/api/cron/trial-conversion?secret=${SECRET}&step=1`);
    const res = await GET(req);
    const json = await res.json() as { sent: number };
    expect(json.sent).toBe(1);
    expect(sendConversionEmail).toHaveBeenCalledWith(1, expect.objectContaining({ id: 'far-out-step1' }));
  });
});

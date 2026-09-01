/**
 * TC-2A (2026-09-01) — GET /api/user/trial-value regression coverage.
 *
 * Proves: unauthenticated requests are rejected; the route uses only the
 * authenticated session's own user id (a request cannot influence which
 * user's data comes back — there is no userId read from query/body/headers);
 * the response contains only the four aggregate fields; no-store cache header.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getServerSession = vi.fn(async () => null as unknown);
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const getTrialValueSummary = vi.fn(async (_userId: string) => ({
  calculations: 3, vehicles: 1, fillups: 2, rentalSessions: 0,
}));
vi.mock('@/lib/trialValue', () => ({
  getTrialValueSummary: (...a: unknown[]) => getTrialValueSummary(...(a as [string])),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  getServerSession.mockResolvedValue(null);
});

describe('GET /api/user/trial-value', () => {
  it('rejects an unauthenticated request with 401', async () => {
    getServerSession.mockResolvedValue(null);
    const { GET } = await import('@/app/api/user/trial-value/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getTrialValueSummary).not.toHaveBeenCalled();
  });

  it('uses only the session\'s own user id — never a caller-supplied one', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'session-user-1', email: 'a@b.com' } });
    const { GET } = await import('@/app/api/user/trial-value/route');
    // GET takes no request/params — there is no channel for a caller to
    // supply a different userId even if it wanted to.
    await GET();
    expect(getTrialValueSummary).toHaveBeenCalledTimes(1);
    expect(getTrialValueSummary).toHaveBeenCalledWith('session-user-1');
  });

  it('response contains only the four aggregate fields', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'session-user-1', email: 'a@b.com' } });
    const { GET } = await import('@/app/api/user/trial-value/route');
    const res = await GET();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['calculations', 'fillups', 'rentalSessions', 'vehicles']);
  });

  it('sets a private, no-store cache header', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'session-user-1', email: 'a@b.com' } });
    const { GET } = await import('@/app/api/user/trial-value/route');
    const res = await GET();
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
    expect(res.headers.get('Cache-Control')).toMatch(/private/);
  });
});

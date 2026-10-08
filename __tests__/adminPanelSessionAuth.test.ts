/**
 * Admin panels must load for a ROLE-BASED admin session (no saved legacy password).
 *
 * Bug (2026-10-08): app/admin/page.tsx signs in silently with an EMPTY password when the
 * browser holds an admin-role session; the server accepts that (lib/adminAuth). But
 * EngagementBaselinePanel and RentalPilotMetrics began with `if (!savedPw) return;`, so they
 * never fetched and stayed on their loading skeleton forever. The client now always makes the
 * request (adding the legacy header only when one exists) and the SERVER stays the authority.
 *
 * Scope note: Gift20FunnelPanel has the same guard but is mounted only on /admin/campaigns,
 * which has its own password gate, so it never receives an empty password (documented, unchanged).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { adminHeaders, fetchAdminJson, loadAdminPanel } from '@/lib/adminFetch';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

const okRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const errRes = (status: number) => ({ ok: false, status, json: async () => ({ error: 'x' }) }) as Response;
const headersOf = (f: ReturnType<typeof vi.fn>) => (f.mock.calls[0][1] as { headers: Record<string, string> }).headers;

describe('adminHeaders — legacy header only when a password exists', () => {
  it('2. legacy flow: a saved password is sent as x-admin-password (unchanged)', () => {
    expect(adminHeaders('s3cret')).toEqual({ 'x-admin-password': 's3cret' });
  });
  it('1. role-based admin: an empty / missing password sends NO legacy header', () => {
    for (const v of ['', undefined, null]) expect(adminHeaders(v)).toEqual({});
    expect('x-admin-password' in adminHeaders('')).toBe(false);
  });
  it('preserves other headers either way (e.g. Content-Type)', () => {
    expect(adminHeaders('', { 'Content-Type': 'application/json' })).toEqual({ 'Content-Type': 'application/json' });
    expect(adminHeaders('pw', { 'Content-Type': 'application/json' })).toEqual({ 'Content-Type': 'application/json', 'x-admin-password': 'pw' });
  });
});

describe('fetchAdminJson / loadAdminPanel', () => {
  it('1. empty savedPw STILL performs the request, without the legacy header', async () => {
    const f = vi.fn(async () => okRes({ n: 1 }));
    const r = await fetchAdminJson<{ n: number }>('/api/admin/x', '', f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    expect(headersOf(f)).toEqual({});
    expect(r).toEqual({ ok: true, data: { n: 1 } });
  });
  it('2. saved password: the same request carries the legacy header', async () => {
    const f = vi.fn(async () => okRes({ n: 1 }));
    await fetchAdminJson('/api/admin/x', 'pw', f as unknown as typeof fetch);
    expect(headersOf(f)).toEqual({ 'x-admin-password': 'pw' });
  });
  it('3. the server decides: 401 / 403 / 503 surface as errors, never as data', async () => {
    for (const s of [401, 403, 503]) {
      const f = vi.fn(async () => errRes(s));
      expect(await fetchAdminJson('/api/admin/x', '', f as unknown as typeof fetch)).toEqual({ ok: false, status: s });
    }
  });
  it('network failure / bad body -> ok:false with status null (never throws)', async () => {
    const boom = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await fetchAdminJson('/api/admin/x', '', boom as unknown as typeof fetch)).toEqual({ ok: false, status: null });
    const badJson = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) as unknown as Response);
    expect(await fetchAdminJson('/api/admin/x', '', badJson as unknown as typeof fetch)).toEqual({ ok: false, status: null });
  });

  it('4. a panel can no longer stay in "loading" because of the auth path: onDone always fires, once', async () => {
    for (const [label, pw, f] of [
      ['role admin, success',     '', vi.fn(async () => okRes({ a: 1 }))],
      ['role admin, 401',         '', vi.fn(async () => errRes(401))],
      ['legacy password, success', 'pw', vi.fn(async () => okRes({ a: 1 }))],
      ['network failure',         '', vi.fn(async () => { throw new Error('net'); })],
    ] as const) {
      const h = { onData: vi.fn(), onError: vi.fn(), onDone: vi.fn() };
      await loadAdminPanel('/api/admin/x', pw, h, f as unknown as typeof fetch);
      expect(h.onDone, label).toHaveBeenCalledTimes(1);
      expect(h.onData.mock.calls.length + h.onError.mock.calls.length, label).toBe(1);
    }
  });
  it('success delivers data; failure delivers the status', async () => {
    const h = { onData: vi.fn(), onError: vi.fn(), onDone: vi.fn() };
    await loadAdminPanel('/u', '', h, (async () => okRes({ z: 9 })) as unknown as typeof fetch);
    expect(h.onData).toHaveBeenCalledWith({ z: 9 });
    const h2 = { onData: vi.fn(), onError: vi.fn(), onDone: vi.fn() };
    await loadAdminPanel('/u', '', h2, (async () => errRes(403)) as unknown as typeof fetch);
    expect(h2.onError).toHaveBeenCalledWith(403);
  });
});

describe('the panels themselves', () => {
  it('4. neither panel returns early when savedPw is empty, and both use the shared loader', () => {
    for (const f of ['components/admin/EngagementBaselinePanel.tsx', 'components/admin/RentalPilotMetrics.tsx']) {
      const src = read(f);
      const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code, f).not.toMatch(/if\s*\(\s*!savedPw\s*\)/);
      expect(code, f).toMatch(/loadAdminPanel</);
      expect(code, f).not.toMatch(/headers:\s*\{\s*'x-admin-password':\s*savedPw\s*\}/);
    }
  });
  it('loading / error / success rendering is untouched (skeleton while loading, message on error)', () => {
    const eb = read('components/admin/EngagementBaselinePanel.tsx');
    expect(eb).toMatch(/if \(loading\)/);
    expect(eb).toMatch(/Failed to load the engagement baseline\./);
    const rp = read('components/admin/RentalPilotMetrics.tsx');
    expect(rp).toMatch(/if \(loading\)/);
    expect(rp).toMatch(/Failed to load rental pilot metrics\./);
  });
  it('the unaffected panel is unchanged: Gift20FunnelPanel keeps its guard (only reachable behind /admin/campaigns\' own password gate)', () => {
    expect(read('components/admin/Gift20FunnelPanel.tsx')).toMatch(/if \(!pw\) return;/);
    expect(read('app/admin/campaigns/page.tsx')).toMatch(/if \(!authed\)/);
  });
});

// ── 3. The SERVER is still the authority (real lib/adminAuth; only session + DB mocked) ──
const getServerSession = vi.fn();
const userFindUnique = vi.fn();
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/engagementBaselineLoader', () => ({
  loadBaselineInput: vi.fn(async () => ({
    now: new Date('2026-10-08T12:00:00Z'), users: [], fillups: {}, savedStationUserIds: [], vehicleUserIds: [],
    events: {}, purchases: [], revenueCat: { CANCELLATION: 0, EXPIRATION: 0, REFUND: 0 },
  })),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique, findMany: vi.fn(async () => []) },
    rentalSession: { findMany: vi.fn(async () => []) },
  },
}));

const req = (headers: Record<string, string> = {}) => new Request('https://x.test/api/admin/x', { headers });
const call = async (which: 'engagement' | 'rental', headers?: Record<string, string>) => {
  vi.resetModules();
  const mod = which === 'engagement'
    ? await import('@/app/api/admin/engagement-baseline/route')
    : await import('@/app/api/admin/rental-pilot/route');
  return mod.GET(req(headers));
};

describe('3. server-side authorization is unchanged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_PASSWORD = 'legacy-secret-for-tests';
    getServerSession.mockResolvedValue(null);
    userFindUnique.mockResolvedValue(null);
  });

  for (const which of ['engagement', 'rental'] as const) {
    describe(which, () => {
      it('1. role-based admin session, NO legacy header -> 200', async () => {
        getServerSession.mockResolvedValue({ user: { id: 'admin-1' } });
        userFindUnique.mockResolvedValue({ id: 'admin-1', email: 'a@b.c', role: 'admin' });
        expect((await call(which)).status).toBe(200);
      });
      it('2. legacy password flow still works (no session)', async () => {
        expect((await call(which, { 'x-admin-password': 'legacy-secret-for-tests' })).status).toBe(200);
      });
      it('3. signed-in NON-admin session is refused (401)', async () => {
        getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
        userFindUnique.mockResolvedValue({ id: 'user-1', email: 'u@b.c', role: 'user' });
        expect((await call(which)).status).toBe(401);
      });
      it('3. no session, no header -> 401', async () => {
        expect((await call(which)).status).toBe(401);
      });
      it('3. no session, WRONG legacy header -> 401', async () => {
        expect((await call(which, { 'x-admin-password': 'nope' })).status).toBe(401);
      });
      it('3. an EMPTY legacy header (what a role-based panel now sends) grants nothing by itself', async () => {
        expect((await call(which, { 'x-admin-password': '' })).status).toBe(401);
      });
      it('3. fails closed (503) when no legacy secret is configured and there is no admin session', async () => {
        delete process.env.ADMIN_PASSWORD;
        expect((await call(which)).status).toBe(503);
      });
    });
  }
});

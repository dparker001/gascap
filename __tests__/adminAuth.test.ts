/**
 * Regression coverage for lib/adminAuth.ts — the dual-auth boundary every
 * privileged admin endpoint now goes through.
 *
 * Every heavy dependency is mocked, matching the RevenueCat webhook test
 * pattern from Sprint 1: this exercises the module's own logic without a
 * database or a real NextAuth session.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getServerSession = vi.fn(async () => null as unknown);
const findUnique = vi.fn(async () => null as unknown);

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...(a as [])) } },
}));

const SECRET = 'test-admin-password-value';

function req(headers: Record<string, string> = {}) {
  return new Request('https://www.gascap.app/api/admin/users', { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.ADMIN_PASSWORD = SECRET;
  getServerSession.mockResolvedValue(null);
  findUnique.mockResolvedValue(null);
});

describe('requireAdmin / sessionHasAdminRole', () => {
  it('1. unauthenticated caller, no header — rejected', async () => {
    const { requireAdmin } = await import('@/lib/adminAuth');
    const res = await requireAdmin(req());
    expect(res.ok).toBe(false);
  });

  it('2. ordinary signed-in user (role=user) — rejected', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    findUnique.mockResolvedValue({ id: 'u1', email: 'user@example.com', role: 'user' });
    const { requireAdmin } = await import('@/lib/adminAuth');
    const res = await requireAdmin(req());
    expect(res.ok).toBe(false);
  });

  it('3. admin session (role=admin, live from DB) — allowed', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'admin1' } });
    findUnique.mockResolvedValue({ id: 'admin1', email: 'don@example.com', role: 'admin' });
    const { requireAdmin } = await import('@/lib/adminAuth');
    const res = await requireAdmin(req());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.via).toBe('session');
  });

  it('4. correct legacy header, no session — allowed via legacy path', async () => {
    const { requireAdmin } = await import('@/lib/adminAuth');
    const res = await requireAdmin(req({ 'x-admin-password': SECRET }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.via).toBe('legacy');
  });

  it('5. wrong legacy header, no session — rejected', async () => {
    const { requireAdmin } = await import('@/lib/adminAuth');
    const res = await requireAdmin(req({ 'x-admin-password': 'wrong' }));
    expect(res.ok).toBe(false);
  });

  it('6. missing ADMIN_PASSWORD env — legacy path fails closed regardless of header', async () => {
    delete process.env.ADMIN_PASSWORD;
    const { requireAdmin } = await import('@/lib/adminAuth');
    const res = await requireAdmin(req({ 'x-admin-password': 'anything' }));
    expect(res.ok).toBe(false);
  });

  it('7. a client-supplied fake role is ignored — role is ALWAYS read from the DB mock, never from a header/body claim', async () => {
    // There is no code path in adminAuth.ts that reads a role from the
    // request at all — this test documents that by asserting a request
    // carrying a role-looking header changes nothing.
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    findUnique.mockResolvedValue({ id: 'u1', email: 'user@example.com', role: 'user' });
    const { requireAdmin } = await import('@/lib/adminAuth');
    const res = await requireAdmin(req({ 'x-role': 'admin', 'x-user-role': 'admin' }));
    expect(res.ok).toBe(false);
  });

  it('8. stale/forged session claim does not override the live DB role', async () => {
    // Simulates a session object that itself carries a role claim (as some
    // JWT-embedded-claims designs do) — sessionHasAdminRole never reads
    // session.user.role, only the DB row, so an attacker-controlled session
    // payload claiming admin cannot grant anything.
    getServerSession.mockResolvedValue({ user: { id: 'u1', role: 'admin' } });
    findUnique.mockResolvedValue({ id: 'u1', email: 'user@example.com', role: 'user' });
    const { requireAdmin } = await import('@/lib/adminAuth');
    const res = await requireAdmin(req());
    expect(res.ok).toBe(false);
  });

  it('9. never echoes the configured secret', async () => {
    const { requireAdmin } = await import('@/lib/adminAuth');
    const res = await requireAdmin(req({ 'x-admin-password': 'wrong' }));
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });

  it('10. isAdmin() convenience wrapper matches requireAdmin()', async () => {
    const { requireAdmin, isAdmin } = await import('@/lib/adminAuth');
    expect(await isAdmin(req({ 'x-admin-password': SECRET }))).toBe(
      (await requireAdmin(req({ 'x-admin-password': SECRET }))).ok,
    );
  });
});

/**
 * Post-Sprint-2 Revision 1 fix — POST /api/announcements was missed in the
 * original Sprint 2 admin-auth sweep: GET's `?all=1` branch was widened to
 * dual-auth, but POST stayed legacy-header-only. Regression coverage per
 * the review's explicit requirement ("Add route-level regression coverage
 * for POST /api/announcements using an admin session").
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getServerSession = vi.fn(async () => null as unknown);
const findUnique = vi.fn(async () => null as unknown);

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...(a as [])) } },
}));

let writtenData: unknown = null;
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(() => JSON.stringify([])),
    writeFileSync: vi.fn((_path: string, data: string) => { writtenData = JSON.parse(data); }),
  },
}));

const SECRET = 'test-admin-password';

async function postAnnouncements(headers: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/announcements/route');
  const req = new Request('https://www.gascap.app/api/announcements', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    body: JSON.stringify([{ id: 'a1', emoji: '🎉', title: 'Test', message: 'hi', startDate: '2026-01-01', endDate: '2026-12-31', targetPlans: [], verifiedOnly: false, trialOnly: false, newUserDays: 0, dismissible: true, active: true }]),
  });
  return POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  writtenData = null;
  process.env.ADMIN_PASSWORD = SECRET;
  getServerSession.mockResolvedValue(null);
  findUnique.mockResolvedValue(null);
});

describe('POST /api/announcements', () => {
  it('rejects with no credentials at all', async () => {
    const res = await postAnnouncements();
    expect(res.status).toBe(401);
    expect(writtenData).toBeNull();
  });

  it('allows the legacy x-admin-password header (unchanged, still works)', async () => {
    const res = await postAnnouncements({ 'x-admin-password': SECRET });
    expect(res.status).toBe(200);
    expect(writtenData).not.toBeNull();
  });

  it('rejects a wrong legacy header with no session', async () => {
    const res = await postAnnouncements({ 'x-admin-password': 'wrong' });
    expect(res.status).toBe(401);
  });

  it('THE FIX: allows an admin session with NO legacy header at all', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'admin-1' } });
    findUnique.mockResolvedValue({ id: 'admin-1', email: 'don@example.com', role: 'admin' });
    const res = await postAnnouncements();
    expect(res.status).toBe(200);
    expect(writtenData).not.toBeNull();
  });

  it('rejects a signed-in non-admin session with no legacy header', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com', role: 'user' });
    const res = await postAnnouncements();
    expect(res.status).toBe(401);
    expect(writtenData).toBeNull();
  });
});

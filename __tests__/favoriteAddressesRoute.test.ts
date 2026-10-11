/**
 * Trip Planner Phase 2 — route-level coverage for
 * app/api/favorite-addresses/route.ts, per an independent review's request
 * to verify the actual authenticated API flow (auth gating, status codes,
 * request parsing), not just the lib/favoriteAddresses.ts unit tests.
 * lib/favoriteAddresses.ts itself is mocked here — its own behavior is
 * covered by __tests__/favoriteAddresses.test.ts; this file is only about
 * whether the route wires it up correctly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getServerSession = vi.fn(async () => null as unknown);
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const listFavoriteAddresses   = vi.fn(async () => [] as unknown[]);
const createFavoriteAddress   = vi.fn();
const updateFavoriteAddress   = vi.fn();
const deleteFavoriteAddress   = vi.fn();
vi.mock('@/lib/favoriteAddresses', () => ({
  listFavoriteAddresses: (...a: unknown[]) => listFavoriteAddresses(...(a as [])),
  createFavoriteAddress: (...a: unknown[]) => createFavoriteAddress(...(a as [])),
  updateFavoriteAddress: (...a: unknown[]) => updateFavoriteAddress(...(a as [])),
  deleteFavoriteAddress: (...a: unknown[]) => deleteFavoriteAddress(...(a as [])),
}));

function makeRequest(method: string, url: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('GET /api/favorite-addresses', () => {
  it('1. 401s with no session', async () => {
    getServerSession.mockResolvedValue(null);
    const { GET } = await import('@/app/api/favorite-addresses/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listFavoriteAddresses).not.toHaveBeenCalled();
  });

  it('2. returns the signed-in user\'s favorites, scoped by their id', async () => {
    listFavoriteAddresses.mockResolvedValue([{ id: 'fav-1', label: 'Home' }]);
    const { GET } = await import('@/app/api/favorite-addresses/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(listFavoriteAddresses).toHaveBeenCalledWith('user-1');
    const body = await res.json() as { favorites: unknown[] };
    expect(body.favorites).toEqual([{ id: 'fav-1', label: 'Home' }]);
  });
});

describe('POST /api/favorite-addresses', () => {
  it('3. 401s with no session', async () => {
    getServerSession.mockResolvedValue(null);
    const { POST } = await import('@/app/api/favorite-addresses/route');
    const res = await POST(makeRequest('POST', 'https://www.gascap.app/api/favorite-addresses', { label: 'Home', displayAddress: '123 Main St', source: 'manual_text' }));
    expect(res.status).toBe(401);
    expect(createFavoriteAddress).not.toHaveBeenCalled();
  });

  it('4. 400s on a missing label', async () => {
    const { POST } = await import('@/app/api/favorite-addresses/route');
    const res = await POST(makeRequest('POST', 'https://www.gascap.app/api/favorite-addresses', { displayAddress: '123 Main St', source: 'manual_text' }));
    expect(res.status).toBe(400);
    expect(createFavoriteAddress).not.toHaveBeenCalled();
  });

  it('5. 400s on an invalid source enum value', async () => {
    const { POST } = await import('@/app/api/favorite-addresses/route');
    const res = await POST(makeRequest('POST', 'https://www.gascap.app/api/favorite-addresses', { label: 'Home', displayAddress: '123 Main St', source: 'telepathy' }));
    expect(res.status).toBe(400);
  });

  it('6. a successful create calls the lib function with the signed-in userId (never a client-supplied one)', async () => {
    createFavoriteAddress.mockResolvedValue({ ok: true, favorite: { id: 'fav-1', label: 'Home' } });
    const { POST } = await import('@/app/api/favorite-addresses/route');
    const res = await POST(makeRequest('POST', 'https://www.gascap.app/api/favorite-addresses', {
      label: 'Home', displayAddress: '123 Main St', source: 'manual_text', userId: 'someone-else',
    }));
    expect(res.status).toBe(200);
    expect(createFavoriteAddress).toHaveBeenCalledWith(
      'user-1', // the session's id, not the spoofed body.userId
      expect.objectContaining({ label: 'Home' }),
      false,
    );
  });

  it('7. a duplicate-label result surfaces as 409 with the existing favorite', async () => {
    createFavoriteAddress.mockResolvedValue({ ok: false, reason: 'duplicate_label', existing: { id: 'fav-1', label: 'Home' } });
    const { POST } = await import('@/app/api/favorite-addresses/route');
    const res = await POST(makeRequest('POST', 'https://www.gascap.app/api/favorite-addresses', { label: 'Home', displayAddress: '999 Other St', source: 'manual_text' }));
    expect(res.status).toBe(409);
    const body = await res.json() as { existing: { id: string } };
    expect(body.existing.id).toBe('fav-1');
  });

  it('8. confirmDuplicate:true is forwarded through to the lib call', async () => {
    createFavoriteAddress.mockResolvedValue({ ok: true, favorite: { id: 'fav-2' } });
    const { POST } = await import('@/app/api/favorite-addresses/route');
    await POST(makeRequest('POST', 'https://www.gascap.app/api/favorite-addresses', {
      label: 'Home', displayAddress: '999 Other St', source: 'manual_text', confirmDuplicate: true,
    }));
    expect(createFavoriteAddress).toHaveBeenCalledWith('user-1', expect.anything(), true);
  });
});

describe('PATCH /api/favorite-addresses?id=', () => {
  it('9. 401s with no session', async () => {
    getServerSession.mockResolvedValue(null);
    const { PATCH } = await import('@/app/api/favorite-addresses/route');
    const res = await PATCH(makeRequest('PATCH', 'https://www.gascap.app/api/favorite-addresses?id=fav-1', { label: 'New' }));
    expect(res.status).toBe(401);
  });

  it('10. 400s with no id query param', async () => {
    const { PATCH } = await import('@/app/api/favorite-addresses/route');
    const res = await PATCH(makeRequest('PATCH', 'https://www.gascap.app/api/favorite-addresses', { label: 'New' }));
    expect(res.status).toBe(400);
    expect(updateFavoriteAddress).not.toHaveBeenCalled();
  });

  it('11. 404s when the lib layer reports not-found/not-owned', async () => {
    updateFavoriteAddress.mockResolvedValue(undefined);
    const { PATCH } = await import('@/app/api/favorite-addresses/route');
    const res = await PATCH(makeRequest('PATCH', 'https://www.gascap.app/api/favorite-addresses?id=fav-1', { label: 'New' }));
    expect(res.status).toBe(404);
  });

  it('12. a successful update passes the signed-in userId, the id, and the patch to the lib layer', async () => {
    updateFavoriteAddress.mockResolvedValue({ id: 'fav-1', label: 'New' });
    const { PATCH } = await import('@/app/api/favorite-addresses/route');
    const res = await PATCH(makeRequest('PATCH', 'https://www.gascap.app/api/favorite-addresses?id=fav-1', { label: 'New' }));
    expect(res.status).toBe(200);
    expect(updateFavoriteAddress).toHaveBeenCalledWith('user-1', 'fav-1', expect.objectContaining({ label: 'New' }));
  });
});

describe('DELETE /api/favorite-addresses?id=', () => {
  it('13. 401s with no session', async () => {
    getServerSession.mockResolvedValue(null);
    const { DELETE } = await import('@/app/api/favorite-addresses/route');
    const res = await DELETE(makeRequest('DELETE', 'https://www.gascap.app/api/favorite-addresses?id=fav-1'));
    expect(res.status).toBe(401);
  });

  it('14. 400s with no id query param', async () => {
    const { DELETE } = await import('@/app/api/favorite-addresses/route');
    const res = await DELETE(makeRequest('DELETE', 'https://www.gascap.app/api/favorite-addresses'));
    expect(res.status).toBe(400);
    expect(deleteFavoriteAddress).not.toHaveBeenCalled();
  });

  it('15. deletes scoped to the signed-in userId', async () => {
    deleteFavoriteAddress.mockResolvedValue(true);
    const { DELETE } = await import('@/app/api/favorite-addresses/route');
    const res = await DELETE(makeRequest('DELETE', 'https://www.gascap.app/api/favorite-addresses?id=fav-1'));
    expect(res.status).toBe(200);
    expect(deleteFavoriteAddress).toHaveBeenCalledWith('user-1', 'fav-1');
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

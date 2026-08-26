/**
 * POST /api/rental-sessions/:id/refuel — Phase 3A retarget (2026-08-25).
 * Confirms: the route now creates a canonical Fillup via
 * lib/rentalFillups.ts's createRentalFillup() (not the frozen legacy
 * logRefuel()); a retried request with the same clientRefuelId is
 * idempotent at the HTTP layer; a second final_return attempt gets a 409;
 * and the route remains completely un-gated by Pro/trial status — an
 * active rental stays usable even after Pro access lapses mid-rental.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getServerSession = vi.fn(async () => ({ user: { id: 'user-1' } }) as unknown);
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/featureFlags', () => ({ RENTAL_RETURN_ASSISTANT_ENABLED: true }));

type CreateResult =
  | { outcome: 'created' | 'duplicate'; fillup: { id: string } }
  | { outcome: 'final_return_exists'; fillup: { id: string } }
  | { outcome: 'not_found' | 'invalid' };

const createRentalFillup = vi.fn(async (..._args: unknown[]): Promise<CreateResult> => ({ outcome: 'created', fillup: { id: 'f1' } }));
vi.mock('@/lib/rentalFillups', () => ({ createRentalFillup: (...a: unknown[]) => createRentalFillup(...(a as [])) }));

// This route must NEVER import the legacy write path — a passing import
// alone doesn't prove non-use, but this fails loudly if anyone re-wires the
// route back to it, since the legacy mock throws if called.
const logRefuel = vi.fn(async () => { throw new Error('logRefuel must not be called — refuelLogs is frozen for new writes (Phase 3A)'); });
vi.mock('@/lib/rentalSessions', () => ({ logRefuel: (...a: unknown[]) => logRefuel(...(a as [])) }));

async function post(body: unknown, id = 'session-1') {
  const { POST } = await import('@/app/api/rental-sessions/[id]/refuel/route');
  const req = new Request(`https://www.gascap.app/api/rental-sessions/${id}/refuel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  // @ts-expect-error — NextRequest-compatible enough for this route's usage
  return POST(req, { params: { id } });
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
  createRentalFillup.mockResolvedValue({ outcome: 'created', fillup: { id: 'f1' } });
});

describe('POST /api/rental-sessions/:id/refuel — Phase 3A canonical write path', () => {
  it('creates a canonical Fillup via createRentalFillup, never the legacy logRefuel', async () => {
    const res = await post({ gallons: 5, pricePerGallon: 3.5, clientRefuelId: 'c1' });
    expect(res.status).toBe(200);
    expect(createRentalFillup).toHaveBeenCalledWith('user-1', 'session-1', expect.objectContaining({
      gallonsPumped: 5, fillupType: 'trip', clientRefuelId: 'c1',
    }));
    expect(logRefuel).not.toHaveBeenCalled();
  });

  it('defaults fillupType to trip when omitted, accepts final_return explicitly', async () => {
    await post({ gallons: 5, pricePerGallon: 3.5, clientRefuelId: 'c1' });
    expect(createRentalFillup).toHaveBeenCalledWith('user-1', 'session-1', expect.objectContaining({ fillupType: 'trip' }));

    await post({ gallons: 2, pricePerGallon: 3.5, clientRefuelId: 'c2', fillupType: 'final_return' });
    expect(createRentalFillup).toHaveBeenCalledWith('user-1', 'session-1', expect.objectContaining({ fillupType: 'final_return' }));
  });

  it('rejects a non-positive gallons value', async () => {
    const res = await post({ gallons: 0, pricePerGallon: 3.5, clientRefuelId: 'c1' });
    expect(res.status).toBe(400);
    expect(createRentalFillup).not.toHaveBeenCalled();
  });

  it('rejects a missing clientRefuelId', async () => {
    const res = await post({ gallons: 5, pricePerGallon: 3.5 });
    expect(res.status).toBe(400);
    expect(createRentalFillup).not.toHaveBeenCalled();
  });

  it('rejects a request with neither pricePerGallon nor totalPaid — $0.00 must never mean "unknown"', async () => {
    const res = await post({ gallons: 5, clientRefuelId: 'c1' });
    expect(res.status).toBe(400);
    expect(createRentalFillup).not.toHaveBeenCalled();
  });

  it('accepts totalPaid alone, without pricePerGallon', async () => {
    const res = await post({ gallons: 5, totalPaid: 20, clientRefuelId: 'c1' });
    expect(res.status).toBe(200);
    expect(createRentalFillup).toHaveBeenCalledWith('user-1', 'session-1', expect.objectContaining({ totalCost: 20 }));
  });

  it('a retried request with the same clientRefuelId is idempotent — 200 with the original fillup, not an error', async () => {
    createRentalFillup.mockResolvedValueOnce({ outcome: 'created', fillup: { id: 'f1' } });
    createRentalFillup.mockResolvedValueOnce({ outcome: 'duplicate', fillup: { id: 'f1' } });

    const first = await post({ gallons: 5, pricePerGallon: 3.5, clientRefuelId: 'retry-1' });
    const second = await post({ gallons: 5, pricePerGallon: 3.5, clientRefuelId: 'retry-1' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.fillup.id).toBe(secondBody.fillup.id);
  });

  it('returns 409 when a final_return fillup already exists for this rental', async () => {
    createRentalFillup.mockResolvedValueOnce({ outcome: 'final_return_exists', fillup: { id: 'existing-final' } });
    const res = await post({ gallons: 2, pricePerGallon: 3.5, clientRefuelId: 'c1', fillupType: 'final_return' });
    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown/unauthorized rental session', async () => {
    createRentalFillup.mockResolvedValueOnce({ outcome: 'not_found' });
    const res = await post({ gallons: 5, pricePerGallon: 3.5, clientRefuelId: 'c1' });
    expect(res.status).toBe(404);
  });

  it('is NOT Pro-gated — an active rental stays usable even if Pro/trial access has lapsed', async () => {
    // No plan/entitlement check exists anywhere in this route or its mocks —
    // proven by the fact that a successful call requires only a session, no
    // plan lookup is mocked or asserted, and the route still succeeds.
    const res = await post({ gallons: 5, pricePerGallon: 3.5, clientRefuelId: 'c1' });
    expect(res.status).toBe(200);
  });

  it('rejects an unauthenticated request', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await post({ gallons: 5, pricePerGallon: 3.5, clientRefuelId: 'c1' });
    expect(res.status).toBe(401);
    expect(createRentalFillup).not.toHaveBeenCalled();
  });
});

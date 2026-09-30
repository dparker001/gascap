/**
 * Find Gas Near Return stays usable for an ACTIVE rental after Pro lapses
 * (Don's decision, 2026-09-30).
 *
 * CLAUDE.md: "An active rental must remain fully usable if Pro lapses
 * mid-rental. Gate *starting* a rental, never finishing one." Station search
 * near the return location used the generic Pro-gated /gas/nearby, so a
 * lapsed trial lost nearby prices at the exact moment they matter.
 *
 * GET /gas/rental-nearby?rentalId=… :
 *   - owner-only (another user's rental → 404, no Google call)
 *   - active rental → allowed on ANY plan
 *   - completed/cancelled rental → Pro only (DB plan, not JWT)
 *   - always searches around the rental's SAVED return location; client
 *     coordinates are ignored, so this can't become free Find Gas anywhere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const getServerSession = vi.fn(async () => null as unknown);
const findById         = vi.fn(async () => undefined as unknown);
const getRentalSession = vi.fn(async () => undefined as unknown);

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/users', () => ({
  findById:    (...a: unknown[]) => findById(...(a as [])),
  findByEmail: async () => undefined,
}));
vi.mock('@/lib/rentalSessions', () => ({
  getRentalSession: (...a: unknown[]) => getRentalSession(...(a as [])),
}));

const RETURN = { lat: 28.4294, lng: -81.3089 }; // e.g. an airport return lot

function rental(overrides: Record<string, unknown> = {}) {
  return { id: 'r1', userId: 'u1', status: 'active', returnLatitude: RETURN.lat, returnLongitude: RETURN.lng, ...overrides };
}

function stubGoogle() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: vi.fn().mockResolvedValue({
      places: [{
        id: 'ChIJ_return_station', displayName: { text: 'Airport Shell' }, formattedAddress: '1 Airport Blvd',
        location: { latitude: RETURN.lat + 0.005, longitude: RETURN.lng },
        fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price: { currencyCode: 'USD', units: '3', nanos: 290_000_000 }, updateTime: '2026-09-30T12:00:00Z' }] },
      }],
    }),
    text: vi.fn().mockResolvedValue(''),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function req(query: string) {
  return new Request(`https://www.gascap.app/gas/rental-nearby?${query}`);
}

function signInAs(plan: string) {
  getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'u1@example.com' } });
  findById.mockResolvedValue({ id: 'u1', plan });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.GOOGLE_PLACES_API_KEY   = 'test-key';
  process.env.ENABLE_LIVE_FUEL_PRICES = 'true';
  getServerSession.mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.ENABLE_LIVE_FUEL_PRICES;
});

describe('GET /gas/rental-nearby', () => {
  it('REGRESSION: a FREE user (lapsed trial) with an ACTIVE rental gets stations near the return', async () => {
    signInAs('free');
    getRentalSession.mockResolvedValue(rental());
    const fetchMock = stubGoogle();

    const { GET } = await import('@/app/gas/rental-nearby/route');
    const res  = await GET(req('rentalId=r1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.proRequired).toBeUndefined();
    expect(body.stations).toHaveLength(1);
    expect(body.stations[0].name).toBe('Airport Shell');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('searches around the rental\'s SAVED return location — client coordinates are ignored', async () => {
    signInAs('free');
    getRentalSession.mockResolvedValue(rental());
    const fetchMock = stubGoogle();

    const { GET } = await import('@/app/gas/rental-nearby/route');
    await GET(req('rentalId=r1&lat=40.7128&lng=-74.0060')); // tries to search Manhattan

    const init = fetchMock.mock.calls[0][1] as { body: string };
    const center = JSON.parse(init.body).locationRestriction.circle.center;
    expect(center.latitude).toBeCloseTo(RETURN.lat, 4);
    expect(center.longitude).toBeCloseTo(RETURN.lng, 4);
  });

  it('owner-only: the ownership lookup is scoped to the signed-in user; a miss → 404, no Google call', async () => {
    signInAs('pro');
    getRentalSession.mockResolvedValue(undefined);
    const fetchMock = stubGoogle();

    const { GET } = await import('@/app/gas/rental-nearby/route');
    const res = await GET(req('rentalId=someone-elses'));

    expect(res.status).toBe(404);
    expect(getRentalSession).toHaveBeenCalledWith('u1', 'someone-elses');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a FREE user with a COMPLETED rental → proRequired, no Google call', async () => {
    signInAs('free');
    getRentalSession.mockResolvedValue(rental({ status: 'completed' }));
    const fetchMock = stubGoogle();

    const { GET } = await import('@/app/gas/rental-nearby/route');
    const body = await (await GET(req('rentalId=r1'))).json();

    expect(body.proRequired).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a PRO user (from the DB) with a completed rental still gets stations', async () => {
    signInAs('pro');
    getRentalSession.mockResolvedValue(rental({ status: 'completed' }));
    stubGoogle();
    const { GET } = await import('@/app/gas/rental-nearby/route');
    const body = await (await GET(req('rentalId=r1'))).json();
    expect(body.stations).toHaveLength(1);
  });

  it('unauthenticated → proRequired, no rental lookup, no Google call', async () => {
    const fetchMock = stubGoogle();
    const { GET } = await import('@/app/gas/rental-nearby/route');
    const body = await (await GET(req('rentalId=r1'))).json();
    expect(body.proRequired).toBe(true);
    expect(getRentalSession).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing rentalId → 400', async () => {
    signInAs('free');
    const { GET } = await import('@/app/gas/rental-nearby/route');
    expect((await GET(req(''))).status).toBe(400);
  });

  it('rental without a saved return location → 400, no Google call', async () => {
    signInAs('free');
    getRentalSession.mockResolvedValue(rental({ returnLatitude: null, returnLongitude: null }));
    const fetchMock = stubGoogle();
    const { GET } = await import('@/app/gas/rental-nearby/route');
    expect((await GET(req('rentalId=r1'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('live prices switched off → disabled (still no Google call)', async () => {
    signInAs('free');
    process.env.ENABLE_LIVE_FUEL_PRICES = 'false';
    getRentalSession.mockResolvedValue(rental());
    const fetchMock = stubGoogle();
    const { GET } = await import('@/app/gas/rental-nearby/route');
    const body = await (await GET(req('rentalId=r1'))).json();
    expect(body.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('FindGasNearReturn wiring', () => {
  const repoRoot = path.resolve(__dirname, '..');

  it('calls the rental-scoped route, not the generic Pro-gated /gas/nearby', () => {
    const src = readFileSync(path.join(repoRoot, 'components/rental-return/FindGasNearReturn.tsx'), 'utf8');
    expect(src).toMatch(/\/gas\/rental-nearby\?rentalId=/);
    expect(src).not.toMatch(/\/gas\/nearby\?/);
  });

  it('both RentalDashboard call sites pass the rental id', () => {
    const src = readFileSync(path.join(repoRoot, 'components/rental-return/RentalDashboard.tsx'), 'utf8');
    const uses = src.match(/<FindGasNearReturn[\s\S]*?\/>/g) ?? [];
    expect(uses.length).toBe(2);
    for (const u of uses) expect(u).toMatch(/rentalSessionId=\{session\.id\}/);
  });
});

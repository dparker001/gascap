/**
 * Saved-station live prices (2026-09-30) — regression coverage.
 *
 * Bug: a favorited station froze the fuel prices from the moment it was
 * saved (FavoriteStation.prices snapshot) and labelled them with the SAVE
 * time, not the time Google observed the price. Weeks later the Find Gas tab
 * still showed that snapshot — sometimes directly above a fresh search card
 * for the same station with a different price.
 *
 * Fix: a favorite stores station identity; GET /api/favorites resolves the
 * current price live from Google Places (Place Details) on every view, labels
 * it with Google's own updateTime, and flags a fallback snapshot as
 * 'last_known' instead of presenting it as current.
 *
 * Google mocks follow the documented Places API (New) Place Details contract:
 * GET https://places.googleapis.com/v1/places/{id}, field mask WITHOUT the
 * `places.` prefix, response is the Place object at the top level (not
 * wrapped in `places[]` like searchNearby), fuelOptions.fuelPrices[] entries
 * carry { type, price: { currencyCode, units (int64 string), nanos }, updateTime }.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// ── Shared mocks ─────────────────────────────────────────────────────────────

const getServerSession = vi.fn(async () => null as unknown);
const findById         = vi.fn(async () => undefined as unknown);
const findMany         = vi.fn(async () => [] as unknown[]);
const update           = vi.fn(async () => ({}) as unknown);
const findUnique       = vi.fn(async () => null as unknown);
const count            = vi.fn(async () => 0);
const upsert           = vi.fn(async (args: { create: unknown }) => args.create as unknown);

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/users', () => ({
  findById:    (...a: unknown[]) => findById(...(a as [])),
  findByEmail: async () => undefined,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    favoriteStation: {
      findMany:   (...a: unknown[]) => findMany(...(a as [])),
      update:     (...a: unknown[]) => update(...(a as [])),
      findUnique: (...a: unknown[]) => findUnique(...(a as [])),
      count:      (...a: unknown[]) => count(...(a as [])),
      upsert:     (...a: unknown[]) => upsert(...(a as [never])),
    },
  },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PLACE_ID      = 'ChIJ_saved_station_1';
const THREE_WEEKS   = new Date(Date.now() - 21 * 86_400_000).toISOString();
const GOOGLE_OLD_TS = new Date(Date.now() - 23 * 86_400_000).toISOString(); // Google's time for the snapshot
const GOOGLE_NEW_TS = new Date(Date.now() - 60 * 60_000).toISOString();     // 1h ago

function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id:             'fav-1',
    userId:         'u1',
    placeId:        PLACE_ID,
    name:           'Saved Shell',
    address:        '1 Main St, Orlando, FL',
    lat:            28.5,
    lng:            -81.3,
    prices:         [{ type: 'REGULAR', label: 'Regular', price: 2.99, updatedAt: GOOGLE_OLD_TS }],
    priceUpdatedAt: THREE_WEEKS, // legacy rows: the SAVE time
    createdAt:      THREE_WEEKS,
    ...overrides,
  };
}

/** A Place Details response exactly as Google documents it (top-level Place). */
function placeDetails(id: string, units: string, nanos: number, updateTime = GOOGLE_NEW_TS) {
  return {
    id,
    fuelOptions: {
      fuelPrices: [
        { type: 'REGULAR_UNLEADED', price: { currencyCode: 'USD', units, nanos }, updateTime },
        { type: 'PREMIUM',          price: { currencyCode: 'USD', units: '4', nanos: 190_000_000 }, updateTime },
      ],
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok:     status >= 200 && status < 300,
    status,
    json:   vi.fn().mockResolvedValue(body),
    text:   vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function signInAs(plan: string) {
  getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'u1@example.com' } });
  findById.mockResolvedValue({ id: 'u1', plan });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.GOOGLE_PLACES_API_KEY  = 'test-key';
  process.env.ENABLE_LIVE_FUEL_PRICES = 'true';
  getServerSession.mockResolvedValue(null);
  findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.ENABLE_LIVE_FUEL_PRICES;
});

// ── lib/nearbyGas — per-station Place Details lookup ─────────────────────────

describe('fetchStationPrices — Google Place Details contract', () => {
  it('calls Place Details per id with an unprefixed id,fuelOptions field mask and parses the real shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(placeDetails('ChIJ_contract_1', '3', 490_000_000)));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchStationPrices } = await import('@/lib/nearbyGas');
    const result = await fetchStationPrices(['ChIJ_contract_1']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method?: string; headers: Record<string, string> }];
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJ_contract_1');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers['X-Goog-FieldMask']).toBe('id,fuelOptions');
    expect(init.headers['X-Goog-Api-Key']).toBe('test-key');

    const prices = result.get('ChIJ_contract_1');
    expect(prices).not.toBeNull();
    expect(prices!.map((p) => p.type)).toEqual(['REGULAR', 'PREMIUM']);
    expect(prices![0].price).toBeCloseTo(3.49, 3);
    expect(prices![0].updatedAt).toBe(GOOGLE_NEW_TS);
  });

  it('caches a successful lookup (second call does not hit Google)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(placeDetails('ChIJ_cache_1', '3', 0)));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchStationPrices } = await import('@/lib/nearbyGas');
    await fetchStationPrices(['ChIJ_cache_1']);
    await fetchStationPrices(['ChIJ_cache_1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a station Google reports with fuelOptions but no prices resolves to [] (known: no price)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ id: 'ChIJ_empty', fuelOptions: { fuelPrices: [] } })));
    const { fetchStationPrices } = await import('@/lib/nearbyGas');
    expect((await fetchStationPrices(['ChIJ_empty'])).get('ChIJ_empty')).toEqual([]);
  });

  it('403 / network failure resolves to null (unknown), never [] and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 403 } }, 403))
      .mockRejectedValueOnce(new Error('timeout')));
    const { fetchStationPrices } = await import('@/lib/nearbyGas');
    const result = await fetchStationPrices(['ChIJ_403', 'ChIJ_timeout']);
    expect(result.get('ChIJ_403')).toBeNull();
    expect(result.get('ChIJ_timeout')).toBeNull();
  });

  it('does not call Google at all without an API key', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { fetchStationPrices } = await import('@/lib/nearbyGas');
    const result = await fetchStationPrices(['ChIJ_nokey']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.get('ChIJ_nokey')).toBeNull();
  });
});

// ── GET /api/favorites — the user-visible regression ─────────────────────────

describe('GET /api/favorites — saved stations show current prices', () => {
  it('REGRESSION: returns the live Google price, not the weeks-old saved snapshot', async () => {
    signInAs('pro');
    findMany.mockResolvedValue([snapshotRow()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(placeDetails(PLACE_ID, '3', 490_000_000))));

    const { GET } = await import('@/app/api/favorites/route');
    const body = await (await GET()).json();
    const fav = body.favorites[0];

    expect(fav.priceStatus).toBe('live');
    expect(fav.prices.find((p: { type: string }) => p.type === 'REGULAR').price).toBeCloseTo(3.49, 3);
    // Labelled with Google's observation time — not the save time, not "now".
    expect(fav.priceUpdatedAt).toBe(GOOGLE_NEW_TS);
  });

  it('writes the fresh prices back so the fallback snapshot never goes weeks stale again', async () => {
    signInAs('pro');
    findMany.mockResolvedValue([snapshotRow()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(placeDetails(PLACE_ID, '3', 490_000_000))));
    const { GET } = await import('@/app/api/favorites/route');
    await GET();
    expect(update).toHaveBeenCalledTimes(1);
    const arg = (update.mock.calls[0] as unknown as [{ where: { id: string }; data: { priceUpdatedAt: string } }])[0];
    expect(arg.where.id).toBe('fav-1');
    expect(arg.data.priceUpdatedAt).toBe(GOOGLE_NEW_TS);
  });

  it('REGRESSION: when Google cannot be reached the snapshot is flagged last_known with its TRUE age', async () => {
    signInAs('pro');
    findMany.mockResolvedValue([snapshotRow()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: {} }, 503)));

    const { GET } = await import('@/app/api/favorites/route');
    const fav = (await (await GET()).json()).favorites[0];

    expect(fav.priceStatus).toBe('last_known');
    expect(fav.prices[0].price).toBe(2.99);
    // Google's observation time from the snapshot — older than the save time.
    expect(fav.priceUpdatedAt).toBe(GOOGLE_OLD_TS);
    expect(update).not.toHaveBeenCalled();
  });

  it('Google now reports no price for the station → snapshot flagged last_known, not shown as current', async () => {
    signInAs('pro');
    findMany.mockResolvedValue([snapshotRow()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ id: PLACE_ID, fuelOptions: { fuelPrices: [] } })));
    const { GET } = await import('@/app/api/favorites/route');
    const fav = (await (await GET()).json()).favorites[0];
    expect(fav.priceStatus).toBe('last_known');
  });

  it('no live price and no snapshot → unavailable with empty prices (never an invented price)', async () => {
    signInAs('pro');
    findMany.mockResolvedValue([snapshotRow({ prices: [], priceUpdatedAt: null })]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: {} }, 500)));
    const { GET } = await import('@/app/api/favorites/route');
    const fav = (await (await GET()).json()).favorites[0];
    expect(fav.priceStatus).toBe('unavailable');
    expect(fav.prices).toEqual([]);
    expect(fav.priceUpdatedAt).toBeNull();
  });

  it('free plan (resolved from the DB, not the JWT) → no paid Google call', async () => {
    signInAs('free');
    findMany.mockResolvedValue([snapshotRow()]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await import('@/app/api/favorites/route');
    const fav = (await (await GET()).json()).favorites[0];
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fav.priceStatus).toBe('last_known');
  });

  it('live prices disabled by ENABLE_LIVE_FUEL_PRICES → no Google call', async () => {
    signInAs('pro');
    process.env.ENABLE_LIVE_FUEL_PRICES = 'false';
    findMany.mockResolvedValue([snapshotRow()]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await import('@/app/api/favorites/route');
    await GET();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401', async () => {
    const { GET } = await import('@/app/api/favorites/route');
    expect((await GET()).status).toBe(401);
  });
});

// ── POST /api/favorites — timestamp honesty at save time ─────────────────────

describe('POST /api/favorites', () => {
  it('REGRESSION: stores Google\'s price observation time, not the moment the star was tapped', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const { POST } = await import('@/app/api/favorites/route');
    const req = new Request('https://www.gascap.app/api/favorites', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        placeId: PLACE_ID, name: 'Saved Shell', address: '1 Main St', lat: 28.5, lng: -81.3,
        prices:  [{ type: 'REGULAR', label: 'Regular', price: 3.19, updatedAt: GOOGLE_OLD_TS }],
      }),
    });
    await POST(req as never);
    const arg = (upsert.mock.calls[0] as unknown as [{ create: { priceUpdatedAt: string | null } }])[0];
    expect(arg.create.priceUpdatedAt).toBe(GOOGLE_OLD_TS);
  });
});

// ── Service worker — favorites must never be served from the SW cache ────────

describe('next.config.js runtimeCaching', () => {
  it('/api/favorites is NetworkOnly and excluded from the default "apis" cache', () => {
    const src = readFileSync(path.resolve(__dirname, '..', 'next.config.js'), 'utf8');
    const networkOnlyBlock = src.slice(src.indexOf('const runtimeCaching'), src.indexOf("handler: 'NetworkOnly'"));
    expect(networkOnlyBlock).toMatch(/url\.pathname\.startsWith\('\/api\/favorites'\)/);
    expect(src).toMatch(/if \(pathname\?\.startsWith\('\/api\/favorites'\)\) return false;/);
  });
});

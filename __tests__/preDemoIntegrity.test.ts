/**
 * Pre-demo integrity fixes (2026-09-30) — regression coverage.
 *
 * A2  Find Gas search cache returned the FIRST requester's distances.
 *     The cache key rounded to 0.1° (~11 km) and a hit returned the stored
 *     stations unchanged, so a second search elsewhere in the same cell got
 *     distances measured from someone else's position.
 * A3  AI APP FEATURES contradicted itself on whether starting a rental
 *     needs Pro (the API requires it — app/api/rental-sessions/route.ts).
 * A4  AI Pro gate trusted a client-sent `isSuggested: true`, so any caller
 *     could get unlimited open-ended answers without Pro. Suggested chips are
 *     now recognised by their exact text, EN and ES, from lib/translations.
 * A5  Rental "Find Gas Near Return" rendered Pro-required / live-prices-off /
 *     HTTP-error responses as "No priced stations found".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');

// ── A2 — nearby search cache distances ───────────────────────────────────────

function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, dL = ((lat2 - lat1) * Math.PI) / 180, dG = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dL / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dG / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 0.621371;
}

function stubPlaces(stationLat: number, stationLng: number) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: vi.fn().mockResolvedValue({
      places: [{
        id: 'ChIJ_cache_station', displayName: { text: 'Cache Shell' }, formattedAddress: '1 Test Rd',
        location: { latitude: stationLat, longitude: stationLng },
        fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price: { currencyCode: 'USD', units: '3', nanos: 0 }, updateTime: '2026-09-30T12:00:00Z' }] },
      }],
    }),
    text: vi.fn().mockResolvedValue(''),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('A2 — Find Gas distances are measured from the CURRENT request', () => {
  beforeEach(() => { vi.resetModules(); process.env.GOOGLE_PLACES_API_KEY = 'test-key'; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.GOOGLE_PLACES_API_KEY; });

  it('REGRESSION: a second search ~3 km away does not reuse the first search\'s distances', async () => {
    const station = { lat: 40.0100, lng: -90.0000 };
    stubPlaces(station.lat, station.lng);
    const { fetchNearbyStations } = await import('@/lib/nearbyGas');

    await fetchNearbyStations(40.0100, -90.0000);                // standing at the station
    const second = await fetchNearbyStations(40.0400, -90.0000); // ~2 mi north — both round to the old 40.0 cell

    const expected = haversineMi(40.0400, -90.0000, station.lat, station.lng);
    expect(second[0].distanceMi).toBeCloseTo(expected, 1);
    expect(second[0].distanceMi).toBeGreaterThan(1.5);
  });

  it('REGRESSION: a cache hit recomputes distance from the new position', async () => {
    const station = { lat: 41.0000, lng: -91.0100 };
    const fetchMock = stubPlaces(station.lat, station.lng);
    const { fetchNearbyStations } = await import('@/lib/nearbyGas');

    const a = await fetchNearbyStations(41.0010, -91.0010);
    const b = await fetchNearbyStations(41.0040, -91.0040); // same cache cell, different spot

    expect(fetchMock).toHaveBeenCalledTimes(1); // served from cache…
    expect(a[0].distanceMi).toBeCloseTo(haversineMi(41.0010, -91.0010, station.lat, station.lng), 1);
    expect(b[0].distanceMi).toBeCloseTo(haversineMi(41.0040, -91.0040, station.lat, station.lng), 1); // …but measured from b
  });
});

describe('A2 (review round 1) — cache hits are filtered to the CURRENT search radius', () => {
  beforeEach(() => { vi.resetModules(); process.env.GOOGLE_PLACES_API_KEY = 'test-key'; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.GOOGLE_PLACES_API_KEY; });

  it('REGRESSION: a cached station outside the second searcher\'s 5-mile radius is removed', async () => {
    // Station ~4.9 mi south of the first searcher; the second searcher is in the
    // same 0.01° cell but ~0.34 mi further north, so the station is ~5.24 mi away.
    const station = { lat: 41.0 - 4.9 / 69.05, lng: -91.0 };
    const fetchMock = stubPlaces(station.lat, station.lng);
    const { fetchNearbyStations } = await import('@/lib/nearbyGas');

    const first  = await fetchNearbyStations(41.0000, -91.0000);
    const second = await fetchNearbyStations(41.0049, -91.0000);

    expect(fetchMock).toHaveBeenCalledTimes(1); // cache hit
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});

// ── A3 — AI prompt rental gating consistency ─────────────────────────────────

describe('A3 — AI APP FEATURES states the rental Pro gate consistently', () => {
  it('no longer claims users don\'t need Pro to create a rental session', () => {
    const src = readFileSync(path.join(repoRoot, 'app/api/ai/chat/route.ts'), 'utf8');
    expect(src).not.toMatch(/don't need Pro to create a rental/i);
    expect(src).toMatch(/Starting a NEW rental requires Pro/);
  });
});

// ── A4 — AI Pro gate ─────────────────────────────────────────────────────────

const getServerSession = vi.fn(async () => null as unknown);
const findById         = vi.fn(async () => undefined as unknown);
const createMessage    = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/users', () => ({
  findById:    (...a: unknown[]) => findById(...(a as [])),
  findByEmail: async () => undefined,
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: (...a: unknown[]) => createMessage(...(a as [])) }; },
}));
vi.mock('@/lib/fillups', () => ({
  getFillups: async () => [], computeMpg: () => [], getFillupStats: () => ({ count: 0, totalSpent: 0, totalGallons: 0, avgPricePerGallon: 0 }),
}));
vi.mock('@/lib/budgetGoals',   () => ({ getBudgetGoal: async () => null }));
vi.mock('@/lib/savedVehicles', () => ({ getVehiclesForUser: async () => [] }));
vi.mock('@/lib/mpgResolver',   () => ({ resolveVehicleMpg: () => null }));

function chat(body: Record<string, unknown>) {
  return new Request('https://www.gascap.app/api/ai/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('A4 — AI open-ended questions are Pro-gated on the server', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.GASCAP_ANTHROPIC_KEY = 'test-anthropic-key';
    getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'u1@example.com' } });
    findById.mockResolvedValue({ id: 'u1', plan: 'free' });
  });
  afterEach(() => { delete process.env.GASCAP_ANTHROPIC_KEY; });

  it('REGRESSION: a free user cannot bypass the gate by sending isSuggested:true with a custom question', async () => {
    const { POST } = await import('@/app/api/ai/chat/route');
    const res = await POST(chat({ question: 'Write me a 2,000-word essay about anything', isSuggested: true }));
    expect(res.status).toBe(403);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('a free user can still ask an English suggested chip', async () => {
    const { POST } = await import('@/app/api/ai/chat/route');
    const res = await POST(chat({ question: 'Why might my MPG be dropping?', isSuggested: true }));
    expect(res.status).toBe(200);
  });

  it('a free user can still ask a SPANISH suggested chip (these were only admitted by the client flag before)', async () => {
    const { translations } = await import('@/lib/translations');
    const { POST } = await import('@/app/api/ai/chat/route');
    for (const chip of translations.es.ai.chips) {
      const res = await POST(chat({ question: chip, isSuggested: true }));
      expect(res.status, chip).toBe(200);
    }
  });

  it('REGRESSION: a chip whose accents arrive decomposed (NFD) is still recognised (NFC normalisation)', async () => {
    const { translations } = await import('@/lib/translations');
    const { POST } = await import('@/app/api/ai/chat/route');
    const accented = translations.es.ai.chips.find((c: string) => c !== c.normalize('NFD'))!;
    expect(accented).toBeTruthy();
    const res = await POST(chat({ question: accented.normalize('NFD') }));
    expect(res.status).toBe(200);
  });

  it('a Pro user can ask a custom question', async () => {
    findById.mockResolvedValue({ id: 'u1', plan: 'pro' });
    const { POST } = await import('@/app/api/ai/chat/route');
    const res = await POST(chat({ question: 'Is premium worth it for my car?' }));
    expect(res.status).toBe(200);
  });
});

// ── A5 — rental Find Gas Near Return response handling ───────────────────────

describe('A5 — Find Gas Near Return distinguishes "none found" from "couldn\'t search"', () => {
  it('classifies each /gas/nearby response shape', async () => {
    const { classifyNearbyResponse } = await import('@/lib/nearbyResponse');
    expect(classifyNearbyResponse(true,  { stations: [] })).toBe('ok');
    expect(classifyNearbyResponse(true,  { stations: [], proRequired: true, reason: 'free_plan' })).toBe('pro_required');
    expect(classifyNearbyResponse(true,  { stations: [], disabled: true })).toBe('disabled');
    expect(classifyNearbyResponse(true,  { stations: [], error: 'Places API key not configured' })).toBe('error');
    expect(classifyNearbyResponse(false, { stations: [], error: 'lookup failed' })).toBe('error');
    expect(classifyNearbyResponse(true,  null)).toBe('error');
  });

  it('FindGasNearReturn uses the classifier and has distinct Pro / unavailable states', () => {
    const src = readFileSync(path.join(repoRoot, 'components/rental-return/FindGasNearReturn.tsx'), 'utf8');
    expect(src).toMatch(/classifyNearbyResponse/);
    expect(src).toMatch(/findGasProRequired/);
    expect(src).toMatch(/findGasUnavailable/);
  });

  it('EN and ES copy exist for the new states', async () => {
    const { translations } = await import('@/lib/translations');
    for (const lang of ['en', 'es'] as const) {
      const rr = translations[lang].rentalReturn as Record<string, unknown>;
      expect(typeof rr.findGasProRequired, lang).toBe('string');
      expect(typeof rr.findGasUnavailable, lang).toBe('string');
    }
  });
});

/**
 * Unit tests for lib/nearbyGas.ts
 *
 * Uses vitest + global fetch mock. Each test stubs fetch to return a
 * controlled Google Places response and asserts on the normalised output.
 *
 * Each test uses a distinct lat offset to avoid hitting the module-level
 * in-memory cache (cache key is rounded to 1 decimal place, ~11 km grid).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchNearbyStations } from '../lib/nearbyGas';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMoney(units: number | string, nanos: number) {
  return { units, nanos, currencyCode: 'USD' };
}

function makeFuelPrice(
  type: string,
  units: number | string,
  nanos: number,
  updateTime = '2026-06-25T12:00:00Z',
) {
  return { type, price: makeMoney(units, nanos), updateTime };
}

function makePlaceWith(overrides: object = {}) {
  return {
    id: 'ChIJtest123',
    displayName: { text: 'Test Shell', languageCode: 'en' },
    formattedAddress: '123 Main St, Springfield, IL',
    location: { latitude: 37.7749, longitude: -122.4194 },
    regularOpeningHours: { openNow: true },
    ...overrides,
  };
}

function mockFetch(body: object, status = 200) {
  const mockRes = {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockRes));
}

// Base coord — each test adds a whole-degree lat offset so cache keys never collide.
const BASE_LAT = 10.0;
const BASE_LNG = -100.0;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fetchNearbyStations', () => {
  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_PLACES_API_KEY;
  });

  it('station with regular fuel price — parses price and metadata correctly', async () => {
    mockFetch({
      places: [
        makePlaceWith({
          fuelOptions: {
            fuelPrices: [makeFuelPrice('REGULAR_UNLEADED', '3', 890_000_000)],
          },
        }),
      ],
    });

    const stations = await fetchNearbyStations(BASE_LAT + 1, BASE_LNG);

    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Test Shell');
    expect(stations[0].prices).toHaveLength(1);
    const p = stations[0].prices[0];
    expect(p.type).toBe('REGULAR');
    expect(p.label).toBe('Regular');
    expect(p.price).toBeCloseTo(3.89, 2);
    expect(p.updatedAt).toBe('2026-06-25T12:00:00Z');
  });

  it('station with multiple fuel grades — sorted Regular → Midgrade → Premium → Diesel', async () => {
    mockFetch({
      places: [
        makePlaceWith({
          fuelOptions: {
            fuelPrices: [
              makeFuelPrice('PREMIUM',           '4', 290_000_000),
              makeFuelPrice('REGULAR_UNLEADED',  '3', 590_000_000),
              makeFuelPrice('DIESEL',            '3', 990_000_000),
              makeFuelPrice('MIDGRADE',          '3', 790_000_000),
            ],
          },
        }),
      ],
    });

    const stations = await fetchNearbyStations(BASE_LAT + 2, BASE_LNG);

    expect(stations[0].prices.map((p) => p.type)).toEqual([
      'REGULAR', 'MIDGRADE', 'PREMIUM', 'DIESEL',
    ]);
    expect(stations[0].prices.find((p) => p.type === 'REGULAR')?.price).toBeCloseTo(3.59, 2);
    expect(stations[0].prices.find((p) => p.type === 'PREMIUM')?.price).toBeCloseTo(4.29, 2);
  });

  it('station with no fuelOptions field — still returned with empty prices array', async () => {
    mockFetch({
      places: [makePlaceWith()], // no fuelOptions key at all
    });

    const stations = await fetchNearbyStations(BASE_LAT + 3, BASE_LNG);

    expect(stations).toHaveLength(1);
    expect(stations[0].prices).toHaveLength(0);
  });

  it('station with fuelOptions but empty fuelPrices — still returned with empty prices array', async () => {
    mockFetch({
      places: [
        makePlaceWith({
          fuelOptions: { fuelPrices: [] },
        }),
      ],
    });

    const stations = await fetchNearbyStations(BASE_LAT + 4, BASE_LNG);

    expect(stations).toHaveLength(1);
    expect(stations[0].prices).toHaveLength(0);
  });

  it('Google API 403 error — returns empty array without throwing', async () => {
    mockFetch({ error: { message: 'API key invalid' } }, 403);

    const stations = await fetchNearbyStations(BASE_LAT + 5, BASE_LNG);

    expect(stations).toEqual([]);
  });

  it('units serialised as string (int64 JSON) — parsed correctly', async () => {
    // Google serialises int64 units as a string in JSON responses
    mockFetch({
      places: [
        makePlaceWith({
          fuelOptions: {
            fuelPrices: [makeFuelPrice('REGULAR_UNLEADED', '3', 990_000_000)],
          },
        }),
      ],
    });

    const stations = await fetchNearbyStations(BASE_LAT + 6, BASE_LNG);

    expect(stations[0].prices[0].price).toBeCloseTo(3.99, 2);
  });

  it('no API key configured — returns empty array', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    vi.stubGlobal('fetch', vi.fn()); // should never be called

    const stations = await fetchNearbyStations(BASE_LAT + 7, BASE_LNG);

    expect(stations).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

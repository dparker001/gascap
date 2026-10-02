/**
 * T3 — /api/maps/place-location includeTimeZone opt-in (2026-10-02).
 * timeZone is a Place Details PRO-SKU field: only Rental Mode opts in, the
 * opted-in path requires a signed-in session, and ordinary callers keep the
 * Essentials-tier location-only request.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const getServerSession = vi.fn(async () => null as unknown);
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const fetchMock = vi.fn();
let googleBody: Record<string, unknown> = {};
beforeEach(() => {
  vi.resetModules();
  getServerSession.mockResolvedValue(null);
  process.env.GOOGLE_MAPS_API_KEY = 'k';
  process.env.GOOGLE_MAPS_TRIP_PLANNER_ENABLED = 'true';
  googleBody = { location: { latitude: 33.94, longitude: -118.40 }, timeZone: { id: 'America/Los_Angeles', version: '2025a' } };
  fetchMock.mockReset().mockImplementation(async () => ({ ok: true, json: async () => googleBody }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

async function post(body: object) {
  const { POST } = await import('@/app/api/maps/place-location/route');
  const res = await POST(new Request('https://www.gascap.app/api/maps/place-location', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}
const mask = () => (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers['X-Goog-FieldMask'];

describe('place-location includeTimeZone', () => {
  it('default (no flag): location-only mask, no auth required, no timeZone returned even if Google sends one', async () => {
    const r = await post({ placeId: 'p1' });
    expect(r.status).toBe(200);
    expect(mask()).toBe('location');
    expect(r.json).toEqual({ ok: true, lat: 33.94, lng: -118.40 });
  });

  it('opted in WITHOUT a session → 401 and Google is never called', async () => {
    const r = await post({ placeId: 'p1', includeTimeZone: true });
    expect(r.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opted in WITH a session → location,timeZone mask and a validated IANA id', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } });
    const r = await post({ placeId: 'p1', includeTimeZone: true });
    expect(mask()).toBe('location,timeZone');
    expect(r.json).toEqual({ ok: true, lat: 33.94, lng: -118.40, timeZone: 'America/Los_Angeles' });
  });

  it('a Google-modern IANA name is accepted (Asia/Kolkata)', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } });
    googleBody = { ...googleBody, timeZone: { id: 'Asia/Kolkata' } };
    expect((await post({ placeId: 'p1', includeTimeZone: true })).json.timeZone).toBe('Asia/Kolkata');
  });

  it('an invalid/abbreviated zone from the provider is dropped, never passed through', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } });
    googleBody = { ...googleBody, timeZone: { id: 'PST' } };
    const r = await post({ placeId: 'p1', includeTimeZone: true });
    expect(r.json).toEqual({ ok: true, lat: 33.94, lng: -118.40 });
  });

  it('only the literal boolean true opts in', async () => {
    await post({ placeId: 'p1', includeTimeZone: 'true' });
    expect(mask()).toBe('location');
  });
});

describe('callers', () => {
  const src = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  it('TripCostEstimator never requests the Pro timeZone field', () => {
    expect(src('components/TripCostEstimator.tsx')).not.toMatch(/includeTimeZone/);
  });
  it('RentalLocationInput opts in (Rental Mode only)', () => {
    expect(src('components/rental-return/RentalLocationInput.tsx')).toMatch(/includeTimeZone:\s*true/);
  });
});

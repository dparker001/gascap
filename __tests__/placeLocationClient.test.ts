/**
 * Routing-integrity fix (2026-10-12) — unit tests for the extracted
 * fetchPlaceCoordinates() client wrapper around POST /api/maps/place-location.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchPlaceCoordinates } from '@/lib/placeLocationClient';

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('fetchPlaceCoordinates', () => {
  it('returns coordinates on a successful response', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, lat: 28.5, lng: -81.3 }) });
    const result = await fetchPlaceCoordinates('place123', 'tok');
    expect(result).toEqual({ latitude: 28.5, longitude: -81.3 });
  });

  it('sends the placeId and sessionToken in the request body', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, lat: 1, lng: 1 }) });
    await fetchPlaceCoordinates('place123', 'tok-abc');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/maps/place-location');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ placeId: 'place123', sessionToken: 'tok-abc' });
  });

  it('returns null on a non-ok HTTP response', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await fetchPlaceCoordinates('place123')).toBeNull();
  });

  it('returns null when ok:false in the response body', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: false }) });
    expect(await fetchPlaceCoordinates('place123')).toBeNull();
  });

  it('returns null when lat or lng is missing', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, lat: 1 }) });
    expect(await fetchPlaceCoordinates('place123')).toBeNull();
  });

  it('returns null on a network error (fetch throws) rather than propagating', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(fetchPlaceCoordinates('place123')).resolves.toBeNull();
  });

  it('returns null if response.json() itself throws', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json'); } });
    await expect(fetchPlaceCoordinates('place123')).resolves.toBeNull();
  });

  it('works without a sessionToken', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, lat: 2, lng: 2 }) });
    const result = await fetchPlaceCoordinates('place123');
    expect(result).toEqual({ latitude: 2, longitude: 2 });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ placeId: 'place123' });
  });
});

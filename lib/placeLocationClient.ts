'use client';

/**
 * GasCap™ — client-side wrapper for POST /api/maps/place-location.
 *
 * Extracted from components/TripCostEstimator.tsx, which previously inlined
 * this exact fetch twice (once for origin, once for destination). Returns
 * null on any failure (network error, non-ok response, missing fields) —
 * callers must treat null as "could not resolve," never invent coordinates.
 */
export async function fetchPlaceCoordinates(
  placeId: string,
  sessionToken?: string,
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const res = await fetch('/api/maps/place-location', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ placeId, sessionToken }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; lat?: number; lng?: number };
    if (!data.ok || data.lat == null || data.lng == null) return null;
    return { latitude: data.lat, longitude: data.lng };
  } catch {
    return null;
  }
}

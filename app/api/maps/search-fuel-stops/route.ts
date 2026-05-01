/**
 * POST /api/maps/search-fuel-stops
 *
 * Searches for gas stations near a given coordinate using
 * Google Places API (New) — searchText with locationBias.
 * SERVER-SIDE ONLY — the API key is never sent to the client.
 *
 * Requires on Railway:
 *   GOOGLE_MAPS_API_KEY=your_key
 *   GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true
 *
 * Request body:
 *   { nearLat: number, nearLng: number, preferredFuelType?: string }
 *
 * Response: FuelStopsApiResponse
 */

import { NextResponse }                    from 'next/server';
import { getMapsProvider, isRoutePlannerEnabled } from '@/lib/mapsProvider';
import type { FuelStopsApiRequest, FuelStopsApiResponse } from '@/lib/mapsProvider/types';

export async function POST(req: Request): Promise<Response> {
  if (!isRoutePlannerEnabled()) {
    return NextResponse.json(
      {
        ok:              false,
        featureDisabled: true,
        error:
          'Fuel stop search is not yet configured. ' +
          'Set GOOGLE_MAPS_API_KEY and GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true to activate.',
      } satisfies FuelStopsApiResponse,
      { status: 503 },
    );
  }

  let body: FuelStopsApiRequest;
  try {
    body = (await req.json()) as FuelStopsApiRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' } satisfies FuelStopsApiResponse,
      { status: 400 },
    );
  }

  const { nearLat, nearLng, preferredFuelType } = body;

  if (nearLat == null || nearLng == null || isNaN(Number(nearLat)) || isNaN(Number(nearLng))) {
    return NextResponse.json(
      { ok: false, error: 'nearLat and nearLng are required' } satisfies FuelStopsApiResponse,
      { status: 400 },
    );
  }

  const provider = getMapsProvider();

  try {
    const stops = await provider.searchFuelStops({
      searchQuery:      'gas station',
      maxResultCount:   5,
      preferredFuelType,
      searchOrigin:     { latitude: Number(nearLat), longitude: Number(nearLng) },
    });

    return NextResponse.json({ ok: true, stops } satisfies FuelStopsApiResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/maps/search-fuel-stops]', message);

    if (message.includes('not yet configured')) {
      return NextResponse.json(
        { ok: false, featureDisabled: true, error: message } satisfies FuelStopsApiResponse,
        { status: 503 },
      );
    }

    return NextResponse.json(
      { ok: false, error: 'Fuel stop search failed. Please try again.' } satisfies FuelStopsApiResponse,
      { status: 500 },
    );
  }
}

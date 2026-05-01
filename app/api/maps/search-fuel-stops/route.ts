/**
 * POST /api/maps/search-fuel-stops
 *
 * Searches for gas stations along a route polyline using
 * Google Places API (New) — Search Along Route.
 * SERVER-SIDE ONLY — the API key is never sent to the client.
 *
 * ⚠️  Returns 503 (feature disabled) until these env vars are set on Railway:
 *     GOOGLE_MAPS_API_KEY=your_key
 *     GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true
 *
 * Access: Pro + Fleet users (also gated client-side via canAccessFeature())
 *
 * Request body:  { routePolyline: string, refuelAtMile?: number, preferredFuelType?: string }
 * Response:      FuelStopsApiResponse
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
          'Fuel stop search along route is not yet configured. ' +
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

  const { routePolyline, preferredFuelType } = body;

  if (!routePolyline || typeof routePolyline !== 'string' || !routePolyline.trim()) {
    return NextResponse.json(
      { ok: false, error: 'routePolyline is required' } satisfies FuelStopsApiResponse,
      { status: 400 },
    );
  }

  const provider = getMapsProvider();

  try {
    const stops = await provider.searchFuelStops({
      routePolyline:    routePolyline.trim(),
      searchQuery:      'gas station',
      maxResultCount:   10,
      preferredFuelType,
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

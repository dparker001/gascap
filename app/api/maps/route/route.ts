/**
 * POST /api/maps/route
 *
 * Calculates a driving route between two points using Google Routes API.
 * SERVER-SIDE ONLY — the API key is never sent to the client.
 *
 * ⚠️  Returns 503 (feature disabled) until these env vars are set on Railway:
 *     GOOGLE_MAPS_API_KEY=your_key
 *     GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true
 *
 * Access: Pro + Fleet users (also gated client-side via canAccessFeature())
 *
 * Request body:  { origin: string, destination: string, avoidTolls?: boolean }
 * Response:      RouteApiResponse
 */

import { NextResponse }                    from 'next/server';
import { getMapsProvider, isRoutePlannerEnabled } from '@/lib/mapsProvider';
import type { RouteApiRequest, RouteApiResponse }  from '@/lib/mapsProvider/types';

export async function POST(req: Request): Promise<Response> {
  // Feature gate — requires API key + explicit opt-in
  if (!isRoutePlannerEnabled()) {
    return NextResponse.json(
      {
        ok:              false,
        featureDisabled: true,
        error:
          'Route-based trip planning is not yet configured. ' +
          'Set GOOGLE_MAPS_API_KEY and GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true to activate.',
      } satisfies RouteApiResponse,
      { status: 503 },
    );
  }

  let body: RouteApiRequest;
  try {
    body = (await req.json()) as RouteApiRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' } satisfies RouteApiResponse,
      { status: 400 },
    );
  }

  const { origin, destination, avoidTolls } = body;

  if (!origin || typeof origin !== 'string' || !origin.trim()) {
    return NextResponse.json(
      { ok: false, error: 'origin is required' } satisfies RouteApiResponse,
      { status: 400 },
    );
  }
  if (!destination || typeof destination !== 'string' || !destination.trim()) {
    return NextResponse.json(
      { ok: false, error: 'destination is required' } satisfies RouteApiResponse,
      { status: 400 },
    );
  }

  const provider = getMapsProvider();

  try {
    const route = await provider.getRoute({
      origin:      origin.trim(),
      destination: destination.trim(),
      travelMode:  'DRIVE',
      avoidTolls:  avoidTolls ?? false,
    });

    return NextResponse.json({ ok: true, route } satisfies RouteApiResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/maps/route]', message);

    if (message.includes('not yet configured')) {
      return NextResponse.json(
        { ok: false, featureDisabled: true, error: message } satisfies RouteApiResponse,
        { status: 503 },
      );
    }

    return NextResponse.json(
      { ok: false, error: 'Route calculation failed. Please try again.' } satisfies RouteApiResponse,
      { status: 500 },
    );
  }
}

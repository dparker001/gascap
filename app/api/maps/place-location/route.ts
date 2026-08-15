/**
 * /api/maps/place-location
 * POST { placeId: string } → { ok: boolean; lat?: number; lng?: number }
 *
 * Resolves a Google Places placeId (from /api/maps/autocomplete) to actual
 * coordinates. Needed anywhere a selected address must be geocoded, not
 * just displayed as text — e.g. the Rental Return Assistant's return
 * location, which "Find Gas Near Return" needs real lat/lng for.
 *
 * Only active when GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true, same gate as
 * autocomplete.
 */
import { NextResponse } from 'next/server';

interface GooglePlaceDetails {
  location?: { latitude?: number; longitude?: number };
}

export async function POST(req: Request) {
  const apiKey  = process.env.GOOGLE_MAPS_API_KEY;
  const enabled = process.env.GOOGLE_MAPS_TRIP_PLANNER_ENABLED === 'true';

  if (!apiKey || !enabled) {
    return NextResponse.json({ ok: false });
  }

  let placeId: string;
  try {
    const body = await req.json() as { placeId?: string };
    placeId = (body.placeId ?? '').trim();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!placeId) return NextResponse.json({ ok: false }, { status: 400 });

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key':   apiKey,
        'X-Goog-FieldMask': 'location',
      },
    });
    if (!res.ok) return NextResponse.json({ ok: false });

    const data = await res.json() as GooglePlaceDetails;
    const lat = data.location?.latitude;
    const lng = data.location?.longitude;
    if (lat == null || lng == null) return NextResponse.json({ ok: false });

    return NextResponse.json({ ok: true, lat, lng });
  } catch {
    return NextResponse.json({ ok: false });
  }
}

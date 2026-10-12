/**
 * /api/maps/place-location
 * POST { placeId: string, includeTimeZone?: boolean }
 *   → { ok: boolean; lat?: number; lng?: number; timeZone?: string }
 *
 * Resolves a Google Places placeId (from /api/maps/autocomplete) to actual
 * coordinates. Needed anywhere a selected address must be geocoded, not
 * just displayed as text — e.g. the Rental Return Assistant's return
 * location, which "Find Gas Near Return" needs real lat/lng for.
 *
 * includeTimeZone (2026-10-02, Rental Mode event-timezone model): opt-in
 * only. Adds `timeZone` to the Place Details field mask and returns the
 * place's IANA zone id (validated). `timeZone` is a Place Details PRO-SKU
 * field (`location` alone is Essentials), so:
 *   - ordinary callers (TripCostEstimator) never send the flag and keep the
 *     location-only, Essentials-tier request unchanged;
 *   - the opted-in path requires a signed-in GasCap session (401 otherwise).
 *
 * sessionToken (2026-10-11, Trip Planner Phase 2): optional. Should be the
 * same token sent to /api/maps/autocomplete for the search that produced
 * this placeId — closes the Autocomplete (New) session for Google billing
 * purposes instead of being charged per-request. See
 * lib/placesSessionToken.ts for the client-side token lifecycle.
 *
 * Only active when GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true, same gate as
 * autocomplete. Never caches the returned coordinates — every caller
 * (including a Favorite Address's resolve-on-use lookup) re-resolves on
 * every use, per Google's Places API caching limits on returned lat/lng.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isValidIanaZone } from '@/lib/rentalTimezone';

interface GooglePlaceDetails {
  location?: { latitude?: number; longitude?: number };
  timeZone?: { id?: string; version?: string };
}

export async function POST(req: Request) {
  const apiKey  = process.env.GOOGLE_MAPS_API_KEY;
  const enabled = process.env.GOOGLE_MAPS_TRIP_PLANNER_ENABLED === 'true';

  if (!apiKey || !enabled) {
    return NextResponse.json({ ok: false });
  }

  let placeId: string;
  let includeTimeZone = false;
  let sessionToken: string | undefined;
  try {
    const body = await req.json() as { placeId?: string; includeTimeZone?: unknown; sessionToken?: unknown };
    placeId = (body.placeId ?? '').trim();
    includeTimeZone = body.includeTimeZone === true;
    sessionToken = typeof body.sessionToken === 'string' && body.sessionToken ? body.sessionToken : undefined;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!placeId) return NextResponse.json({ ok: false }, { status: 400 });

  if (includeTimeZone) {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ ok: false, error: 'Sign in required.' }, { status: 401 });
  }

  try {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
    if (sessionToken) url.searchParams.set('sessionToken', sessionToken);

    const res = await fetch(url, {
      headers: {
        'X-Goog-Api-Key':   apiKey,
        'X-Goog-FieldMask': includeTimeZone ? 'location,timeZone' : 'location',
      },
    });
    if (!res.ok) return NextResponse.json({ ok: false });

    const data = await res.json() as GooglePlaceDetails;
    const lat = data.location?.latitude;
    const lng = data.location?.longitude;
    if (lat == null || lng == null) return NextResponse.json({ ok: false });

    const tz = includeTimeZone && isValidIanaZone(data.timeZone?.id) ? data.timeZone!.id : undefined;
    return NextResponse.json({ ok: true, lat, lng, ...(tz ? { timeZone: tz } : {}) });
  } catch {
    return NextResponse.json({ ok: false });
  }
}

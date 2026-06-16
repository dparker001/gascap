/**
 * GET /api/fillups/nearby-stations?lat=&lng=
 *
 * Returns gas stations near the supplied coordinates, nearest-first, so the
 * fill-up logger can auto-fill the station you're actually standing at.
 *
 * Privacy: the client only ever sends ~110 m-rounded coordinates (3 decimals),
 * and we persist NONE of them — only the station NAME the user picks ends up on
 * the fill-up record. Precise GPS is never stored.
 *
 * Degrades gracefully: if the maps provider isn't configured, returns
 * { available: false, stations: [] } (HTTP 200) so the UI just falls back to
 * manual entry + recent-station chips.
 */
import { NextResponse }      from 'next/server';
import { getServerSession }  from 'next-auth';
import { authOptions }       from '@/lib/auth';
import { getMapsProvider, isRoutePlannerEnabled } from '@/lib/mapsProvider';

export const dynamic = 'force-dynamic';

/** Haversine distance in meters between two points. */
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Provider not configured → graceful "not available" (UI falls back to manual)
  if (!isRoutePlannerEnabled()) {
    return NextResponse.json({ available: false, stations: [] });
  }

  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lng = parseFloat(searchParams.get('lng') ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });
  }

  try {
    const stops = await getMapsProvider().searchFuelStops({
      searchQuery:    'gas station',
      searchOrigin:   { latitude: lat, longitude: lng },
      maxResultCount: 6,
    });

    const stations = stops
      .map((s) => ({
        name:     s.name,
        address:  s.address,
        distance: distanceMeters(lat, lng, s.latitude, s.longitude),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5)
      .map(({ name, address }) => ({ name, address }));

    return NextResponse.json({ available: true, stations });
  } catch {
    // API hiccup — don't surface an error, just let the UI fall back.
    return NextResponse.json({ available: false, stations: [] });
  }
}

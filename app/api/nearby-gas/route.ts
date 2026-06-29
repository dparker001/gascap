/**
 * GET /api/nearby-gas?lat=xx&lng=yy
 *
 * Returns nearby gas stations with fuel prices from Google Places API.
 * Server-side proxy so the API key never reaches the client.
 * Responses are cached 30 min in lib/nearbyGas (in-memory).
 *
 * Pro-gated: guests and free-plan users get an empty array with a `proRequired`
 * flag so the client can show an upgrade prompt.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { fetchNearbyStations } from '@/lib/nearbyGas';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lng = parseFloat(searchParams.get('lng') ?? '');

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });
  }

  // Pro gate — only signed-in Pro/Fleet/Lifetime users
  const session = await getServerSession(authOptions);
  const plan = (session?.user as { plan?: string } | undefined)?.plan ?? 'free';
  const isPro = plan === 'pro' || plan === 'fleet' || plan === 'lifetime';

  if (!session) {
    return NextResponse.json({ stations: [], proRequired: true, reason: 'unauthenticated' });
  }
  if (!isPro) {
    return NextResponse.json({ stations: [], proRequired: true, reason: 'free_plan' });
  }

  if (process.env.ENABLE_LIVE_FUEL_PRICES !== 'true') {
    return NextResponse.json({ stations: [], disabled: true });
  }

  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return NextResponse.json({ stations: [], error: 'Places API key not configured' });
  }

  try {
    const stations = await fetchNearbyStations(lat, lng);
    return NextResponse.json({ stations });
  } catch (err) {
    console.error('[nearby-gas] error', err);
    return NextResponse.json({ stations: [], error: 'lookup failed' }, { status: 500 });
  }
}

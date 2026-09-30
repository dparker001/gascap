/**
 * GET /gas/rental-nearby?rentalId=…
 *
 * "Find Gas Near Return" for one rental — stations with live prices around
 * that rental's SAVED return location.
 *
 * Access (2026-09-30, Don's decision): an ACTIVE rental keeps station search
 * on ANY plan. CLAUDE.md: "An active rental must remain fully usable if Pro
 * lapses mid-rental. Gate *starting* a rental, never finishing one." The
 * generic /gas/nearby is Pro-gated, so a trial that lapsed mid-rental lost
 * nearby prices at the exact moment the renter needs them. A completed or
 * cancelled rental falls back to the normal Pro gate (plan from the DB).
 *
 * The search always centres on the rental's stored return coordinates —
 * client-supplied lat/lng are ignored — so this can't be used as free,
 * anywhere-in-the-world Find Gas. Owner-only: another user's rental is a 404.
 *
 * Lives under /gas/ so the service worker's NetworkOnly rule covers it (see
 * next.config.js) — a cached station list must never be served.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RENTAL_RETURN_ASSISTANT_ENABLED } from '@/lib/featureFlags';
import { getRentalSession } from '@/lib/rentalSessions';
import { getLivePlan } from '@/lib/serverPlan';
import { fetchNearbyStations } from '@/lib/nearbyGas';

export async function GET(req: Request) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  const rentalId = new URL(req.url).searchParams.get('rentalId');
  if (!rentalId) {
    return NextResponse.json({ stations: [], error: 'rentalId required' }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const userId  = (session?.user as { id?: string } | undefined)?.id;
  if (!session || !userId) {
    return NextResponse.json({ stations: [], proRequired: true, reason: 'unauthenticated' });
  }

  const rental = await getRentalSession(userId, rentalId);
  if (!rental) {
    return NextResponse.json({ stations: [], error: 'Rental not found' }, { status: 404 });
  }

  if (rental.status !== 'active') {
    const { isPro } = await getLivePlan();
    if (!isPro) {
      return NextResponse.json({ stations: [], proRequired: true, reason: 'free_plan' });
    }
  }

  if (rental.returnLatitude == null || rental.returnLongitude == null) {
    return NextResponse.json({ stations: [], error: 'no_return_location' }, { status: 400 });
  }

  if (process.env.ENABLE_LIVE_FUEL_PRICES !== 'true') {
    return NextResponse.json({ stations: [], disabled: true });
  }
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return NextResponse.json({ stations: [], error: 'Places API key not configured' });
  }

  try {
    const stations = await fetchNearbyStations(rental.returnLatitude, rental.returnLongitude);
    return NextResponse.json({ stations }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[rental-nearby] error', err);
    return NextResponse.json({ stations: [], error: 'lookup failed' }, { status: 500 });
  }
}

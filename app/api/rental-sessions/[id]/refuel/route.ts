/**
 * POST /api/rental-sessions/:id/refuel — "I Just Refueled" log entry.
 *
 * Phase 3A (2026-08-25): retargeted to create a canonical Fillup row via
 * lib/rentalFillups.ts's createRentalFillup() instead of appending to the
 * legacy RentalSession.refuelLogs JSON array (now frozen — see logRefuel()'s
 * doc comment in lib/rentalSessions.ts). Still rolls the purchase into
 * currentFuelGallons (source becomes RECEIPT).
 *
 * Deliberately NOT Pro-gated, same as before this change: an active rental
 * must remain usable even if Pro/trial access lapses mid-rental (see
 * app/api/rental-sessions/route.ts's POST handler for the one place that
 * check belongs).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RENTAL_RETURN_ASSISTANT_ENABLED } from '@/lib/featureFlags';
import { createRentalFillup } from '@/lib/rentalFillups';

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return (session.user as { id?: string })?.id ?? null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.gallons !== 'number' || body.gallons <= 0) {
    return NextResponse.json({ error: 'A positive gallons value is required.' }, { status: 400 });
  }
  if (typeof body.clientRefuelId !== 'string' || body.clientRefuelId.length === 0) {
    return NextResponse.json({ error: 'A clientRefuelId is required.' }, { status: 400 });
  }
  // $0.00 means free fuel, never "unknown" — a rental fill must supply at
  // least a price/gallon or an actual amount paid; see
  // lib/rentalFillups.ts's createRentalFillup() for why this can never
  // silently default to 0.
  if (typeof body.pricePerGallon !== 'number' && typeof body.totalPaid !== 'number') {
    return NextResponse.json({ error: 'Enter a price per gallon or the amount you paid.' }, { status: 400 });
  }
  const fillupType = body.fillupType === 'final_return' ? 'final_return' : 'trip';

  const result = await createRentalFillup(userId, params.id, {
    gallonsPumped:     body.gallons,
    pricePerGallon:    body.pricePerGallon,
    totalCost:         body.totalPaid,
    stationName:       body.stationName,
    stationLat:        body.stationLat,
    stationLng:        body.stationLng,
    receiptThumb:      body.receiptPhotoThumb,
    odometerReading:   body.odometer,
    fillupType,
    clientRefuelId:    body.clientRefuelId,
  });

  switch (result.outcome) {
    case 'not_found': return NextResponse.json({ error: 'Not found' }, { status: 404 });
    case 'invalid':   return NextResponse.json({ error: 'Invalid refuel data.' }, { status: 400 });
    case 'final_return_exists':
      return NextResponse.json(
        { error: 'This rental already has a final return fill-up logged.', fillup: result.fillup },
        { status: 409 },
      );
    case 'created':
    case 'duplicate':
      return NextResponse.json({ fillup: result.fillup });
  }
}

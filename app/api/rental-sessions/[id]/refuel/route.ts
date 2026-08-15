/**
 * POST /api/rental-sessions/:id/refuel — "I Just Refueled" log entry.
 * Appends to refuelLogs and rolls the purchase into currentFuelGallons
 * (source becomes RECEIPT — a logged purchase is more trustworthy than a
 * gauge guess, though still not as authoritative as a Level 2 API/telematics
 * reading).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RENTAL_RETURN_ASSISTANT_ENABLED } from '@/lib/featureFlags';
import { logRefuel } from '@/lib/rentalSessions';

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

  const updated = await logRefuel(userId, params.id, {
    gallons:            body.gallons,
    pricePerGallon:     body.pricePerGallon,
    totalPaid:          body.totalPaid,
    stationName:        body.stationName,
    stationLat:         body.stationLat,
    stationLng:         body.stationLng,
    receiptPhotoThumb:  body.receiptPhotoThumb,
    odometer:           body.odometer,
  });
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ session: updated });
}

/**
 * PATCH  /api/rental-sessions/:id/fillups/:fillupId — edit a rental-linked
 *        Fillup (gallons, price, actual amount paid, station, odometer,
 *        receipt, trip/final-return classification).
 * DELETE /api/rental-sessions/:id/fillups/:fillupId — remove one.
 *
 * Phase 3A (2026-08-25). Both routes enforce rental ownership (the fillup
 * must belong to the given session AND the session to the caller) via
 * lib/rentalFillups.ts, which also implements the currentFuelGallons
 * invariant — edit and delete NEVER adjust currentFuelGallons/source/
 * timestamp, not even for the single most-recent fillup, since a historical
 * transaction record can never be used to reconstruct current tank state
 * (see lib/rentalFillups.ts's header comment) — and the
 * one-final_return-per-rental rule. Deliberately NOT Pro-gated — same "an
 * active rental stays usable" rule as every other rental mutation route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RENTAL_RETURN_ASSISTANT_ENABLED } from '@/lib/featureFlags';
import { updateRentalFillup, deleteRentalFillup } from '@/lib/rentalFillups';

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return (session.user as { id?: string })?.id ?? null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; fillupId: string } }) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  if (body.fillupType !== undefined && body.fillupType !== 'trip' && body.fillupType !== 'final_return') {
    return NextResponse.json({ error: 'fillupType must be trip or final_return.' }, { status: 400 });
  }
  if (body.gallonsPumped !== undefined && !(body.gallonsPumped > 0)) {
    return NextResponse.json({ error: 'gallonsPumped must be positive.' }, { status: 400 });
  }

  const result = await updateRentalFillup(userId, params.id, params.fillupId, {
    gallonsPumped:   body.gallonsPumped,
    pricePerGallon:  body.pricePerGallon,
    totalCost:       body.totalCost,
    stationName:     body.stationName,
    stationLat:      body.stationLat,
    stationLng:      body.stationLng,
    odometerReading: body.odometerReading,
    receiptThumb:    body.receiptThumb,
    fillupType:      body.fillupType,
  });

  switch (result.outcome) {
    case 'not_found': return NextResponse.json({ error: 'Not found' }, { status: 404 });
    case 'final_return_exists':
      return NextResponse.json(
        { error: 'This rental already has a final return fill-up logged.', fillup: result.fillup },
        { status: 409 },
      );
    case 'updated':
      return NextResponse.json({ fillup: result.fillup });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; fillupId: string } }) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await deleteRentalFillup(userId, params.id, params.fillupId);
  if (result.outcome === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

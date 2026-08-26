/**
 * GET    /api/rental-sessions/:id — fetch one rental session (owner only)
 * PATCH  /api/rental-sessions/:id — update fuel level, return details, notes
 * DELETE /api/rental-sessions/:id — remove a session (e.g. an abandoned draft)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RENTAL_RETURN_ASSISTANT_ENABLED } from '@/lib/featureFlags';
import { getRentalSession, updateRentalSession, deleteRentalSession, type UpdateRentalSessionInput } from '@/lib/rentalSessions';
import { validateRentalPhotos, photoCapKb, PHOTO_MAX_DATA_URL_BYTES } from '@/lib/photoLimits';
import { getRentalFillups } from '@/lib/rentalFillups';
import { isGaugeStyle } from '@/lib/gaugeStyles';
import { prisma } from '@/lib/prisma';

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return (session.user as { id?: string })?.id ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await getRentalSession(userId, params.id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Phase 3A — canonical Fillup rows for this rental, alongside the legacy
  // session.refuelLogs already on `session`. Empty for a pre-cutover session
  // that only has legacy entries; the client falls back to refuelLogs then.
  const fillups = await getRentalFillups(userId, params.id);
  // Phase 4 — resolve the linked Vehicle's gauge style (if any) server-side
  // so the client can apply lib/gaugeStyles.ts's resolveRentalGaugeStyle()
  // precedence without a second round-trip. Null when no vehicle is linked.
  const linkedVehicleGaugeStyle = session.vehicleId
    ? (await prisma.vehicle.findUnique({ where: { id: session.vehicleId }, select: { fuelGaugeStyle: true } }))?.fuelGaugeStyle ?? null
    : null;
  return NextResponse.json({ session, fillups, linkedVehicleGaugeStyle });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as UpdateRentalSessionInput | null;
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  if (body.fuelGaugeStyle !== undefined && !isGaugeStyle(body.fuelGaugeStyle)) {
    return NextResponse.json({ error: 'Invalid gauge style.' }, { status: 400 });
  }

  const photoCheck = validateRentalPhotos(body as Record<string, unknown>);
  if (!photoCheck.ok) {
    return NextResponse.json(
      {
        error: `That photo is too large to store (limit ${photoCapKb()}KB per photo).`,
        field: photoCheck.field,
        bytes: photoCheck.bytes,
        limitBytes: PHOTO_MAX_DATA_URL_BYTES,
      },
      { status: 413 },
    );
  }

  const updated = await updateRentalSession(userId, params.id, body);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ session: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ok = await deleteRentalSession(userId, params.id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

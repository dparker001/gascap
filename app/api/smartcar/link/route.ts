/**
 * POST /api/smartcar/link
 * Links a Smartcar vehicle ID to a GasCap vehicle record.
 * Body: { garageVehicleId: string, smartcarVehicleId: string }
 *
 * DELETE /api/smartcar/link?vehicleId=xxx
 * Removes the Smartcar link from a GasCap vehicle.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import type { Session }     from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { prisma }           from '@/lib/prisma';

function userId(session: Session | null) {
  return session?.user?.id ?? session?.user?.email ?? '';
}

// POST — create link
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid  = userId(session);
  const body = await req.json() as { garageVehicleId?: string; smartcarVehicleId?: string };

  if (!body.garageVehicleId || !body.smartcarVehicleId) {
    return NextResponse.json({ error: 'Missing garageVehicleId or smartcarVehicleId.' }, { status: 400 });
  }

  // Ensure the vehicle belongs to the user
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: body.garageVehicleId, userId: uid },
  });
  if (!vehicle) return NextResponse.json({ error: 'Vehicle not found.' }, { status: 404 });

  // Enforce 1 Smartcar link per account (MVP limit to manage COGS)
  const existingLinks = await prisma.vehicle.count({
    where: { userId: uid, smartcarVehicleId: { not: null } },
  });
  if (existingLinks >= 1 && vehicle.smartcarVehicleId !== body.smartcarVehicleId) {
    return NextResponse.json(
      { error: 'You already have a connected vehicle. Unlink it first to connect a different one.' },
      { status: 409 }
    );
  }

  const updated = await prisma.vehicle.update({
    where: { id: body.garageVehicleId },
    data:  { smartcarVehicleId: body.smartcarVehicleId },
  });

  return NextResponse.json({ ok: true, vehicleId: updated.id, smartcarVehicleId: updated.smartcarVehicleId });
}

// DELETE — remove link
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid = userId(session);
  const { searchParams } = new URL(req.url);
  const vehicleId = searchParams.get('vehicleId');
  if (!vehicleId) return NextResponse.json({ error: 'Missing vehicleId.' }, { status: 400 });

  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId: uid } });
  if (!vehicle) return NextResponse.json({ error: 'Vehicle not found.' }, { status: 404 });

  await prisma.vehicle.update({
    where: { id: vehicleId },
    data:  { smartcarVehicleId: null },
  });

  return NextResponse.json({ ok: true });
}

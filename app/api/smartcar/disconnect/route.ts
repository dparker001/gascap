import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// POST /api/smartcar/disconnect?vehicleId=...
// Removes Smartcar tokens from a vehicle. If no vehicles remain connected,
// clears the user's smartcarConnected flag.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId    = (session.user as { id?: string }).id ?? '';
  const vehicleId = req.nextUrl.searchParams.get('vehicleId');
  if (!vehicleId) return NextResponse.json({ error: 'vehicleId required' }, { status: 400 });

  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
  if (!vehicle) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Strip Smartcar data but keep the vehicle record
  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: {
      smartcarId:           null,
      smartcarAccessToken:  null,
      smartcarRefreshToken: null,
      smartcarTokenExpiry:  null,
      fuelLevel:            null,
      fuelLevelAt:          null,
      fuelRange:            null,
    },
  });

  // Check if any vehicles still connected
  const remaining = await prisma.vehicle.count({
    where: { userId, smartcarId: { not: null } },
  });

  if (remaining === 0) {
    await prisma.user.update({
      where: { id: userId },
      data: { smartcarConnected: false, smartcarVehicleCount: 0 },
    });
  } else {
    await prisma.user.update({
      where: { id: userId },
      data: { smartcarVehicleCount: remaining },
    });
  }

  return NextResponse.json({ ok: true, remainingConnected: remaining });
}

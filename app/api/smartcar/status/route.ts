import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/smartcar/status
// Returns the user's GasCap Connect status + connected vehicle data.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? '';
  const user   = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const vehicles = await prisma.vehicle.findMany({
    where:  { userId, smartcarId: { not: null } },
    select: {
      id:         true,
      name:       true,
      make:       true,
      model:      true,
      year:       true,
      fuelLevel:  true,
      fuelRange:  true,
      fuelLevelAt: true,
      smartcarId: true,
    },
  });

  // Check if trial has expired and update status
  if (
    user.smartcarAddonStatus === 'trial' &&
    user.smartcarTrialEndsAt &&
    new Date(user.smartcarTrialEndsAt) < new Date()
  ) {
    await prisma.user.update({
      where: { id: userId },
      data:  { smartcarAddonStatus: 'expired' },
    });
    return NextResponse.json({
      connected:    false,
      addonStatus:  'expired',
      trialEndsAt:  user.smartcarTrialEndsAt,
      vehicleCount: 0,
      vehicles:     [],
    });
  }

  return NextResponse.json({
    connected:    user.smartcarConnected,
    addonStatus:  user.smartcarAddonStatus,
    trialEndsAt:  user.smartcarTrialEndsAt,
    vehicleCount: user.smartcarVehicleCount,
    vehicles,
  });
}

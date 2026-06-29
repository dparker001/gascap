import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAppToken, getFuelLevel, getOdometer } from '@/lib/smartcar';

// POST /api/smartcar/sync
// Refreshes fuel level + odometer for all of the user's Smartcar-connected vehicles.
// V3: uses app-level client_credentials token + sc-user-id header per user.
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? '';
  const user   = await prisma.user.findUnique({ where: { id: userId } });

  if (!user?.smartcarConnected || !user.smartcarUserId) {
    return NextResponse.json({ error: 'No connected vehicles' }, { status: 400 });
  }
  if (user.smartcarAddonStatus === 'expired') {
    return NextResponse.json({ error: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED' }, { status: 402 });
  }

  const vehicles = await prisma.vehicle.findMany({
    where: { userId, smartcarId: { not: null } },
  });

  // V3: single app-level token for all vehicle calls
  const appToken       = await getAppToken();
  const smartcarUserId = user.smartcarUserId;

  const results = await Promise.allSettled(
    vehicles.map(async (v) => {
      const [fuel, odometer] = await Promise.allSettled([
        getFuelLevel(v.smartcarId!, appToken, smartcarUserId),
        getOdometer(v.smartcarId!, appToken, smartcarUserId),
      ]);

      const fuelData = fuel.status === 'fulfilled'     ? fuel.value     : null;
      const odomData = odometer.status === 'fulfilled' ? odometer.value : null;

      await prisma.vehicle.update({
        where: { id: v.id },
        data: {
          fuelLevel:       fuelData?.percentRemaining ?? v.fuelLevel,
          fuelRange:       fuelData?.range            ?? v.fuelRange,
          fuelLevelAt:     fuelData ? new Date().toISOString() : v.fuelLevelAt,
          currentOdometer: odomData?.distance ?? v.currentOdometer,
        },
      });

      return {
        vehicleId: v.id,
        name:      v.name,
        fuelLevel: fuelData?.percentRemaining ?? null,
        fuelRange: fuelData?.range            ?? null,
        odometer:  odomData?.distance         ?? null,
      };
    })
  );

  const synced = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => (r as PromiseFulfilledResult<unknown>).value);

  return NextResponse.json({ synced, count: synced.length });
}

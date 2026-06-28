import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getFuelLevel, getOdometer, refreshToken, tokenExpiry } from '@/lib/smartcar';

// POST /api/smartcar/sync
// Refreshes fuel level + odometer for all of the user's Smartcar-connected vehicles.
// Called on-demand from the Garage or Settings UI.
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? '';

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.smartcarConnected) {
    return NextResponse.json({ error: 'No connected vehicles' }, { status: 400 });
  }

  // Block if trial expired and no active subscription
  if (user.smartcarAddonStatus === 'expired') {
    return NextResponse.json({ error: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED' }, { status: 402 });
  }

  const vehicles = await prisma.vehicle.findMany({
    where: { userId, smartcarId: { not: null } },
  });

  const results = await Promise.allSettled(
    vehicles.map(async (v) => {
      let accessToken = v.smartcarAccessToken!;

      // Refresh token if expired or expiring within 5 minutes
      const expiry = v.smartcarTokenExpiry ? new Date(v.smartcarTokenExpiry) : null;
      if (!expiry || expiry.getTime() - Date.now() < 5 * 60 * 1000) {
        const refreshed = await refreshToken(v.smartcarRefreshToken!);
        accessToken = refreshed.access_token;
        await prisma.vehicle.update({
          where: { id: v.id },
          data: {
            smartcarAccessToken:  refreshed.access_token,
            smartcarRefreshToken: refreshed.refresh_token,
            smartcarTokenExpiry:  tokenExpiry(refreshed.expires_in),
          },
        });
      }

      const [fuel, odometer] = await Promise.allSettled([
        getFuelLevel(v.smartcarId!, accessToken),
        getOdometer(v.smartcarId!, accessToken),
      ]);

      const fuelData  = fuel.status === 'fulfilled'     ? fuel.value     : null;
      const odomData  = odometer.status === 'fulfilled' ? odometer.value : null;

      await prisma.vehicle.update({
        where: { id: v.id },
        data: {
          fuelLevel:      fuelData?.percentRemaining ?? v.fuelLevel,
          fuelRange:      fuelData?.range            ?? v.fuelRange,
          fuelLevelAt:    fuelData ? new Date().toISOString() : v.fuelLevelAt,
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

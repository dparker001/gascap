/**
 * GET /api/smartcar/sync?vehicleId=xxx
 * Fetches live fuel level + odometer from a Smartcar-connected GasCap vehicle.
 * Returns { fuelPercent: number|null, odometer: number|null }.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerSession }               from 'next-auth';
import type { Session }                   from 'next-auth';
import { authOptions }                    from '@/lib/auth';
import { prisma }                         from '@/lib/prisma';
import {
  syncVehicleData,
  refreshAccessToken,
  isTokenExpired,
} from '@/lib/smartcar';

function userId(session: Session | null) {
  return session?.user?.id ?? session?.user?.email ?? '';
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid       = userId(session);
  const vehicleId = new URL(req.url).searchParams.get('vehicleId');
  if (!vehicleId) return NextResponse.json({ error: 'Missing vehicleId.' }, { status: 400 });

  // Verify vehicle belongs to user and has a Smartcar link
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId: uid } });
  if (!vehicle) return NextResponse.json({ error: 'Vehicle not found.' }, { status: 404 });
  if (!vehicle.smartcarVehicleId) {
    return NextResponse.json({ error: 'This vehicle is not connected to Smartcar.' }, { status: 400 });
  }

  // Load user tokens
  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user?.smartcarRefreshToken) {
    return NextResponse.json({ error: 'No Smartcar authorization. Please reconnect your car.' }, { status: 401 });
  }

  // Refresh token if expired
  let accessToken = user.smartcarAccessToken ?? '';
  if (isTokenExpired(user.smartcarTokenExpiry)) {
    try {
      const refreshed = await refreshAccessToken(user.smartcarRefreshToken);
      accessToken = refreshed.accessToken;
      await prisma.user.update({
        where: { id: uid },
        data: {
          smartcarAccessToken:  refreshed.accessToken,
          smartcarRefreshToken: refreshed.refreshToken,
          smartcarTokenExpiry:  refreshed.expiry,
        },
      });
    } catch {
      await prisma.user.update({
        where: { id: uid },
        data: { smartcarAccessToken: null, smartcarRefreshToken: null, smartcarTokenExpiry: null },
      });
      return NextResponse.json({ error: 'Smartcar authorization expired. Please reconnect your car.' }, { status: 401 });
    }
  }

  try {
    const data = await syncVehicleData(vehicle.smartcarVehicleId, accessToken);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to sync vehicle data.';
    console.error('[GasCap] Smartcar sync error:', e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

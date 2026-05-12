/**
 * GET /api/smartcar/vehicles
 * Lists Smartcar vehicles for the current user (after OAuth).
 * Returns vehicle IDs with make/model/year/VIN for the linking UI.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import type { Session }     from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { prisma }           from '@/lib/prisma';
import {
  listVehicles,
  refreshAccessToken,
  isTokenExpired,
  type SmartcarVehicleInfo,
} from '@/lib/smartcar';

function userId(session: Session | null) {
  return session?.user?.id ?? session?.user?.email ?? '';
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid  = userId(session);
  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (!user.smartcarRefreshToken) {
    return NextResponse.json({ error: 'No Smartcar connection found. Connect your car first.' }, { status: 400 });
  }

  // Refresh token if needed
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
      // Refresh token itself is expired — user needs to re-authorize
      await prisma.user.update({
        where: { id: uid },
        data: { smartcarAccessToken: null, smartcarRefreshToken: null, smartcarTokenExpiry: null },
      });
      return NextResponse.json({ error: 'Smartcar authorization expired. Please reconnect your car.' }, { status: 401 });
    }
  }

  try {
    const vehicles: SmartcarVehicleInfo[] = await listVehicles(accessToken);
    return NextResponse.json({ vehicles });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to list vehicles.';
    console.error('[GasCap] Smartcar list vehicles error:', e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

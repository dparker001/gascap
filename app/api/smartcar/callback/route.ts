import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  getAppToken,
  getVehicleIds,
  getVehicleInfo,
  getOdometer,
  getFuelLevel,
  getVin,
} from '@/lib/smartcar';
import { nanoid } from 'nanoid';

// GET /api/smartcar/callback?code=...&user_id=...&state=...
// V3 flow: code is discarded; user_id is stored and used as sc-user-id header for API calls.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const state          = searchParams.get('state');
  const error          = searchParams.get('error');
  const smartcarUserId = searchParams.get('user_id'); // V3: Smartcar user identifier

  if (error) {
    return NextResponse.redirect(new URL('/settings?smartcar=denied', req.nextUrl.origin));
  }
  if (!state || !smartcarUserId) {
    return NextResponse.redirect(new URL('/settings?smartcar=error', req.nextUrl.origin));
  }

  // state = userId:nonce
  const userId = state.split(':')[0];
  if (!userId) {
    return NextResponse.redirect(new URL('/settings?smartcar=error', req.nextUrl.origin));
  }

  try {
    // V3: get app-level token via client_credentials
    const appToken   = await getAppToken();
    const vehicleIds = await getVehicleIds(appToken, smartcarUserId);

    // Upsert each Smartcar vehicle into our Vehicle table
    for (const smartcarId of vehicleIds) {
      const [info, vin, odometer, fuel] = await Promise.allSettled([
        getVehicleInfo(smartcarId, appToken, smartcarUserId),
        getVin(smartcarId, appToken, smartcarUserId),
        getOdometer(smartcarId, appToken, smartcarUserId),
        getFuelLevel(smartcarId, appToken, smartcarUserId),
      ]);

      const vehicleInfo = info.status === 'fulfilled' ? info.value : null;
      const vinData     = vin.status === 'fulfilled'  ? vin.value  : null;
      const odomData    = odometer.status === 'fulfilled' ? odometer.value : null;
      const fuelData    = fuel.status === 'fulfilled'  ? fuel.value  : null;

      const make  = vehicleInfo?.make  ?? null;
      const model = vehicleInfo?.model ?? null;
      const year  = vehicleInfo?.year  ? String(vehicleInfo.year) : null;
      const name  = [year, make, model].filter(Boolean).join(' ') || 'My Vehicle';

      const existing = await prisma.vehicle.findFirst({
        where: { userId, smartcarId },
      });

      if (existing) {
        await prisma.vehicle.update({
          where: { id: existing.id },
          data: {
            fuelLevel:       fuelData?.percentRemaining ?? null,
            fuelRange:       fuelData?.range            ?? null,
            fuelLevelAt:     fuelData ? new Date().toISOString() : null,
            currentOdometer: odomData?.distance ?? existing.currentOdometer,
            vin:   vinData?.vin  ?? existing.vin,
            make:  make  ?? existing.make,
            model: model ?? existing.model,
            year:  year  ?? existing.year,
          },
        });
      } else {
        await prisma.vehicle.create({
          data: {
            id:        nanoid(),
            userId,
            name,
            gallons:   0,
            vin:       vinData?.vin ?? null,
            make,
            model,
            year,
            fuelType:  'gasoline',
            createdAt: new Date().toISOString(),
            smartcarId,
            fuelLevel:       fuelData?.percentRemaining ?? null,
            fuelRange:       fuelData?.range            ?? null,
            fuelLevelAt:     fuelData ? new Date().toISOString() : null,
            currentOdometer: odomData?.distance ?? null,
          },
        });
      }
    }

    // Store Smartcar user_id on our User; start 14-day trial if first connection
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const now  = new Date();
    const userUpdate: Record<string, unknown> = {
      smartcarConnected:    true,
      smartcarUserId,
      smartcarVehicleCount: vehicleIds.length,
    };
    if (!user?.smartcarAddonStatus) {
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + 14);
      userUpdate.smartcarAddonStatus    = 'trial';
      userUpdate.smartcarTrialStartedAt = now.toISOString();
      userUpdate.smartcarTrialEndsAt    = trialEnd.toISOString();
    }
    await prisma.user.update({ where: { id: userId }, data: userUpdate });

    return NextResponse.redirect(new URL('/settings?smartcar=connected', req.nextUrl.origin));
  } catch (err) {
    const e = err as Error;
    console.error('[smartcar/callback] error:', e.message);
    return NextResponse.redirect(new URL('/settings?smartcar=error', req.nextUrl.origin));
  }
}

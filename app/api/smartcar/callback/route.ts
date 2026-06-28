import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  exchangeCode,
  getVehicleIds,
  getVehicleInfo,
  getOdometer,
  getFuelLevel,
  getVin,
  tokenExpiry,
} from '@/lib/smartcar';
import { nanoid } from 'nanoid';

// GET /api/smartcar/callback?code=...&state=...
// Exchanges the Smartcar auth code for tokens, fetches the user's vehicles,
// upserts them into the Vehicle table, and starts the 14-day trial.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/settings?smartcar=denied', req.nextUrl.origin));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL('/settings?smartcar=error', req.nextUrl.origin));
  }

  // state = userId:nonce
  const userId = state.split(':')[0];
  if (!userId) {
    return NextResponse.redirect(new URL('/settings?smartcar=error', req.nextUrl.origin));
  }

  try {
    // Exchange code for tokens
    const tokens    = await exchangeCode(code);
    const expiry    = tokenExpiry(tokens.expires_in);
    const vehicleIds = await getVehicleIds(tokens.access_token);

    // Upsert each Smartcar vehicle into our Vehicle table
    for (const smartcarId of vehicleIds) {
      const [info, vin, odometer, fuel] = await Promise.allSettled([
        getVehicleInfo(smartcarId, tokens.access_token),
        getVin(smartcarId, tokens.access_token),
        getOdometer(smartcarId, tokens.access_token),
        getFuelLevel(smartcarId, tokens.access_token),
      ]);

      const vehicleInfo = info.status === 'fulfilled' ? info.value : null;
      const vinData     = vin.status === 'fulfilled'  ? vin.value  : null;
      const odomData    = odometer.status === 'fulfilled' ? odometer.value : null;
      const fuelData    = fuel.status === 'fulfilled'  ? fuel.value  : null;

      const make  = vehicleInfo?.make  ?? null;
      const model = vehicleInfo?.model ?? null;
      const year  = vehicleInfo?.year  ? String(vehicleInfo.year) : null;
      const name  = [year, make, model].filter(Boolean).join(' ') || 'My Vehicle';

      // Check if this Smartcar vehicle is already linked
      const existing = await prisma.vehicle.findFirst({
        where: { userId, smartcarId },
      });

      if (existing) {
        await prisma.vehicle.update({
          where: { id: existing.id },
          data: {
            smartcarAccessToken:  tokens.access_token,
            smartcarRefreshToken: tokens.refresh_token,
            smartcarTokenExpiry:  expiry,
            fuelLevel:   fuelData?.percentRemaining ?? null,
            fuelRange:   fuelData?.range            ?? null,
            fuelLevelAt: fuelData ? new Date().toISOString() : null,
            currentOdometer: odomData?.distance ?? existing.currentOdometer,
            vin:  vinData?.vin ?? existing.vin,
            make: make ?? existing.make,
            model: model ?? existing.model,
            year:  year  ?? existing.year,
          },
        });
      } else {
        await prisma.vehicle.create({
          data: {
            id:      nanoid(),
            userId,
            name,
            gallons: 0,
            vin:     vinData?.vin ?? null,
            make,
            model,
            year,
            fuelType: 'gasoline',
            createdAt: new Date().toISOString(),
            smartcarId,
            smartcarAccessToken:  tokens.access_token,
            smartcarRefreshToken: tokens.refresh_token,
            smartcarTokenExpiry:  expiry,
            fuelLevel:   fuelData?.percentRemaining ?? null,
            fuelRange:   fuelData?.range            ?? null,
            fuelLevelAt: fuelData ? new Date().toISOString() : null,
            currentOdometer: odomData?.distance ?? null,
          },
        });
      }
    }

    // Start 14-day trial if not already started
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const now  = new Date();
    const trialUpdate: Record<string, unknown> = {
      smartcarConnected:    true,
      smartcarVehicleCount: vehicleIds.length,
    };
    if (!user?.smartcarAddonStatus) {
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + 14);
      trialUpdate.smartcarAddonStatus    = 'trial';
      trialUpdate.smartcarTrialStartedAt = now.toISOString();
      trialUpdate.smartcarTrialEndsAt    = trialEnd.toISOString();
    }
    await prisma.user.update({ where: { id: userId }, data: trialUpdate });

    return NextResponse.redirect(new URL('/settings?smartcar=connected', req.nextUrl.origin));
  } catch (err) {
    console.error('[smartcar/callback]', err);
    return NextResponse.redirect(new URL('/settings?smartcar=error', req.nextUrl.origin));
  }
}

/**
 * GET  /api/rental-sessions            — list the signed-in user's rental sessions
 * POST /api/rental-sessions            — create a new rental session (Level 1: manual entry)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RENTAL_RETURN_ASSISTANT_ENABLED } from '@/lib/featureFlags';
import { createRentalSession, getRentalSessionsForUser, type CreateRentalSessionInput } from '@/lib/rentalSessions';
import { ManualRentalDataProvider } from '@/lib/rentalProvider';

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return (session.user as { id?: string })?.id ?? null;
}

export async function GET(req: NextRequest) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const status = req.nextUrl.searchParams.get('status') ?? undefined;
  const sessions = await getRentalSessionsForUser(userId, status);
  return NextResponse.json({ sessions });
}

export async function POST(req: NextRequest) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  if (typeof body.rentalCompany !== 'string' || !body.rentalCompany.trim()) {
    return NextResponse.json({ error: 'Rental company is required.' }, { status: 400 });
  }

  // Level 1 goes through ManualRentalDataProvider even though the input is
  // already close to the target shape — every session, regardless of
  // provider, is created via this same normalize() call.
  const normalized = ManualRentalDataProvider.normalize({
    rentalCompany: body.rentalCompany,
    vehicle: {
      year: body.vehicleYear, make: body.vehicleMake, model: body.vehicleModel,
      trim: body.vehicleTrim, tankCapacityGallons: body.fuelTankCapacityGallons,
    },
  });

  const input: CreateRentalSessionInput = {
    rentalCompany:              normalized.rentalCompany,
    rentalAgreementNumber:      body.rentalAgreementNumber,
    vehicleId:                  body.vehicleId,
    vehicleYear:                body.vehicleYear,
    vehicleMake:                body.vehicleMake,
    vehicleModel:                body.vehicleModel,
    vehicleTrim:                 body.vehicleTrim,
    fuelTankCapacityGallons:     body.fuelTankCapacityGallons,
    pickupFuelGallons:           body.pickupFuelGallons,
    pickupFuelSource:            body.pickupFuelSource,
    requiredReturnPolicyType:    body.requiredReturnPolicyType,
    requiredReturnFuelGallons:   body.requiredReturnFuelGallons,
    rentalFuelChargePerGallon:   body.rentalFuelChargePerGallon,
    pickupDateTime:              body.pickupDateTime,
    returnDateTime:              body.returnDateTime,
    pickupLocation:              body.pickupLocation,
    returnLocation:               body.returnLocation,
    returnLatitude:               body.returnLatitude,
    returnLongitude:              body.returnLongitude,
    pickupVehiclePhotoThumb:      body.pickupVehiclePhotoThumb,
    pickupGaugePhotoThumb:        body.pickupGaugePhotoThumb,
    pickupAgreementPhotoThumb:    body.pickupAgreementPhotoThumb,
    notes:                        body.notes,
  };

  const created = await createRentalSession(userId, input);
  return NextResponse.json({ session: created }, { status: 201 });
}

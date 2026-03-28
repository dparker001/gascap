import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { findById } from '@/lib/users';
import { getVehiclesForUser, addVehicle, deleteVehicle } from '@/lib/savedVehicles';
import type { VehicleSpecs } from '@/lib/vehicleSpecs';

const PLAN_LIMITS = { free: 1, pro: 5, fleet: 9999 };

// GET /api/vehicles — list saved vehicles for the signed-in user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user = findById(userId);
  const plan  = user?.plan ?? 'free';
  const vehicles = getVehiclesForUser(userId);
  return NextResponse.json({ vehicles, plan, limit: PLAN_LIMITS[plan] });
}

// POST /api/vehicles — save a new vehicle
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';

  const body = await req.json() as {
    name?:             string;
    gallons?:          number;
    vin?:              string;
    year?:             string;
    make?:             string;
    model?:            string;
    trim?:             string;
    fuelType?:         string;
    epaId?:            string;
    currentOdometer?:  number;
    vehicleSpecs?:     VehicleSpecs;
  };

  if (!body.name?.trim())              return NextResponse.json({ error: 'Name is required.' },    { status: 400 });
  if (!body.gallons || body.gallons <= 0) return NextResponse.json({ error: 'Invalid tank size.' }, { status: 400 });

  const user  = findById(userId);
  const plan  = user?.plan ?? 'free';
  const limit = PLAN_LIMITS[plan];
  const existing = getVehiclesForUser(userId);

  if (existing.length >= limit) {
    const msg = plan === 'free'
      ? 'Free accounts can save 1 vehicle. Upgrade to Pro to save up to 5.'
      : 'Vehicle limit reached (5).';
    return NextResponse.json({ error: msg, limitReached: true, plan }, { status: 403 });
  }

  const vehicle = addVehicle(userId, body.name!, body.gallons!, {
    vin:             body.vin?.trim().toUpperCase() || undefined,
    year:            body.year,
    make:            body.make,
    model:           body.model,
    trim:            body.trim,
    fuelType:        body.fuelType,
    epaId:           body.epaId,
    currentOdometer: body.currentOdometer != null ? Number(body.currentOdometer) : undefined,
    vehicleSpecs:    body.vehicleSpecs,
  });
  return NextResponse.json(vehicle, { status: 201 });
}

// DELETE /api/vehicles?id=xxx — remove a saved vehicle
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing vehicle id.' }, { status: 400 });

  deleteVehicle(userId, id);
  return NextResponse.json({ ok: true });
}

// PATCH /api/vehicles?id=xxx — update name and/or gallons
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing vehicle id.' }, { status: 400 });

  const body = await req.json() as { name?: string; gallons?: number; currentOdometer?: number; vehicleSpecs?: VehicleSpecs };
  if (body.gallons !== undefined && body.gallons <= 0) {
    return NextResponse.json({ error: 'Invalid tank size.' }, { status: 400 });
  }

  const { updateVehicle } = await import('@/lib/savedVehicles');
  const updated = updateVehicle(userId, id, body);
  if (!updated) return NextResponse.json({ error: 'Vehicle not found.' }, { status: 404 });
  return NextResponse.json(updated);
}

/**
 * /api/fleet/drivers
 *  GET    — list the fleet owner's driver roster
 *  POST   — add a driver name   { name: string }
 *  DELETE — remove a driver     ?name=<encoded name>
 *
 * All endpoints require a fleet-plan session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  getFleetDrivers,
  addFleetDriver,
  removeFleetDriver,
  FLEET_DRIVER_LIMIT,
}                                    from '@/lib/users';

async function requireFleet() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { session: null, userId: '', error: 'Unauthorized', status: 401 };
  const plan = (session.user as { plan?: string }).plan ?? 'free';
  if (plan !== 'fleet') return { session, userId: '', error: 'Fleet plan required.', status: 403 };
  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  return { session, userId, error: null, status: 200 };
}

export async function GET() {
  const { userId, error, status } = await requireFleet();
  if (error) return NextResponse.json({ error }, { status });
  const drivers = await getFleetDrivers(userId);
  return NextResponse.json({ drivers, limit: FLEET_DRIVER_LIMIT });
}

export async function POST(req: NextRequest) {
  const { userId, error, status } = await requireFleet();
  if (error) return NextResponse.json({ error }, { status });

  const body = await req.json() as { name?: string };
  const name = body.name?.trim() ?? '';
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (name.length > 40) return NextResponse.json({ error: 'Name too long (max 40 chars).' }, { status: 400 });

  const current = await getFleetDrivers(userId);
  if (current.length >= FLEET_DRIVER_LIMIT) {
    return NextResponse.json(
      { error: `Driver limit reached (max ${FLEET_DRIVER_LIMIT}).` },
      { status: 422 },
    );
  }
  if (current.includes(name)) {
    return NextResponse.json({ error: 'A driver with that name already exists.' }, { status: 409 });
  }

  const drivers = await addFleetDriver(userId, name);
  return NextResponse.json({ drivers, limit: FLEET_DRIVER_LIMIT }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { userId, error, status } = await requireFleet();
  if (error) return NextResponse.json({ error }, { status });

  const name = new URL(req.url).searchParams.get('name') ?? '';
  if (!name) return NextResponse.json({ error: 'name param required.' }, { status: 400 });

  const drivers = await removeFleetDriver(userId, decodeURIComponent(name));
  return NextResponse.json({ drivers, limit: FLEET_DRIVER_LIMIT });
}

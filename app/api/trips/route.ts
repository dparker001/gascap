/**
 * /api/trips
 *  GET    — list user's saved trips
 *  POST   — save a new trip (Pro/Fleet only)
 *  DELETE — remove a saved trip (?id=xxx)
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import type { Session }     from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { getTripsForUser, addTrip, removeTrip } from '@/lib/savedTrips';
import type { SavedTrip }   from '@/lib/savedTrips';

function uid(session: Session | null): string {
  return session?.user?.id ?? session?.user?.email ?? '';
}

function isPro(session: Session | null): boolean {
  const plan = (session?.user as { plan?: string })?.plan ?? 'free';
  return plan === 'pro' || plan === 'fleet';
}

// ── GET /api/trips ─────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const trips = getTripsForUser(uid(session));
  return NextResponse.json({ ok: true, trips });
}

// ── POST /api/trips ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPro(session)) {
    return NextResponse.json({ error: 'Pro plan required to save trips.' }, { status: 403 });
  }

  let body: Omit<SavedTrip, 'id' | 'userId' | 'savedAt'>;
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.distanceMiles || !body.mpg || !body.tankGallons || !body.pricePerGallon) {
    return NextResponse.json({ error: 'Missing required trip fields.' }, { status: 400 });
  }

  const trip = addTrip(uid(session), body);
  return NextResponse.json({ ok: true, trip });
}

// ── DELETE /api/trips?id=xxx ───────────────────────────────────────────────────

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id parameter.' }, { status: 400 });
  }

  removeTrip(uid(session), id);
  return NextResponse.json({ ok: true });
}

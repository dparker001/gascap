/**
 * /api/fillups
 *  GET    — list user's fillups + MPG map + stats
 *  POST   — add a new fillup
 *  DELETE — remove a fillup (?id=xxx)
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import type { Session }     from 'next-auth';
import { authOptions }      from '@/lib/auth';
import {
  getFillups,
  addFillup,
  deleteFillup,
  computeMpg,
  getFillupStats,
  validateNewFillup,
  type Fillup,
} from '@/lib/fillups';

function userId(session: Session | null) {
  return session?.user?.id ?? session?.user?.email ?? '';
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const fillups = getFillups(userId(session));
  const mpgMap  = computeMpg(fillups);
  const stats   = getFillupStats(fillups, mpgMap);

  return NextResponse.json({ fillups, mpgMap, stats });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as Omit<Fillup, 'id' | 'userId' | 'totalCost' | 'createdAt'> & { force?: boolean };

  // Basic field validation
  if (!body.gallonsPumped || body.gallonsPumped <= 0)
    return NextResponse.json({ error: 'Invalid gallons.' }, { status: 400 });
  if (!body.pricePerGallon || body.pricePerGallon <= 0)
    return NextResponse.json({ error: 'Invalid price.' }, { status: 400 });
  if (!body.vehicleName)
    return NextResponse.json({ error: 'Vehicle name required.' }, { status: 400 });
  if (!body.date)
    return NextResponse.json({ error: 'Date required.' }, { status: 400 });

  // Smart validation — skip when user explicitly overrides
  if (!body.force) {
    const { errors, warnings, canOverride } = validateNewFillup(userId(session), body);

    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors[0], allErrors: errors, warnings },
        { status: 422 }
      );
    }

    if (warnings.length > 0) {
      return NextResponse.json(
        { warning: warnings[0], allWarnings: warnings, canOverride },
        { status: 409 }
      );
    }
  }

  // Remove `force` before storing
  const { force: _force, ...saveBody } = body;
  const entry = addFillup(userId(session), saveBody);
  return NextResponse.json(entry, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });

  const ok = deleteFillup(userId(session), id);
  if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

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
  updateFillup,
  computeMpg,
  getFillupStats,
  validateNewFillup,
  type Fillup,
  type FillupPatch,
} from '@/lib/fillups';
import { findById, markMilestoneSent } from '@/lib/users';
import { sendMilestoneEmail }          from '@/lib/emailEngagement';

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

  const body = await req.json() as Omit<Fillup, 'id' | 'userId' | 'totalCost' | 'createdAt'> & {
    force?:       boolean;
    driverLabel?: string;  // Fleet Phase 1 — optional driver attribution
  };

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
  const uid   = userId(session);
  const entry = addFillup(uid, saveBody);

  // Milestone checks — non-blocking so the 201 response is instant
  ;(async () => {
    try {
      const allFillups = getFillups(uid);
      const mpgMap     = computeMpg(allFillups);
      const user       = await findById(uid);
      if (!user || user.emailOptOut) return;

      const engUser = { id: user.id, name: user.name, email: user.email, plan: user.plan };

      // M1 — 10th fill-up
      if (allFillups.length === 10 && !user.milestoneFillup10Sent) {
        await sendMilestoneEmail('fillup10', engUser);
        await markMilestoneSent(user.id, 'fillup10');
      }

      // M2 — First MPG data point (any non-null value in the map)
      const hasMpg = Object.values(mpgMap).some((v) => v != null);
      if (hasMpg && !user.milestoneMpgSent) {
        await sendMilestoneEmail('mpg', engUser);
        await markMilestoneSent(user.id, 'mpg');
      }
    } catch (e) {
      console.error('[GasCap] Milestone check failed after fillup POST:', e);
    }
  })();

  return NextResponse.json(entry, { status: 201 });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { id: string; driverLabel?: string } & FillupPatch;
  if (!body.id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });

  if (body.gallonsPumped != null && body.gallonsPumped <= 0)
    return NextResponse.json({ error: 'Gallons must be greater than zero.' }, { status: 400 });
  if (body.pricePerGallon != null && body.pricePerGallon <= 0)
    return NextResponse.json({ error: 'Price must be greater than zero.' }, { status: 400 });

  const { id, ...patch } = body;
  const updated = updateFillup(userId(session), id, patch);
  if (!updated) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json(updated);
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

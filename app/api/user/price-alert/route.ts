import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }         from 'next-auth';
import { authOptions }              from '@/lib/auth';
import { findById, setPriceAlertThreshold } from '@/lib/users';

// ── GET — return current threshold ────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await findById((session.user as { id: string }).id);
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    threshold: user.priceAlertThreshold ?? null,
    plan:      user.plan,
  });
}

// ── PATCH — save threshold ────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid  = (session.user as { id: string }).id;
  const user = await findById(uid);
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Only Pro / Fleet users can set price alerts
  if (user.plan !== 'pro' && user.plan !== 'fleet') {
    return NextResponse.json({ error: 'Pro plan required' }, { status: 403 });
  }

  const body: { threshold?: number | null } = await req.json();

  if (body.threshold === null || body.threshold === undefined) {
    await setPriceAlertThreshold(uid, null);
  } else {
    const t = parseFloat(String(body.threshold));
    if (isNaN(t) || t <= 0 || t > 10) {
      return NextResponse.json({ error: 'Invalid threshold' }, { status: 400 });
    }
    await setPriceAlertThreshold(uid, t);
  }

  return NextResponse.json({ ok: true });
}

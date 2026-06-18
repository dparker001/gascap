/**
 * POST /api/push/digest  — ADMIN PREVIEW
 *
 * Sends ONE user their personalized monthly digest so an admin can see exactly
 * what the weekly digest looks like (delivery happens automatically via
 * /api/cron/digest). Body: { email }. Auth: x-admin-password.
 *
 * (Replaces the old web-only "send to all/one" GET handler — broadcast-to-all
 * is now the cron; the admin panel uses this for a per-user preview.)
 */
import { NextResponse } from 'next/server';
import { findByEmail }   from '@/lib/users';
import { prisma }        from '@/lib/prisma';
import { sendUserDigest } from '@/lib/digest';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

export async function POST(req: Request) {
  const pw = req.headers.get('x-admin-password') ?? '';
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { email } = await req.json().catch(() => ({})) as { email?: string };
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required.' }, { status: 400 });

  const user = await findByEmail(email.trim());
  if (!user) return NextResponse.json({ error: `No user found with email: ${email}` }, { status: 404 });

  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { iosPushToken: true } });
  const r = await sendUserDigest({ id: user.id, iosPushToken: u?.iosPushToken ?? null });

  if (!r.active) {
    return NextResponse.json({ error: 'This user has no fill-ups this month — their digest would be empty (skipped in the weekly send).' }, { status: 200 });
  }
  return NextResponse.json({
    ok:       r.delivered,
    preview:  r.digest,
    ...(r.delivered ? {} : { error: 'Digest built, but this user has no active push subscription (no iOS token / web sub).' }),
  });
}

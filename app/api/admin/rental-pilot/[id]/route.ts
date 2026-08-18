/**
 * GET   /api/admin/rental-pilot/:id — full session detail incl. photos, for
 *       reviewing a specific fuel-fee dispute.
 * PATCH /api/admin/rental-pilot/:id — admin override: force-complete or
 *       force-cancel a stuck session (e.g. abandoned, never marked done).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sessionHasAdminRole } from '@/lib/adminAuth';

async function auth(req: Request): Promise<'ok' | 'no-env' | 'wrong'> {
  const pw = process.env.ADMIN_PASSWORD;
  const header = req.headers.get('x-admin-password') ?? '';
  if (pw && header === pw) return 'ok';
  if (await sessionHasAdminRole()) return 'ok';
  return pw ? 'wrong' : 'no-env';
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const _auth = await auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized' },   { status: 401 });

  const session = await prisma.rentalSession.findUnique({ where: { id: params.id } });
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const user = await prisma.user.findUnique({
    where:  { id: session.userId },
    select: { email: true, name: true },
  });

  return NextResponse.json({ session: { ...session, userEmail: user?.email ?? null, userName: user?.name ?? null } });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const _auth = await auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized' },   { status: 401 });

  const body = await req.json().catch(() => null) as { action?: 'complete' | 'cancel' } | null;
  if (!body?.action) return NextResponse.json({ error: 'Missing action' }, { status: 400 });

  if (body.action === 'cancel') {
    await prisma.rentalSession.update({
      where: { id: params.id },
      data:  { status: 'cancelled', updatedAt: new Date().toISOString() },
    });
  } else if (body.action === 'complete') {
    await prisma.rentalSession.update({
      where: { id: params.id },
      data:  { status: 'completed', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

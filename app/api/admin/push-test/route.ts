/**
 * POST /api/admin/push-test  — send a test native push to one user's iPhone.
 * Body: { email, title?, body? }.  Auth: x-admin-password header.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendApns, apnsConfigured } from '@/lib/apns';

function auth(req: Request): boolean {
  const pw = process.env.ADMIN_PASSWORD ?? '';
  return Boolean(pw && req.headers.get('x-admin-password') === pw);
}

export async function POST(req: Request) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!apnsConfigured()) {
    return NextResponse.json({ error: 'APNs not configured — set APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY in Railway' }, { status: 503 });
  }

  const b     = await req.json().catch(() => ({})) as { email?: string; title?: string; body?: string };
  const email = (b.email ?? '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email }, select: { iosPushToken: true } });
  if (!user?.iosPushToken) {
    return NextResponse.json({ error: 'No iOS push token stored for that user' }, { status: 404 });
  }

  const result = await sendApns(
    user.iosPushToken,
    b.title ?? 'GasCap™',
    b.body  ?? 'Push notifications are live 🚀',
  );
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

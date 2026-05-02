/**
 * GET  /api/fleet/branding — returns fleet branding for the signed-in user
 * PATCH /api/fleet/branding — updates fleetCompanyName and/or fleetLogoUrl
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { findById } from '@/lib/users';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user = await findById(userId);
  if (user?.plan !== 'fleet') return NextResponse.json({ error: 'Fleet plan required' }, { status: 403 });
  return NextResponse.json({
    companyName: user.fleetCompanyName ?? '',
    logoUrl:     user.fleetLogoUrl     ?? '',
  });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user = await findById(userId);
  if (user?.plan !== 'fleet') return NextResponse.json({ error: 'Fleet plan required' }, { status: 403 });

  const { companyName, logoUrl } = await req.json() as { companyName?: string; logoUrl?: string };

  // Basic validation — logoUrl must be https if provided
  if (logoUrl && !logoUrl.startsWith('https://')) {
    return NextResponse.json({ error: 'Logo URL must start with https://' }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      fleetCompanyName: companyName?.trim() || null,
      fleetLogoUrl:     logoUrl?.trim()     || null,
    },
  });

  return NextResponse.json({ ok: true });
}

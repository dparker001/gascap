/**
 * GET    /api/favorites            — list the signed-in user's favorite stations
 * POST   /api/favorites            — save a station (last-known price snapshot)
 * DELETE /api/favorites?placeId=…  — remove a favorite
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { prisma }                    from '@/lib/prisma';
import { randomUUID }                from 'crypto';

// Keeps the Find Gas idle/results screen from pushing its primary CTA out of
// view when a user favorites a lot of stations.
const MAX_FAVORITES = 3;

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return (session.user as { id?: string })?.id ?? null;
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const favorites = await prisma.favoriteStation.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ favorites });
}

export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { placeId, name, address, lat, lng, prices } = body;
  if (
    typeof placeId !== 'string' || !placeId ||
    typeof name    !== 'string' || !name ||
    typeof address !== 'string' ||
    typeof lat     !== 'number' ||
    typeof lng     !== 'number'
  ) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
  }

  const existing = await prisma.favoriteStation.findUnique({
    where: { userId_placeId: { userId, placeId } },
  });
  if (!existing) {
    const count = await prisma.favoriteStation.count({ where: { userId } });
    if (count >= MAX_FAVORITES) {
      return NextResponse.json({ error: 'favorite_limit', limit: MAX_FAVORITES }, { status: 409 });
    }
  }

  const favorite = await prisma.favoriteStation.upsert({
    where:  { userId_placeId: { userId, placeId } },
    update: { name, address, lat, lng, prices: prices ?? [], priceUpdatedAt: new Date().toISOString() },
    create: {
      id:             randomUUID(),
      userId,
      placeId,
      name,
      address,
      lat,
      lng,
      prices:         prices ?? [],
      priceUpdatedAt: new Date().toISOString(),
      createdAt:      new Date().toISOString(),
    },
  });

  return NextResponse.json({ favorite });
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const placeId = req.nextUrl.searchParams.get('placeId');
  if (!placeId) return NextResponse.json({ error: 'Missing placeId' }, { status: 400 });

  await prisma.favoriteStation.deleteMany({ where: { userId, placeId } });

  return NextResponse.json({ ok: true });
}

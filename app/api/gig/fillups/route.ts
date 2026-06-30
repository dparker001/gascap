import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const uid = (session.user as { id?: string }).id ?? '';

  const { searchParams } = new URL(req.url);
  const weeks = parseInt(searchParams.get('weeks') ?? '4', 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const fillups = await prisma.gigFillup.findMany({
    where: { userId: uid, date: { gte: cutoffStr } },
    orderBy: { date: 'desc' },
  });

  return NextResponse.json({ fillups });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const uid = (session.user as { id?: string }).id ?? '';

  const body = await req.json() as {
    date:           string;
    gallons:        number;
    pricePerGallon: number;
    station?:       string;
    odometer?:      number;
    platform?:      string;
    notes?:         string;
  };

  if (!body.date || !body.gallons || !body.pricePerGallon) {
    return NextResponse.json({ error: 'date, gallons, and pricePerGallon are required' }, { status: 400 });
  }

  const VALID_PLATFORMS = ['uber','lyft','doordash','instacart','spark','amazon_flex','shipt','courier','other'];
  const platform = VALID_PLATFORMS.includes(body.platform ?? '') ? body.platform : null;

  const record = await prisma.gigFillup.create({
    data: {
      id:             crypto.randomUUID(),
      userId:         uid,
      date:           body.date,
      gallons:        body.gallons,
      pricePerGallon: body.pricePerGallon,
      totalCost:      Math.round(body.gallons * body.pricePerGallon * 100) / 100,
      station:        body.station?.trim() || null,
      odometer:       body.odometer ?? null,
      platform:       platform ?? null,
      notes:          body.notes?.trim() || null,
      createdAt:      new Date().toISOString(),
    },
  });

  return NextResponse.json({ fillup: record }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const uid = (session.user as { id?: string }).id ?? '';

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await prisma.gigFillup.deleteMany({ where: { id, userId: uid } });
  return NextResponse.json({ ok: true });
}

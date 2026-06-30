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

  const entries = await prisma.gigMileage.findMany({
    where: { userId: uid, date: { gte: cutoffStr } },
    orderBy: { date: 'desc' },
  });

  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const uid = (session.user as { id?: string }).id ?? '';

  const body = await req.json() as {
    date:           string;
    miles:          number;
    startOdometer?: number;
    endOdometer?:   number;
    platform?:      string;
    category?:      string;
    notes?:         string;
  };

  if (!body.date || !body.miles) {
    return NextResponse.json({ error: 'date and miles are required' }, { status: 400 });
  }

  const VALID_PLATFORMS = ['uber','lyft','doordash','instacart','spark','amazon_flex','shipt','courier','other'];
  const VALID_CATEGORIES = ['business','personal'];
  const platform = VALID_PLATFORMS.includes(body.platform ?? '') ? body.platform : null;
  const category = VALID_CATEGORIES.includes(body.category ?? '') ? body.category! : 'business';

  const record = await prisma.gigMileage.create({
    data: {
      id:            crypto.randomUUID(),
      userId:        uid,
      date:          body.date,
      miles:         body.miles,
      startOdometer: body.startOdometer ?? null,
      endOdometer:   body.endOdometer   ?? null,
      platform:      platform ?? null,
      category,
      notes:         body.notes?.trim() || null,
      createdAt:     new Date().toISOString(),
    },
  });

  return NextResponse.json({ entry: record }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const uid = (session.user as { id?: string }).id ?? '';

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await prisma.gigMileage.deleteMany({ where: { id, userId: uid } });
  return NextResponse.json({ ok: true });
}

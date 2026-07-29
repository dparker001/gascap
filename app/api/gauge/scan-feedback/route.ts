/**
 * POST /api/gauge/scan-feedback
 * Fire-and-forget: stores gauge scan result for QA / future model improvement.
 */
import { NextResponse } from 'next/server';
import { getToken }    from 'next-auth/jwt';
import { prisma }      from '@/lib/prisma';

interface ScanFeedbackBody {
  detectedPercent?:  number | null;
  confirmedPercent:  number;
  confidence:        number;
  gaugeType:         string;
  reason?:           string;
  vehicleId?:        string;
  vehicleName?:      string;
  tankSize?:         number;
}

export async function POST(req: Request) {
  const token = await getToken({ req: req as Parameters<typeof getToken>[0]['req'], secret: process.env.NEXTAUTH_SECRET });
  if (!token?.sub && !token?.id) return NextResponse.json({ ok: false }, { status: 401 });

  const userId = (token.sub ?? token.id) as string;

  let body: ScanFeedbackBody;
  try {
    body = await req.json() as ScanFeedbackBody;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    await prisma.gaugeScanLog.create({
      data: {
        id:               crypto.randomUUID(),
        userId,
        detectedPercent:  body.detectedPercent ?? null,
        confirmedPercent: body.confirmedPercent,
        confidence:       body.confidence,
        gaugeType:        body.gaugeType ?? 'unknown',
        reason:           body.reason?.slice(0, 300) ?? null,
        vehicleId:        body.vehicleId ?? null,
        vehicleName:      body.vehicleName ?? null,
        tankSize:         body.tankSize ?? null,
        createdAt:        new Date().toISOString(),
      },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

/**
 * POST /api/native/push-debug  — TEMPORARY diagnostic for native push setup.
 * Records breadcrumbs from NativePushRegistration so we can see where the flow
 * stops on-device. No auth (runs before sign-in too). Remove once push is verified.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({})) as { stage?: string; detail?: string };
  try {
    await prisma.$executeRaw`INSERT INTO push_debug (stage, detail) VALUES (${String(b.stage ?? '')}, ${String(b.detail ?? '').slice(0, 300)})`;
  } catch { /* table may not exist — ignore */ }
  return NextResponse.json({ ok: true });
}

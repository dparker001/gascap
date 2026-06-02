/**
 * Admin API — protected by ADMIN_PASSWORD env var
 * GET /api/admin/gifts — list all gift purchases (newest first)
 */
import { NextResponse } from 'next/server';
import { listGifts } from '@/lib/gifts';

function auth(req: Request): 'ok' | 'no-env' | 'wrong' {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return 'no-env';
  const header = req.headers.get('x-admin-password') ?? '';
  return header === pw ? 'ok' : 'wrong';
}

export async function GET(req: Request) {
  const a = auth(req);
  if (a === 'no-env') return NextResponse.json({ error: 'ADMIN_PASSWORD not set.' }, { status: 500 });
  if (a === 'wrong')  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const gifts = await listGifts();
  return NextResponse.json({ gifts, total: gifts.length });
}

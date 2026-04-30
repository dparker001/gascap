/**
 * GET /api/admin/email-log
 *
 * Returns recent email sends recorded in the EmailLog table.
 * Protected by ADMIN_PASSWORD header.
 *
 * Query params:
 *   search  — filter by userName or userEmail (case-insensitive)
 *   type    — filter by email type (substring match)
 *   limit   — max rows to return (default 200, max 500)
 */
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/prisma';

function auth(req: Request): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  return req.headers.get('x-admin-password') === pw;
}

export async function GET(req: Request) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search')?.trim() || undefined;
  const type   = searchParams.get('type')?.trim()   || undefined;
  const limit  = Math.min(parseInt(searchParams.get('limit') ?? '200', 10), 500);

  const logs = await prisma.emailLog.findMany({
    where: {
      ...(search ? {
        OR: [
          { userEmail: { contains: search, mode: 'insensitive' } },
          { userName:  { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
      ...(type ? { type: { contains: type, mode: 'insensitive' } } : {}),
    },
    orderBy: { sentAt: 'desc' },
    take:    limit,
  });

  return NextResponse.json({ logs, total: logs.length });
}

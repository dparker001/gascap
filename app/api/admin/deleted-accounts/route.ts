/**
 * GET /api/admin/deleted-accounts
 *
 * Returns the DeletedAccountLog — a record of every account deleted through
 * the admin panel, including user info snapshot, reason, and whether the
 * confirmation email was sent successfully.
 *
 * Secured with ADMIN_PASSWORD header (same as /api/admin/users).
 */
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/prisma';
import { sessionHasAdminRole } from '@/lib/adminAuth';

async function auth(req: Request): Promise<'ok' | 'no-env' | 'wrong'> {
  const pw = process.env.ADMIN_PASSWORD;
  if (req.headers.get('x-admin-password') === pw && pw) return 'ok';
  if (await sessionHasAdminRole()) return 'ok';
  return pw ? 'wrong' : 'no-env';
}

export async function GET(req: Request) {
  const _auth = await auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized' },   { status: 401 });

  const rows = await prisma.deletedAccountLog.findMany({
    orderBy: { deletedAt: 'desc' },
  });

  return NextResponse.json({ deleted: rows, total: rows.length });
}

/**
 * Temporary diagnostic endpoint — no auth required.
 * Returns env-var metadata (never the values themselves).
 * DELETE THIS FILE once the admin password issue is resolved.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const adminPw  = process.env.ADMIN_PASSWORD;
  const dbUrl    = process.env.DATABASE_URL;
  const authSec  = process.env.NEXTAUTH_SECRET;
  const nodeEnv  = process.env.NODE_ENV;

  return NextResponse.json({
    deployedAt:       new Date().toISOString(),
    nodeEnv,
    ADMIN_PASSWORD:   adminPw  ? `set (${adminPw.length} chars)` : 'NOT SET',
    DATABASE_URL:     dbUrl    ? `set (${dbUrl.length} chars)`   : 'NOT SET',
    NEXTAUTH_SECRET:  authSec  ? `set (${authSec.length} chars)` : 'NOT SET',
    nodeVersion:      process.version,
  });
}

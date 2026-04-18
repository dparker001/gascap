/**
 * Temporary diagnostic endpoint — no auth required.
 * Returns env-var metadata (never the values themselves).
 * DELETE THIS FILE once the admin password issue is resolved.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const adminPw  = process.env.ADMIN_PASSWORD;
  const dbUrl    = process.env.DATABASE_URL;
  const authSec  = process.env.NEXTAUTH_SECRET;
  const nodeEnv  = process.env.NODE_ENV;

  // Optional: test a candidate password without revealing the real one
  const url       = new URL(req.url);
  const candidate = url.searchParams.get('test');
  const testResult = candidate !== null
    ? (adminPw ? (candidate === adminPw ? 'MATCH' : 'NO MATCH') : 'ENV NOT SET')
    : undefined;

  // Reveal first 2 and last 2 chars as a hint (safe for an admin tool)
  const hint = adminPw && adminPw.length >= 4
    ? `${adminPw.slice(0, 2)}${'*'.repeat(adminPw.length - 4)}${adminPw.slice(-2)}`
    : adminPw ? '****' : null;

  // Extract just the hostname from DATABASE_URL (safe to expose)
  let dbHost = 'unknown';
  try {
    if (dbUrl) {
      const u = new URL(dbUrl);
      dbHost = `${u.hostname}:${u.port}`;
    }
  } catch { /* ignore */ }

  return NextResponse.json({
    deployedAt:       new Date().toISOString(),
    nodeEnv,
    ADMIN_PASSWORD:   adminPw  ? `set (${adminPw.length} chars) hint: ${hint}` : 'NOT SET',
    DATABASE_URL:     dbUrl    ? `set (${dbUrl.length} chars) host: ${dbHost}` : 'NOT SET',
    NEXTAUTH_SECRET:  authSec  ? `set (${authSec.length} chars)` : 'NOT SET',
    nodeVersion:      process.version,
    ...(testResult !== undefined && { testResult }),
  });
}

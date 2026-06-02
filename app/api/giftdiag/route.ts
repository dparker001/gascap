/**
 * TEMP DIAGNOSTIC — remove after debugging. GET /api/giftdiag
 * Reports DB connectivity from the DEPLOYED runtime. No secrets exposed
 * (only presence/length/scheme of DATABASE_URL, never the value).
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const out: Record<string, unknown> = {};

  // Env presence (no secret value)
  const url = process.env.DATABASE_URL;
  out.hasDatabaseUrl = typeof url === 'string' && url.length > 0;
  out.databaseUrlLength = typeof url === 'string' ? url.length : 0;
  out.databaseUrlScheme = typeof url === 'string' ? url.split('://')[0] : null;
  out.nodeEnv = process.env.NODE_ENV ?? null;
  // Which DB-ish env vars exist (names only)
  out.dbEnvVarsPresent = Object.keys(process.env).filter((k) =>
    /DATABASE|POSTGRES|PG/i.test(k),
  );

  // Try a trivial query and capture the FULL error
  try {
    out.userCount = await prisma.user.count();
    out.dbOk = true;
  } catch (e) {
    out.dbOk = false;
    out.errorName = e instanceof Error ? e.name : typeof e;
    out.errorMessage = e instanceof Error ? e.message : String(e);
    out.errorStack = e instanceof Error ? (e.stack ?? '').split('\n').slice(0, 4).join(' | ') : null;
  }

  return NextResponse.json(out);
}

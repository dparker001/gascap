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

  // 1) Trivial existing-table query (connection sanity)
  try {
    out.userCount = await prisma.user.count();
    out.dbOk = true;
  } catch (e) {
    out.dbOk = false;
    out.userError = e instanceof Error ? e.message : String(e);
  }

  // 2) Does the deployed client have the Gift model + can it read the table?
  try {
    out.giftCount = await prisma.gift.count();
    out.giftTableOk = true;
    const test = await prisma.gift.findUnique({ where: { code: 'GASCAP-TEST-DEMO' } });
    out.testCodeFound = !!test;
  } catch (e) {
    out.giftTableOk = false;
    out.giftErrorName = e instanceof Error ? e.name : typeof e;
    out.giftError = e instanceof Error ? e.message.slice(0, 300) : String(e);
  }

  return NextResponse.json(out);
}

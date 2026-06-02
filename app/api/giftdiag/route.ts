/**
 * TEMP DIAGNOSTIC — remove after debugging the gift webhook.
 * GET /api/_debug/giftcheck
 * Reports whether the DEPLOYED app can query the Gift table and which DB host it's on.
 * No secrets exposed (DB host only, credentials stripped).
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const result: Record<string, unknown> = {};

  // Which DB host is the deployed app connected to? (host only, no creds)
  try {
    const url = process.env.DATABASE_URL ?? '';
    const m = url.match(/@([^/:?]+)/);
    result.dbHost = m ? m[1] : '(unparsed)';
  } catch { result.dbHost = '(error)'; }

  // Can the deployed Prisma client see the Gift model/table?
  try {
    const count = await prisma.gift.count();
    result.giftTableOk = true;
    result.giftCount = count;
  } catch (e) {
    result.giftTableOk = false;
    result.giftError = e instanceof Error ? e.message : String(e);
  }

  // Sanity: can it read an existing table (User)?
  try {
    result.userCount = await prisma.user.count();
  } catch (e) {
    result.userError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(result);
}

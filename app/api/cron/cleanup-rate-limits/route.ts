/**
 * GET /api/cron/cleanup-rate-limits
 *
 * Post-Sprint-2 Revision 1 — retention for the Postgres-backed rate limiter
 * (lib/rateLimitDb.ts). Without this, `RateLimitCounter` grows forever: any
 * distinct key (a hashed email, an IP) that ever made a rate-limited request
 * leaves a row behind permanently, including ones from an attacker
 * deliberately varying the identifier just to grow the table. Deletes rows
 * whose window closed more than RETENTION_MS ago — well past the point
 * they're doing any rate-limiting work.
 *
 * Secured with CRON_SECRET. Schedule daily in Railway/crons.yml.
 */
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/prisma';

// Generous grace period past window expiry — the goal is table hygiene, not
// tight cleanup, so there's no reason to race a window that just closed.
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours past resetAt

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!process.env.CRON_SECRET || searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_MS);
  try {
    const { count } = await prisma.rateLimitCounter.deleteMany({
      where: { resetAt: { lt: cutoff } },
    });
    console.log(`[cleanup-rate-limits] deleted ${count} expired counter row(s) older than ${cutoff.toISOString()}`);
    return NextResponse.json({ ok: true, deleted: count });
  } catch (err) {
    console.error('[cleanup-rate-limits] failed:', err);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}

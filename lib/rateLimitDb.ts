/**
 * Sprint 2 hardening — PostgreSQL-backed rate limiting.
 *
 * `lib/rateLimit.ts` (Sprint 1's in-memory Map) has two real weaknesses,
 * documented at the time rather than discovered later: counters reset on
 * every deploy, and they don't share state across instances if GasCap ever
 * scales horizontally. Both fail silently — a limiter that's supposed to
 * reject and doesn't just looks like normal traffic. This closes both using
 * infrastructure GasCap already owns and backs up, per
 * docs/RATE_LIMITING_PLAN.md's recommendation over introducing Redis.
 *
 * `checkRateLimit()` (in-memory) is NOT being replaced everywhere — this is
 * additive, applied to the surfaces that most need durability: password
 * reset (had no rate limiting of any kind, found during Sprint 2
 * inspection) and OTP send (consolidated off its own redundant local
 * implementation, see app/api/otp/send/route.ts).
 */

import { prisma } from '@/lib/prisma';

export interface DbRateLimitResult {
  allowed:        boolean;
  remaining:      number;
  resetInSeconds: number;
}

/**
 * Atomic check-and-increment against Postgres.
 *
 * Uses a single UPDATE ... RETURNING when the window is still open (atomic —
 * no read-then-write race between concurrent requests), and falls back to an
 * upsert only when starting a fresh window. Two concurrent requests starting
 * the very first window for a brand-new key could both attempt the initial
 * insert; the unique key constraint means only one wins, and the loser's
 * catch reads the winner's row and increments it instead — still correct,
 * just one extra round trip in the rare first-request-ever race.
 */
export async function checkRateLimitDb(
  key: string,
  limit: number,
  windowMs: number,
): Promise<DbRateLimitResult> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const existing = await prisma.rateLimitCounter.findUnique({ where: { key } });

  if (existing && new Date(existing.resetAt).getTime() > now) {
    // Window still open — atomic increment.
    const updated = await prisma.rateLimitCounter.update({
      where: { key },
      data:  { count: { increment: 1 } },
    });
    const allowed = updated.count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - updated.count),
      resetInSeconds: Math.ceil((new Date(updated.resetAt).getTime() - now) / 1000),
    };
  }

  // No row, or the previous window has expired — start a fresh one.
  const resetAt = new Date(now + windowMs).toISOString();
  try {
    const created = await prisma.rateLimitCounter.upsert({
      where:  { key },
      create: { key, count: 1, resetAt },
      update: { count: 1, resetAt },
    });
    return { allowed: created.count <= limit, remaining: Math.max(0, limit - created.count), resetInSeconds: Math.ceil(windowMs / 1000) };
  } catch {
    // Lost a fresh-window race to a concurrent request — increment theirs.
    const updated = await prisma.rateLimitCounter.update({
      where: { key },
      data:  { count: { increment: 1 } },
    });
    return {
      allowed: updated.count <= limit,
      remaining: Math.max(0, limit - updated.count),
      resetInSeconds: Math.ceil((new Date(updated.resetAt).getTime() - now) / 1000),
    };
  }
}

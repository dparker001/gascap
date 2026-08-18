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
 *
 * POST-SPRINT-2 REVISION 1 FIX — the original implementation here read the
 * row (`findUnique`), decided in application code whether the window had
 * expired, and then wrote a plain `upsert` reflecting that decision. That
 * read-then-decide-then-write sequence is not atomic: two concurrent
 * requests arriving right at a window rollover could both read the SAME
 * expired row, both conclude "start fresh," and both write `count: 1` —
 * losing one of the two requests from the count entirely (2 requests
 * occurred, the stored count says 1). Rewritten as a single atomic
 * `INSERT ... ON CONFLICT ... DO UPDATE` with the expiry check INSIDE the
 * SQL statement itself (a `CASE` on the row's own current `resetAt`,
 * evaluated atomically by Postgres as part of the same statement) — there
 * is no window between "read" and "write" for a second request to land in.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

/**
 * Post-Sprint-2 Revision 1 fix — hash a PII identifier (an email address)
 * before it becomes part of a durable rate-limit key. Before this,
 * `RateLimitCounter.key` stored plaintext normalized emails
 * (`otp-send-email:user@example.com`, `pwreset-email:user@example.com`) as
 * durable Postgres rows — real, if minor, PII exposure in a table that
 * exists purely for counting, not identity.
 *
 * Deterministic (same email always hashes to the same key, so the limiter
 * still works) but NOT HMAC'd with a secret — this is table hygiene against
 * casual plaintext exposure (a DB dump, an admin query, a backup), not a
 * defense against a determined attacker with a list of candidate emails
 * hashing each one to check membership. That tradeoff is acceptable here:
 * the data these rows protect is "how many times has X requested a
 * password reset recently," not something where a false-positive
 * membership guess is itself damaging, and the rows are short-lived (see
 * app/api/cron/cleanup-rate-limits/route.ts). If a stronger guarantee is
 * ever needed, switch to HMAC-SHA256 with a dedicated secret — do not
 * reuse another secret already used for auth/signing.
 */
export function hashRateLimitIdentifier(identifier: string): string {
  return crypto.createHash('sha256').update(identifier.toLowerCase().trim()).digest('hex');
}

export interface DbRateLimitResult {
  allowed:        boolean;
  remaining:      number;
  resetInSeconds: number;
}

/**
 * Atomic check-and-increment against Postgres. Single round trip, single
 * statement — see the file header for why this must be one atomic
 * statement rather than a read followed by a conditional write.
 */
export async function checkRateLimitDb(
  key: string,
  limit: number,
  windowMs: number,
): Promise<DbRateLimitResult> {
  const now = new Date();
  const freshResetAt = new Date(now.getTime() + windowMs);

  const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimitCounter" ("key", "count", "resetAt")
    VALUES (${key}, 1, ${freshResetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count"   = CASE WHEN "RateLimitCounter"."resetAt" <= ${now}
                        THEN 1
                        ELSE "RateLimitCounter"."count" + 1
                   END,
      "resetAt" = CASE WHEN "RateLimitCounter"."resetAt" <= ${now}
                        THEN ${freshResetAt}
                        ELSE "RateLimitCounter"."resetAt"
                   END
    RETURNING "count", "resetAt"
  `;

  const row = rows[0];
  const allowed = row.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - row.count),
    resetInSeconds: Math.max(0, Math.ceil((new Date(row.resetAt).getTime() - now.getTime()) / 1000)),
  };
}

/**
 * Sprint 2 hardening — server-side admin authorization.
 *
 * Replaces the shared ADMIN_PASSWORD / x-admin-password pattern with
 * NextAuth session + a database-resolved role. Staged as DUAL-AUTH: every
 * endpoint accepts either a valid admin session OR the legacy header, so
 * nothing can lock Don out mid-migration. The legacy path is logged (without
 * the password) so its usage can be watched and, once it goes quiet, removed
 * in a small follow-up PR — see docs/ADMIN_AUTH_MIGRATION.md for the removal
 * criteria.
 *
 * Role is ALWAYS resolved live from the database inside this module, never
 * trusted from client state, a query param, a request body, or a JWT claim
 * alone — a stale or forged claim of "admin" must not grant anything.
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export type AdminAuthResult =
  | { ok: true; userId: string; email: string; via: 'session' | 'legacy' }
  | { ok: false; status: 401 | 403 | 503 };

/**
 * Constant-time string comparison — same rationale as the RevenueCat webhook
 * fix in Sprint 1: this compares a secret, and `!==` leaks timing.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Resolve the current request's admin identity, if any.
 *
 * Session path (preferred): a signed-in NextAuth user whose `role` column —
 * read fresh from Postgres, not the JWT — is 'admin'.
 *
 * Legacy path (deprecated, logged): the `x-admin-password` header matches
 * ADMIN_PASSWORD. Fails closed exactly as it did before Sprint 2 — a missing
 * env var never grants access.
 */
export async function requireAdmin(req: NextRequest | Request): Promise<AdminAuthResult> {
  // Session path.
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  if (sessionUserId) {
    const user = await prisma.user.findUnique({
      where:  { id: sessionUserId },
      select: { id: true, email: true, role: true },
    });
    if (user?.role === 'admin') {
      return { ok: true, userId: user.id, email: user.email, via: 'session' };
    }
    // Signed in but not admin: fall through to the legacy header rather than
    // reject immediately — a non-admin GasCap user hitting an admin endpoint
    // with a valid legacy password is still a legitimate (if deprecated) call.
  }

  // Legacy path.
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) {
    // Fails closed: no configured secret means no legacy access, same as
    // every other shared-secret endpoint audited in Sprint 1.
    return { ok: false, status: 503 };
  }
  const supplied = req.headers.get('x-admin-password');
  if (supplied && safeEqual(supplied, configured)) {
    // Logged without the password, and without which endpoint — the caller
    // logs that itself if useful. This line exists so "has the legacy path
    // gone quiet" is answerable from logs before removing it.
    console.warn('[adminAuth] legacy ADMIN_PASSWORD path used — see docs/ADMIN_AUTH_MIGRATION.md removal criteria');
    // Legacy callers have no session-resolved identity; attribute audit-log
    // entries to a fixed sentinel rather than inventing a fake user id.
    return { ok: true, userId: 'legacy-admin-password', email: 'legacy@admin', via: 'legacy' };
  }

  return { ok: false, status: 401 };
}

/** Convenience: true/false without the identity, for call sites that don't need it. */
export async function isAdmin(req: NextRequest | Request): Promise<boolean> {
  return (await requireAdmin(req)).ok;
}

/**
 * Session-only half of requireAdmin, with no legacy fallback.
 *
 * Every one of the 21 ADMIN_PASSWORD-gated routes (audited in
 * docs/SECURITY_AUDIT.md) already has its own local `auth()` helper with its
 * own return type and call sites. Rather than restructure 21 files' control
 * flow around the single combined requireAdmin() above — real risk on
 * endpoints that send email, run the sweepstakes draw, and delete accounts —
 * each file's existing auth() is widened to OR this in:
 *
 *   return legacyCheck || await sessionHasAdminRole();
 *
 * Same dual-auth outcome, minimal diff per route, nothing about the existing
 * (already fail-closed, already audited) legacy check changes.
 */
export async function sessionHasAdminRole(): Promise<boolean> {
  const session = await getServerSession(authOptions).catch(() => null);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role === 'admin';
}

/**
 * Sprint 2 hardening — admin action audit trail.
 *
 * Before this, admin mutations (plan changes, sweepstakes draws, gifts,
 * deletions) left no record of WHO performed them beyond scattered
 * console.log lines — fine for debugging, useless for "who ran the June
 * draw" six months later. Wired into the highest-risk endpoints, not all 21
 * admin routes — see docs/ADMIN_AUTH_MIGRATION.md for which and why.
 *
 * Never logs secrets, tokens, or payment credentials — `metadata` is for
 * identifying context (which user, which draw month), not request bodies.
 */

import { prisma } from '@/lib/prisma';
import { requireAdmin, type AdminAuthResult } from '@/lib/adminAuth';

export interface AuditLogInput {
  actorUserId: string;
  action:      string;
  targetType?: string;
  targetId?:   string;
  metadata?:   Record<string, unknown>;
  success:     boolean;
}

/**
 * Record an admin action. Best-effort — a logging failure must never block
 * the underlying admin action itself, so this swallows its own errors.
 */
export async function logAdminAction(input: AuditLogInput): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        id:          crypto.randomUUID(),
        actorUserId: input.actorUserId,
        action:      input.action,
        targetType:  input.targetType ?? null,
        targetId:    input.targetId ?? null,
        metadata:    input.metadata ? (input.metadata as object) : undefined,
        success:     input.success,
        createdAt:   new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[adminAudit] failed to record log entry (action not blocked):', err);
  }
}

/**
 * Convenience: resolve the admin identity AND log the action in one call,
 * for the common case of "this admin mutation must be attributed."
 *
 * `identity` should come from `requireAdmin()`'s result — pass it through
 * rather than calling requireAdmin() twice.
 */
export async function logAdminActionFor(
  identity: AdminAuthResult,
  action: string,
  opts: Omit<AuditLogInput, 'actorUserId' | 'action'>,
): Promise<void> {
  if (!identity.ok) return; // nothing to attribute — caller should already have rejected the request
  await logAdminAction({ actorUserId: identity.userId, action, ...opts });
}

export type { AdminAuthResult };
export { requireAdmin };

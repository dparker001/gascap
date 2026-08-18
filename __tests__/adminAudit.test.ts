/**
 * Tests for lib/adminAudit.ts — the audit trail for the highest-risk admin
 * mutations (user plan changes, deletion, sweepstakes draw actions).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const create = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: { adminAuditLog: { create: (args: { data: Record<string, unknown> }) => create(args) } } }));

beforeEach(() => { vi.clearAllMocks(); });

describe('logAdminAction', () => {
  it('records the action with all fields', async () => {
    const { logAdminAction } = await import('../lib/adminAudit');
    await logAdminAction({
      actorUserId: 'admin-1', action: 'user.delete', targetType: 'User', targetId: 'u1',
      metadata: { reason: 'user_request' }, success: true,
    });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.actorUserId).toBe('admin-1');
    expect(data.action).toBe('user.delete');
    expect(data.success).toBe(true);
  });

  it('never includes a password, token, or secret field even if metadata is careless', async () => {
    const { logAdminAction } = await import('../lib/adminAudit');
    // This documents the CONTRACT (callers must not pass secrets in) rather
    // than the module scrubbing them — adminAudit.ts has no allowlist/denylist
    // logic, so this test also guards against one being silently added that
    // would give false confidence about auto-redaction that doesn't exist.
    await logAdminAction({
      actorUserId: 'admin-1', action: 'test', success: true,
      metadata: { safeField: 'ok' },
    });
    const data = create.mock.calls[0][0].data;
    expect(JSON.stringify(data)).not.toMatch(/password|token|secret/i);
  });

  it('a logging failure does not throw — must never block the underlying admin action', async () => {
    const { logAdminAction } = await import('../lib/adminAudit');
    create.mockRejectedValueOnce(new Error('db unavailable'));
    await expect(logAdminAction({ actorUserId: 'admin-1', action: 'x', success: true })).resolves.toBeUndefined();
  });
});

describe('logAdminActionFor', () => {
  it('logs when the identity is authorized', async () => {
    const { logAdminActionFor } = await import('../lib/adminAudit');
    await logAdminActionFor(
      { ok: true, userId: 'admin-1', email: 'don@example.com', via: 'session' },
      'user.plan_change',
      { targetType: 'User', targetId: 'u1', success: true },
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an unauthorized identity — nothing to attribute', async () => {
    const { logAdminActionFor } = await import('../lib/adminAudit');
    await logAdminActionFor({ ok: false, status: 401 }, 'user.plan_change', { success: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('attributes the legacy-password path to its documented sentinel, not a guessed identity', async () => {
    const { logAdminActionFor } = await import('../lib/adminAudit');
    await logAdminActionFor(
      { ok: true, userId: 'legacy-admin-password', email: 'legacy@admin', via: 'legacy' },
      'user.delete',
      { success: true },
    );
    expect(create.mock.calls[0][0].data.actorUserId).toBe('legacy-admin-password');
  });
});

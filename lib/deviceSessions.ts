/**
 * Device session tracking — a soft anti-abuse signal, not an enforcement
 * mechanism. Records which distinct devices/browsers have touched an
 * account so an unusually high count can be surfaced (to the user as a
 * gentle nudge, to admins for manual review), but nothing here ever blocks
 * a login or evicts a session.
 */
import { prisma } from './prisma';

const ACTIVE_WINDOW_DAYS = 30;

// Non-blocking by design — callers fire this alongside the existing 'visit'
// activity ping and should never let a failure here affect the request.
export async function recordDeviceVisit(
  userId: string,
  deviceId: string,
  platform: 'web' | 'ios' | 'android',
): Promise<void> {
  const now = new Date().toISOString();
  await prisma.deviceSession.upsert({
    where:  { userId_deviceId: { userId, deviceId } },
    update: { lastSeenAt: now, platform },
    create: { id: crypto.randomUUID(), userId, deviceId, platform, firstSeenAt: now, lastSeenAt: now },
  });
}

export async function getActiveDeviceCount(userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return prisma.deviceSession.count({ where: { userId, lastSeenAt: { gte: cutoff } } });
}

// Batched version for the admin users list — one query for every user
// instead of N+1, returning a Map for O(1) lookup while rendering rows.
export async function getActiveDeviceCounts(userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = await prisma.deviceSession.groupBy({
    by:     ['userId'],
    where:  { userId: { in: userIds }, lastSeenAt: { gte: cutoff } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.userId, r._count._all]));
}

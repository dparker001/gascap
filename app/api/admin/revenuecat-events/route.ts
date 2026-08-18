/**
 * GET /api/admin/revenuecat-events
 *
 * Sprint 2 hardening — durable visibility into RevenueCat webhook health,
 * answering the questions docs/SECURITY_AUDIT.md's observability item named:
 * did RevenueCat deliver the event, was it a duplicate, which user did it
 * resolve to, did processing fail, is it stuck.
 *
 * Read-only. Never exposes the raw webhook payload (RevenueCatWebhookEvent
 * doesn't store one) — event type, status, and the resolved user id only.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

export async function GET(req: Request) {
  const identity = await requireAdmin(req);
  if (!identity.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: identity.status });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status'); // optional filter: received|processing|processed|failed
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50));

  const events = await prisma.revenueCatWebhookEvent.findMany({
    where:   status ? { status } : undefined,
    orderBy: { receivedAt: 'desc' },
    take:    limit,
  });

  const counts = await prisma.revenueCatWebhookEvent.groupBy({
    by: ['status'],
    _count: { status: true },
  });

  return NextResponse.json({
    events,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count.status])),
  });
}

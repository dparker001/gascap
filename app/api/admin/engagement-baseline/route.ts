/**
 * GET /api/admin/engagement-baseline
 *
 * Phase 0.5A — the measurement baseline GasCap Daily will be judged against:
 * retention (D1/D3/D7/D14/D30), DAU/WAU, fuel actions, paywall exposure,
 * upgrade clicks, trials currently paid (current entitlement — NOT historical
 * conversion), trial -> purchase event (directional), cancellations where recorded. READ-ONLY and
 * built entirely from existing data (see lib/engagementBaseline.ts for exact
 * definitions). Admin only: session role 'admin' (read from the DB) or the
 * deprecated x-admin-password header — fails closed (503 if unconfigured).
 */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { computeBaseline } from '@/lib/engagementBaseline';
import { loadBaselineInput, loadFuelActions } from '@/lib/engagementBaselineLoader';
import { computeActivation } from '@/lib/activationMetrics';

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? 'Misconfigured' : auth.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: auth.status },
    );
  }

  try {
    const now = new Date();
    const input = await loadBaselineInput(now);
    const report = computeBaseline(input);

    // P1-A: Phase 1 activation metrics ride along as a separate `activation`
    // key. The Phase 0.5 report above is unchanged, and an activation failure
    // must never take the baseline down with it.
    let activation: ReturnType<typeof computeActivation> | null = null;
    try {
      const fuel = await loadFuelActions();
      activation = computeActivation({
        now,
        users: input.users.map((u) => ({ id: u.id, createdAt: u.createdAt })),
        fuelActions: fuel.records,
        vehicleUserIds: input.vehicleUserIds,
        truncated: !!input.truncated || fuel.truncated,
      });
    } catch (err) {
      console.error('[engagement-baseline] activation failed:', err instanceof Error ? err.message : err);
    }

    return NextResponse.json({ ...report, activation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[engagement-baseline] failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to compute baseline' }, { status: 500 });
  }
}

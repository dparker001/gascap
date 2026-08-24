/**
 * GET /api/cron/integrity-check — new 'getaway-stale-pending' finding
 * (2026-08-24). Marketing Boost has no idempotency key or lookup/status
 * endpoint, so a getaway fulfillment stuck 'pending' for over an hour must
 * be surfaced for manual investigation, never auto-resent or auto-mutated.
 * See app/api/getaway/choose/route.ts's header comment and
 * docs/reviews/2026-08-24-getaway-fulfillment-idempotency.md.
 *
 * This test isolates just the new finding — it stubs out this route's
 * other checks (AMOE file health, upstream price probes, draw history) so
 * the route can run end-to-end without a real filesystem/network/DB, since
 * no test file previously existed for this route at all.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

let stalePendingRows: { email: string; getawayDestinationId: string | null; getawayDestinationChosenAt: string | null }[] = [];

const findMany = vi.fn(async (args: { where?: Record<string, unknown> }) => {
  if (args?.where?.getawayFulfillmentStatus === 'pending') return stalePendingRows;
  return []; // lifetime-holding-subscription-artifacts query, etc.
});
const count = vi.fn(async () => 0);
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: (a: { where?: Record<string, unknown> }) => findMany(a), count: () => count() } } }));

vi.mock('fs', () => ({
  default: { accessSync: vi.fn() },
  accessSync: vi.fn(),
}));
vi.mock('@/lib/amoeEntries', () => ({
  readAmoeEntries: () => [],
  AMOE_DATA_FILE: '/tmp/fake-amoe.json',
}));
vi.mock('@/lib/email', () => ({ sendMail: vi.fn(async () => ({})) }));
vi.mock('@/lib/giveaway', () => ({
  getDrawHistory: async () => [],
  prevMonth: () => '2026-07',
  currentPeriod: () => '2026-08',
}));

const sendVacationIncentive = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/marketingBoost', () => ({ sendVacationIncentive: (...a: unknown[]) => sendVacationIncentive(...(a as [])) }));

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  stalePendingRows = [];
  process.env.CRON_SECRET = 'test-secret';
  process.env.GIVEAWAY_PAUSED = 'true'; // avoid the missing-draw finding noise
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ price: 3.5 }), { status: 200 })) as unknown as typeof fetch;
});

afterAll(() => { global.fetch = originalFetch; });

async function callDryRun() {
  const { GET } = await import('@/app/api/cron/integrity-check/route');
  const req = new Request('https://www.gascap.app/api/cron/integrity-check?secret=test-secret&dryRun=true');
  return GET(req);
}

describe('GET /api/cron/integrity-check — getaway-stale-pending finding', () => {
  it('flags a getaway stuck pending for over an hour, without calling Marketing Boost or mutating anything', async () => {
    stalePendingRows = [{ email: 'stuck@example.com', getawayDestinationId: 'orlando', getawayDestinationChosenAt: '2026-08-24T00:00:00.000Z' }];
    const res = await callDryRun();
    const json = await res.json() as { findings: { id: string; count: number }[] };
    const finding = json.findings.find((f) => f.id === 'getaway-stale-pending');
    expect(finding).toBeTruthy();
    expect(finding?.count).toBe(1);
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('reports zero when no getaway is stuck pending', async () => {
    stalePendingRows = [];
    const res = await callDryRun();
    const json = await res.json() as { findings: { id: string }[] };
    expect(json.findings.find((f) => f.id === 'getaway-stale-pending')).toBeUndefined();
  });

  it('the underlying query only ever reads (findMany) — no update/write call exists in this check', async () => {
    stalePendingRows = [{ email: 'stuck@example.com', getawayDestinationId: 'orlando', getawayDestinationChosenAt: '2026-08-24T00:00:00.000Z' }];
    await callDryRun();
    expect(findMany).toHaveBeenCalled();
    // This route's prisma mock exposes no `update`/`updateMany` at all —
    // if the route ever called one, this test would throw as the mock
    // object has no such method, which is itself the assertion.
  });
});

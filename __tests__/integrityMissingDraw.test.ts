/**
 * WS-1: the integrity check's 'missing-draw' finding keys on the latest Entry
 * Month whose ET deadline has passed, and stays silent during the 72 hours
 * after the close when the draw is legitimately still pending — it must never
 * fire on expected state (CLAUDE.md: a permanent false alarm trains everyone
 * to ignore the real one). Other checks are stubbed as in
 * integrityCheckGetawayStalePending.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

let draws: { month: string }[] = [];
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: async () => [], count: async () => 0 } } }));
vi.mock('fs', () => ({ default: { accessSync: vi.fn() }, accessSync: vi.fn() }));
vi.mock('@/lib/amoeEntries', () => ({ readAmoeEntries: () => [], AMOE_DATA_FILE: '/tmp/fake-amoe.json' }));
vi.mock('@/lib/email', () => ({ sendMail: vi.fn(async () => ({})) }));
vi.mock('@/lib/rentalIntegrity', () => ({ findOrphanRentalFillups: vi.fn(async () => []) }));
vi.mock('@/lib/giveaway', () => ({ getDrawHistory: async () => draws }));
vi.mock('@/lib/marketingBoost', () => ({ sendVacationIncentive: vi.fn(async () => ({ ok: true })) }));

const originalFetch = global.fetch;

beforeEach(() => {
  draws = [];
  process.env.CRON_SECRET = 'test-secret';
  delete process.env.GIVEAWAY_PAUSED;
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ price: 3.5 }), { status: 200 })) as unknown as typeof fetch;
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());
afterAll(() => { global.fetch = originalFetch; });

async function missingDraw() {
  const { GET } = await import('@/app/api/cron/integrity-check/route');
  const res = await GET(new Request('https://www.gascap.app/api/cron/integrity-check?secret=test-secret&dryRun=true'));
  const json = await res.json() as { findings: { id: string; count: number; label?: string; title?: string }[] };
  return json.findings.find((f) => f.id === 'missing-draw');
}

describe("integrity 'missing-draw' (ET close + 72h grace)", () => {
  it('silent in the 72h after the October close (draw pending, expected state)', async () => {
    vi.setSystemTime(new Date('2026-11-01T11:00:00Z')); // 7 AM EDT Nov 1 — the daily sweep
    expect((await missingDraw())?.count ?? 0).toBe(0);
  });
  it('flags October once the window has passed with no October draw', async () => {
    vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    draws = [{ month: '2026-09' }];
    const f = await missingDraw();
    expect(f?.count).toBe(1);
    expect(JSON.stringify(f)).toContain('2026-10');
  });
  it('silent when October is drawn', async () => {
    vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    draws = [{ month: '2026-10' }];
    expect((await missingDraw())?.count ?? 0).toBe(0);
  });
  it('uses the ET month, not UTC: Oct 31 9 PM EDT still checks September', async () => {
    vi.setSystemTime(new Date('2026-11-01T01:00:00Z')); // UTC already November
    draws = [{ month: '2026-09' }];
    expect((await missingDraw())?.count ?? 0).toBe(0);
  });
  it('GIVEAWAY_PAUSED=true still silences it (unchanged semantics)', async () => {
    vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    process.env.GIVEAWAY_PAUSED = 'true';
    expect((await missingDraw())?.count ?? 0).toBe(0);
  });
});

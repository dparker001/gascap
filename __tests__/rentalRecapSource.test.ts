/**
 * Rental recap source (2026-10-02, ChatGPT review round 1).
 *
 * Phase 3A (2026-08-25) made rental Fillup rows canonical; refuelLogs is
 * frozen legacy data and EMPTY for every post-cutover rental. Recaps built
 * from refuelLogs therefore showed no gallons / $0 / no savings for any new
 * rental. Rule: canonical Fillup rows when present, legacy refuelLogs only
 * for a pre-cutover rental — never a mix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { rentalRecap, rentalRecapLogs } from '@/lib/rentalCalculations';

const POST_CUTOVER_FILLUPS = [
  { gallonsPumped: 8, totalCost: 28.0, pricePerGallon: 3.5 },
  { gallonsPumped: 4, totalCost: 14.0, pricePerGallon: 3.5 },
];
const LEGACY_LOGS = [{ gallons: 10, totalPaid: 30 }];

describe('rentalRecapLogs', () => {
  it('uses canonical Fillup rows when any exist (post-cutover rental)', () => {
    const recap = rentalRecap(rentalRecapLogs(POST_CUTOVER_FILLUPS, []), 9.99);
    expect(recap.totalGallons).toBe(12);
    expect(recap.totalPaid).toBe(42);
    expect(recap.savings).toBeCloseTo(12 * 9.99 - 42, 2);
  });

  it('the old refuelLogs-only recap reads empty for that same rental — the bug being fixed', () => {
    const recap = rentalRecap([], 9.99);           // session.refuelLogs is [] post-cutover
    expect(recap.totalGallons).toBe(0);
    expect(recap.savings).toBeNull();
  });

  it('falls back to legacy refuelLogs only when there are no Fillup rows (pre-cutover rental)', () => {
    expect(rentalRecapLogs([], LEGACY_LOGS)).toEqual(LEGACY_LOGS);
  });

  it('never mixes the two sources when both exist', () => {
    const logs = rentalRecapLogs(POST_CUTOVER_FILLUPS, LEGACY_LOGS);
    expect(logs).toHaveLength(2);
    expect(rentalRecap(logs, null).totalGallons).toBe(12);
  });
});

// ── GET /api/rental-sessions?status=completed batches Fillup rows ────────────
const fillupFindMany = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/featureFlags', () => ({ RENTAL_RETURN_ASSISTANT_ENABLED: true }));
vi.mock('@/lib/serverPlan', () => ({ getLivePlan: vi.fn(async () => ({ isPro: true })) }));
vi.mock('@/lib/rentalSessions', () => ({
  getRentalSessionsForUser: vi.fn(async () => [{ id: 'rs-a' }, { id: 'rs-b' }]),
  createRentalSession: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { fillup: { findMany: (a: unknown) => fillupFindMany(a) } } }));

beforeEach(() => { fillupFindMany.mockReset(); });

async function list(status?: string) {
  const { GET } = await import('@/app/api/rental-sessions/route');
  return (await GET(new NextRequest(`https://www.gascap.app/api/rental-sessions${status ? `?status=${status}` : ''}`))).json();
}

describe('GET /api/rental-sessions — history recap data', () => {
  it('completed: ONE batched Fillup query for all listed sessions, grouped by session', async () => {
    fillupFindMany.mockResolvedValue([
      { rentalSessionId: 'rs-a', gallonsPumped: 8, totalCost: 28, pricePerGallon: 3.5 },
      { rentalSessionId: 'rs-a', gallonsPumped: 4, totalCost: 14, pricePerGallon: 3.5 },
    ]);
    const body = await list('completed');
    expect(fillupFindMany).toHaveBeenCalledTimes(1);
    expect(fillupFindMany.mock.calls[0][0]).toMatchObject({ where: { rentalSessionId: { in: ['rs-a', 'rs-b'] } } });
    expect(body.fillupsBySession['rs-a']).toHaveLength(2);
    expect(body.fillupsBySession['rs-b']).toBeUndefined();
  });

  it('other statuses: no Fillup query, response shape unchanged', async () => {
    const body = await list('active');
    expect(fillupFindMany).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('fillupsBySession');
  });
});

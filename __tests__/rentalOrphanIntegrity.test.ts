/**
 * READ-ONLY orphan rental Fillup detection (2026-10-03): pure helpers, the
 * query shape (no writes), and the integrity-check wiring scoped to Fillups
 * created since the delete fix so the historical backlog never re-alarms.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const findManyFillup = vi.fn();
const findManyRental = vi.fn();
const writes = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    fillup: { findMany: (a: unknown) => findManyFillup(a), deleteMany: writes, update: writes, updateMany: writes },
    rentalSession: { findMany: (a: unknown) => findManyRental(a), deleteMany: writes },
  },
}));

const row = (id: string, userId: string, rentalSessionId: string | null, fillupType: string | null, gallonsPumped: number, totalCost: number, date: string) =>
  ({ id, userId, rentalSessionId, fillupType, gallonsPumped, totalCost, date, createdAt: `${date}T12:00:00.000Z` });

beforeEach(() => { findManyFillup.mockReset(); findManyRental.mockReset(); writes.mockReset(); });

describe('pure helpers', () => {
  it('orphanRentalFillups keeps only rental-linked rows whose rental is missing', async () => {
    const { orphanRentalFillups } = await import('@/lib/rentalIntegrity');
    const rows = [row('a', 'u1', 'rs-live', 'trip', 1, 3, '2026-09-01'), row('b', 'u1', 'rs-gone', 'trip', 2, 6, '2026-09-02'), row('c', 'u1', null, null, 3, 9, '2026-09-03')];
    expect(orphanRentalFillups(rows, ['rs-live']).map((r) => r.id)).toEqual(['b']);
  });
  it('summarizeOrphans is aggregate-only (no ids/users leak) and counts by type', async () => {
    const { summarizeOrphans } = await import('@/lib/rentalIntegrity');
    const s = summarizeOrphans([
      row('a', 'u1', 'x', 'trip', 2, 6, '2026-08-30'), row('b', 'u1', 'x', 'final_return', 10, 30.004, '2026-09-02'), row('c', 'u2', 'y', null, 1.5, 4.5, '2026-08-27'),
    ]);
    expect(s).toEqual({ orphanCount: 3, affectedUsers: 2, oldestDate: '2026-08-27', newestDate: '2026-09-02',
      byType: { trip: 1, final_return: 1, other: 1 }, totalGallons: 13.5, totalCost: 40.5 });
    expect(JSON.stringify(s)).not.toMatch(/u1|u2|"a"|"b"/);
    expect(summarizeOrphans([])).toMatchObject({ orphanCount: 0, oldestDate: null, newestDate: null });
  });
});

describe('findOrphanRentalFillups — read-only query', () => {
  it('selects linked Fillups (optionally since a date), checks which rentals exist, never writes', async () => {
    findManyFillup.mockResolvedValue([row('a', 'u1', 'rs-live', 'trip', 1, 3, '2026-10-03'), row('b', 'u2', 'rs-gone', 'trip', 2, 6, '2026-10-03')]);
    findManyRental.mockResolvedValue([{ id: 'rs-live' }]);
    const { findOrphanRentalFillups } = await import('@/lib/rentalIntegrity');
    const out = await findOrphanRentalFillups({ createdSince: '2026-10-03T00:00:00.000Z' });
    expect(out.map((r) => r.id)).toEqual(['b']);
    expect(findManyFillup.mock.calls[0][0].where).toEqual({ rentalSessionId: { not: null }, createdAt: { gte: '2026-10-03T00:00:00.000Z' } });
    expect(findManyRental.mock.calls[0][0]).toEqual({ where: { id: { in: ['rs-live', 'rs-gone'] } }, select: { id: true } });
    expect(writes).not.toHaveBeenCalled();
  });
  it('no linked Fillups → no rental query', async () => {
    findManyFillup.mockResolvedValue([]);
    const { findOrphanRentalFillups } = await import('@/lib/rentalIntegrity');
    expect(await findOrphanRentalFillups()).toEqual([]);
    expect(findManyRental).not.toHaveBeenCalled();
  });
});

describe('integrity-check wiring', () => {
  it('flags orphans created since the fix date only (historical backlog stays quiet), as an error, sample = fillup ids', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/api/cron/integrity-check/route.ts'), 'utf8');
    expect(src).toContain('findOrphanRentalFillups({ createdSince: ORPHAN_CHECK_SINCE })');
    expect(src).toContain("'orphan-rental-fillups'");
  });
});

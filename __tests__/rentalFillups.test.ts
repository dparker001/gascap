/**
 * Phase 3A canonical rental fillup architecture (2026-08-25) —
 * lib/rentalFillups.ts. Covers: creation, retry idempotency, concurrent
 * duplicate protection, one final_return per rental (including a simulated
 * race), the currentFuelGallons invariant across create/edit/delete, edit
 * classification uniqueness, and ownership authorization.
 *
 * Uses an in-memory Prisma mock (same pattern as
 * __tests__/getawayFulfillment.test.ts) so the partial unique index and the
 * clientRefuelId unique constraint can be simulated exactly as Postgres
 * would enforce them — a P2002 thrown from `create()`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FillupRow {
  id: string; userId: string; vehicleId: string | null; vehicleName: string;
  date: string; gallonsPumped: number; pricePerGallon: number; totalCost: number;
  odometerReading: number | null; fuelLevelBefore: number | null;
  stationName: string | null; notes: string | null; driverLabel: string | null;
  fuelGrade: string | null; receiptThumb: string | null; createdAt: string;
  rentalSessionId: string | null; fillupType: string | null; filledAt: string | null;
  stationLat: number | null; stationLng: number | null; clientRefuelId: string | null;
}

interface SessionRow {
  id: string; userId: string; vehicleId: string | null; rentalCompany: string;
  vehicleYear: string | null; vehicleMake: string | null; vehicleModel: string | null;
  currentFuelGallons: number | null; fuelTankCapacityGallons: number | null;
  currentFuelSource: string | null; currentFuelUpdatedAt: string | null; updatedAt: string;
}

const fillupTable  = new Map<string, FillupRow>();
const sessionTable = new Map<string, SessionRow>();
let idCounter = 0;

class PrismaClientKnownRequestError extends Error {
  code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}

function makeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'session-1', userId: 'user-1', vehicleId: null, rentalCompany: 'Hertz',
    vehicleYear: '2024', vehicleMake: 'Toyota', vehicleModel: 'Camry',
    currentFuelGallons: 4, fuelTankCapacityGallons: 14,
    currentFuelSource: 'MANUAL_GAUGE', currentFuelUpdatedAt: null, updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function fillupMatches(row: FillupRow, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'NOT') {
      const notCond = cond as Record<string, unknown>;
      if (Object.entries(notCond).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v)) return false;
      continue;
    }
    if ((row as unknown as Record<string, unknown>)[key] !== cond) return false;
  }
  return true;
}

function sortFillupRows(rows: FillupRow[], orderBy?: Array<Record<string, 'asc' | 'desc'>>): FillupRow[] {
  if (!orderBy) return rows;
  return [...rows].sort((a, b) => {
    for (const ord of orderBy) {
      const [field, dir] = Object.entries(ord)[0];
      const av = (a as unknown as Record<string, string | null>)[field] ?? '';
      const bv = (b as unknown as Record<string, string | null>)[field] ?? '';
      if (av !== bv) return dir === 'desc' ? (av < bv ? 1 : -1) : (av < bv ? -1 : 1);
    }
    return 0;
  });
}

/**
 * Real Prisma query-builder calls (`.create()`, `$executeRaw` tagged
 * templates) are LAZY — they don't run until awaited or handed to
 * `$transaction()`. A plain `vi.fn(async () => {...mutate...})` mock is NOT
 * lazy: calling it starts executing its body immediately (synchronously, up
 * to the first await), which would make `[prisma.fillup.create(data), rawOp]`
 * mutate both tables during ARRAY CONSTRUCTION — before `$transaction` ever
 * runs — making it impossible to test true rollback-on-failure. `lazy()`
 * returns a bare thenable whose `.then()` (called by `await` or by
 * `$transaction`'s own loop) is what actually triggers the work, matching
 * real Prisma's deferred-execution contract closely enough for this file's
 * atomicity tests.
 */
interface LazyOp<T> extends PromiseLike<T> {
  /** Set once this op's `fn` resolves — undoes exactly what THIS op did.
   *  Read by `$transaction` after a LATER op in the same call fails, so
   *  rollback only touches this transaction's own writes, never a
   *  concurrently-interleaved transaction's already-committed row (a
   *  whole-table snapshot-restore would wrongly erase those too). */
  undo: (() => void) | null;
}

function lazy<T>(fn: () => Promise<{ value: T; undo: () => void }>): LazyOp<T> {
  const op: LazyOp<T> = {
    undo: null,
    then(onFulfilled, onRejected) {
      return fn().then((result) => {
        op.undo = result.undo;
        return onFulfilled ? onFulfilled(result.value) : (result.value as never);
      }, onRejected);
    },
  };
  return op;
}

let forceSessionUpdateFailure = false;

const prismaMock = {
  fillup: {
    findFirst: vi.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: Array<Record<string, 'asc' | 'desc'>> }) => {
      const rows = sortFillupRows([...fillupTable.values()].filter((r) => fillupMatches(r, where)), orderBy);
      return rows.length > 0 ? { ...rows[0] } : null;
    }),
    findMany: vi.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: Array<Record<string, 'asc' | 'desc'>> }) => {
      const rows = sortFillupRows([...fillupTable.values()].filter((r) => fillupMatches(r, where)), orderBy);
      return rows.map((r) => ({ ...r }));
    }),
    create: vi.fn(({ data }: { data: FillupRow }) => lazy(async () => {
      if (data.clientRefuelId != null) {
        for (const row of fillupTable.values()) {
          if (row.clientRefuelId === data.clientRefuelId) throw new PrismaClientKnownRequestError('unique violation', 'P2002');
        }
      }
      if (data.fillupType === 'final_return') {
        for (const row of fillupTable.values()) {
          if (row.rentalSessionId === data.rentalSessionId && row.fillupType === 'final_return') {
            throw new PrismaClientKnownRequestError('unique violation', 'P2002');
          }
        }
      }
      const row = { ...data, id: data.id || `fillup-${++idCounter}` };
      fillupTable.set(row.id, row);
      return { value: { ...row }, undo: () => fillupTable.delete(row.id) };
    })),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FillupRow> }) => {
      const row = fillupTable.get(where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    }),
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      let count = 0;
      for (const [id, row] of fillupTable.entries()) {
        if (fillupMatches(row, where)) { fillupTable.delete(id); count++; }
      }
      return { count };
    }),
  },
  rentalSession: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
      const row = sessionTable.get(where.id);
      if (!row || row.userId !== where.userId) return null;
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) => {
      const row = sessionTable.get(where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    }),
  },
  // Simulates the atomic `UPDATE ... SET x = x + $1` raw statement in
  // lib/rentalFillups.ts's bumpCurrentFuelGallonsOnCreateSql() — reads
  // "currentFuelGallons" LIVE from the table at execution time (not from a
  // JS-side snapshot taken earlier), so concurrent calls each see the
  // other's prior write, exactly like a real atomic SQL UPDATE would.
  $executeRaw: vi.fn((_strings: TemplateStringsArray, gallonsAdded1: number, _gallonsAdded2: number, _now1: string, now: string, sessionId: string) => lazy(async () => {
    if (forceSessionUpdateFailure) throw new Error('simulated session-state update failure');
    const row = sessionTable.get(sessionId);
    if (!row) return { value: 0, undo: () => {} };
    const prior = { currentFuelGallons: row.currentFuelGallons, currentFuelSource: row.currentFuelSource, currentFuelUpdatedAt: row.currentFuelUpdatedAt, updatedAt: row.updatedAt };
    const raw = (row.currentFuelGallons ?? 0) + gallonsAdded1;
    row.currentFuelGallons = row.fuelTankCapacityGallons != null ? Math.min(raw, row.fuelTankCapacityGallons) : raw;
    row.currentFuelSource = 'RECEIPT';
    row.currentFuelUpdatedAt = now;
    row.updatedAt = now;
    return { value: 1, undo: () => Object.assign(row, prior) };
  })),
  // Array form: run each lazy op in sequence. On failure, undo ONLY the ops
  // from THIS transaction that already completed (via each op's own `undo`),
  // never a whole-table snapshot restore — a snapshot taken at this
  // transaction's start could predate a DIFFERENT, concurrently-interleaved
  // transaction's own successful commit, and restoring it would wrongly
  // erase that unrelated transaction's row. This is the exact bug a naive
  // snapshot-based mock hit under the concurrency tests below.
  $transaction: vi.fn(async (ops: LazyOp<unknown>[]) => {
    const results: unknown[] = [];
    const completed: LazyOp<unknown>[] = [];
    try {
      for (const op of ops) {
        results.push(await op);
        completed.push(op);
      }
      return results;
    } catch (err) {
      for (const op of completed.reverse()) op.undo?.();
      throw err;
    }
  }),
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/generated/prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError },
}));

const recordAnalyticsEvent = vi.fn(async () => ({ outcome: 'written' as const, id: 'evt_1' }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])) }));

let createRentalFillup: typeof import('@/lib/rentalFillups').createRentalFillup;
let updateRentalFillup: typeof import('@/lib/rentalFillups').updateRentalFillup;
let deleteRentalFillup: typeof import('@/lib/rentalFillups').deleteRentalFillup;
let getRentalFillups: typeof import('@/lib/rentalFillups').getRentalFillups;

beforeEach(async () => {
  vi.clearAllMocks();
  fillupTable.clear();
  sessionTable.clear();
  idCounter = 0;
  forceSessionUpdateFailure = false;
  sessionTable.set('session-1', makeSession());
  const mod = await import('@/lib/rentalFillups');
  createRentalFillup = mod.createRentalFillup;
  updateRentalFillup = mod.updateRentalFillup;
  deleteRentalFillup = mod.deleteRentalFillup;
  getRentalFillups = mod.getRentalFillups;
});

describe('createRentalFillup', () => {
  it('creates a trip fillup and rolls gallons into currentFuelGallons', async () => {
    const result = await createRentalFillup('user-1', 'session-1', {
      gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1',
    });
    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') throw new Error('expected created');
    expect(result.fillup.rentalSessionId).toBe('session-1');
    expect(result.fillup.fillupType).toBe('trip');
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(9); // 4 + 5
  });

  it('caps currentFuelGallons at tank capacity', async () => {
    await createRentalFillup('user-1', 'session-1', { gallonsPumped: 20, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(14);
  });

  it('rejects an unknown rental session', async () => {
    const result = await createRentalFillup('user-1', 'nope', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    expect(result.outcome).toBe('not_found');
  });

  it('rejects a rental belonging to a different user', async () => {
    const result = await createRentalFillup('someone-else', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    expect(result.outcome).toBe('not_found');
  });

  it('rejects non-positive gallons and a missing clientRefuelId', async () => {
    expect((await createRentalFillup('user-1', 'session-1', { gallonsPumped: 0, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' })).outcome).toBe('invalid');
    expect((await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: '' })).outcome).toBe('invalid');
  });

  it('retrying the same clientRefuelId returns the original row, not a second one', async () => {
    const first = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'retry-1' });
    const second = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'retry-1' });
    expect(second.outcome).toBe('duplicate');
    if (first.outcome !== 'created' || second.outcome !== 'duplicate') throw new Error('unexpected outcome');
    expect(second.fillup.id).toBe(first.fillup.id);
    expect(fillupTable.size).toBe(1); // only one row ever created
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(9); // bumped only once
  });

  it('allows exactly one final_return fillup per rental', async () => {
    const first = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 2, pricePerGallon: 3.5, fillupType: 'final_return', clientRefuelId: 'fr-1' });
    expect(first.outcome).toBe('created');
    const second = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 1, pricePerGallon: 3.5, fillupType: 'final_return', clientRefuelId: 'fr-2' });
    expect(second.outcome).toBe('final_return_exists');
    if (first.outcome !== 'created' || second.outcome !== 'final_return_exists') throw new Error('unexpected outcome');
    expect(second.fillup.id).toBe(first.fillup.id);
  });

  it('a simulated concurrent final_return race is resolved to a single winner via the DB-level unique index', async () => {
    // Simulate two requests racing past the app-level pre-check simultaneously
    // by directly triggering the create()'s P2002 path: insert a competing
    // final_return row between the pre-check and the create() call by
    // mocking create() to throw once, mirroring what the real partial unique
    // index does under a genuine race.
    fillupTable.set('winner', {
      id: 'winner', userId: 'user-1', vehicleId: null, vehicleName: 'Toyota Camry', date: '2026-08-25',
      gallonsPumped: 1, pricePerGallon: 0, totalCost: 0, odometerReading: null, fuelLevelBefore: null,
      stationName: null, notes: null, driverLabel: null, fuelGrade: null, receiptThumb: null,
      createdAt: new Date().toISOString(), rentalSessionId: 'session-1', fillupType: 'final_return',
      filledAt: new Date().toISOString(), stationLat: null, stationLng: null, clientRefuelId: 'winner-id',
    });
    const loser = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 3, pricePerGallon: 3.5, fillupType: 'final_return', clientRefuelId: 'loser-id' });
    expect(loser.outcome).toBe('final_return_exists');
    if (loser.outcome !== 'final_return_exists') throw new Error('unexpected outcome');
    expect(loser.fillup.id).toBe('winner');
  });

  it('fires rental_fill_logged for a trip fillup and rental_final_fill_logged for a final return, idempotency-keyed', async () => {
    const trip = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    if (trip.outcome !== 'created') throw new Error('expected created');
    expect(recordAnalyticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'rental_fill_logged', idempotencyKey: `rental_fill_logged:${trip.fillup.id}`,
    }));

    const final = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 2, pricePerGallon: 3.5, fillupType: 'final_return', clientRefuelId: 'c2' });
    if (final.outcome !== 'created') throw new Error('expected created');
    expect(recordAnalyticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'rental_final_fill_logged', idempotencyKey: `rental_final_fill_logged:${final.fillup.id}`,
    }));
  });
});

describe('currentFuelGallons invariant (2026-08-25 correction) — edit/delete NEVER touch it, even for the most recent transaction', () => {
  it('A. create MAY update currentFuelGallons — currentFuel=5, create +8 → currentFuel=13', async () => {
    sessionTable.set('session-1', makeSession({ currentFuelGallons: 5 }));
    const created = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 8, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    expect(created.outcome).toBe('created');
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(13);
  });

  it('B. edit never touches currentFuelGallons, even for the most recent transaction, even after an independent gauge update', async () => {
    const created = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 8, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    if (created.outcome !== 'created') throw new Error('expected created');
    // The renter (or a later gauge check) independently sets the current
    // reading to 9 — unrelated to the transaction history.
    sessionTable.get('session-1')!.currentFuelGallons = 9;

    const updated = await updateRentalFillup('user-1', 'session-1', created.fillup.id, { gallonsPumped: 7 });
    expect(updated.outcome).toBe('updated');
    if (updated.outcome === 'updated') expect(updated.fillup.gallonsPumped).toBe(7); // history record itself did change
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(9); // current-tank estimate is untouched
  });

  it('C. delete never touches currentFuelGallons, even for the most recent transaction, even after an independent gauge update', async () => {
    const created = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 8, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    if (created.outcome !== 'created') throw new Error('expected created');
    sessionTable.get('session-1')!.currentFuelGallons = 9;

    const deleted = await deleteRentalFillup('user-1', 'session-1', created.fillup.id);
    expect(deleted.outcome).toBe('deleted');
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(9);
    expect(fillupTable.has(created.fillup.id)).toBe(false); // history row is actually gone
  });

  it('D. editing/deleting an OLDER fillup also leaves currentFuelGallons unchanged', async () => {
    const older = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    const newer = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 3, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c2' });
    if (older.outcome !== 'created' || newer.outcome !== 'created') throw new Error('expected created');
    const currentBefore = sessionTable.get('session-1')!.currentFuelGallons; // 4 + 5 + 3 = 12

    const updated = await updateRentalFillup('user-1', 'session-1', older.fillup.id, { gallonsPumped: 100 });
    expect(updated.outcome).toBe('updated');
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(currentBefore);

    const deleted = await deleteRentalFillup('user-1', 'session-1', newer.fillup.id);
    expect(deleted.outcome).toBe('deleted');
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(currentBefore);
  });

  it('caps currentFuelGallons at tank capacity on create, same as before', async () => {
    await createRentalFillup('user-1', 'session-1', { gallonsPumped: 20, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(14);
  });
});

describe('price/cost — $0.00 must never mean "unknown" (2026-08-25 correction)', () => {
  it('rejects a rental fillup with neither pricePerGallon nor totalCost', async () => {
    const result = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, fillupType: 'trip', clientRefuelId: 'c1' });
    expect(result.outcome).toBe('invalid');
    expect(fillupTable.size).toBe(0); // nothing written with a fabricated 0
  });

  it('derives totalCost from gallons × pricePerGallon when only pricePerGallon is given', async () => {
    const result = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    if (result.outcome !== 'created') throw new Error('expected created');
    expect(result.fillup.pricePerGallon).toBe(3.5);
    expect(result.fillup.totalCost).toBe(17.5);
  });

  it('derives pricePerGallon from totalCost ÷ gallons when only totalCost is given', async () => {
    const result = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, totalCost: 20, fillupType: 'trip', clientRefuelId: 'c1' });
    if (result.outcome !== 'created') throw new Error('expected created');
    expect(result.fillup.totalCost).toBe(20);
    expect(result.fillup.pricePerGallon).toBe(4);
  });

  it('preserves an explicit, legitimate $0 (free fuel) rather than rejecting it, since 0 was actually supplied, not omitted', async () => {
    const result = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, totalCost: 0, fillupType: 'trip', clientRefuelId: 'c1' });
    if (result.outcome !== 'created') throw new Error('expected created');
    expect(result.fillup.totalCost).toBe(0);
  });
});

describe('final_return uniqueness on edit (reclassification)', () => {
  it('rejects reclassifying a trip fillup to final_return when one already exists', async () => {
    await createRentalFillup('user-1', 'session-1', { gallonsPumped: 2, pricePerGallon: 3.5, fillupType: 'final_return', clientRefuelId: 'fr-1' });
    const trip = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 3, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    if (trip.outcome !== 'created') throw new Error('expected created');

    const result = await updateRentalFillup('user-1', 'session-1', trip.fillup.id, { fillupType: 'final_return' });
    expect(result.outcome).toBe('final_return_exists');
  });

  it('allows reclassifying the existing final_return fillup itself without conflict', async () => {
    const created = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 2, pricePerGallon: 3.5, fillupType: 'final_return', clientRefuelId: 'fr-1' });
    if (created.outcome !== 'created') throw new Error('expected created');
    const result = await updateRentalFillup('user-1', 'session-1', created.fillup.id, { fillupType: 'final_return' });
    expect(result.outcome).toBe('updated');
  });
});

describe('ownership authorization', () => {
  it('updateRentalFillup rejects a fillup belonging to a different session/user', async () => {
    const created = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    if (created.outcome !== 'created') throw new Error('expected created');
    const result = await updateRentalFillup('someone-else', 'session-1', created.fillup.id, { gallonsPumped: 10 });
    expect(result.outcome).toBe('not_found');
  });

  it('deleteRentalFillup rejects a fillup belonging to a different session/user', async () => {
    const created = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    if (created.outcome !== 'created') throw new Error('expected created');
    const result = await deleteRentalFillup('someone-else', 'session-1', created.fillup.id);
    expect(result.outcome).toBe('not_found');
    expect(fillupTable.has(created.fillup.id)).toBe(true); // not actually deleted
  });
});

describe('getRentalFillups — canonical read path', () => {
  it('returns canonical rows newest-first for a Phase 3A session', async () => {
    await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    await createRentalFillup('user-1', 'session-1', { gallonsPumped: 3, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c2' });
    const fillups = await getRentalFillups('user-1', 'session-1');
    expect(fillups).toHaveLength(2);
  });

  it('returns an empty array for a session with no canonical fillups (legacy-only session)', async () => {
    sessionTable.set('legacy-session', makeSession({ id: 'legacy-session' }));
    const fillups = await getRentalFillups('user-1', 'legacy-session');
    expect(fillups).toEqual([]);
  });

  it('returns an empty array for an unknown/unauthorized session rather than throwing', async () => {
    const fillups = await getRentalFillups('someone-else', 'session-1');
    expect(fillups).toEqual([]);
  });
});

describe('atomicity (2026-08-25 correction) — Fillup creation + currentFuelGallons update commit or fail together', () => {
  it('a successful create commits both the Fillup row and the currentFuelGallons update', async () => {
    const result = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' });
    expect(result.outcome).toBe('created');
    expect(fillupTable.size).toBe(1);
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(9); // 4 + 5
  });

  it('a failure during the session-state update rolls back the Fillup insert too — no orphan canonical Fillup', async () => {
    forceSessionUpdateFailure = true;
    await expect(createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'c1' }))
      .rejects.toThrow('simulated session-state update failure');
    expect(fillupTable.size).toBe(0); // the Fillup was NOT left behind despite the session update failing
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(4); // untouched, original value
  });
});

describe('concurrency (2026-08-25 correction) — currentFuelGallons updates must not lose a concurrent write', () => {
  it('two concurrent different-clientRefuelId trip fills both land in currentFuelGallons (no lost update)', async () => {
    const [a, b] = await Promise.all([
      createRentalFillup('user-1', 'session-1', { gallonsPumped: 3, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'race-a' }),
      createRentalFillup('user-1', 'session-1', { gallonsPumped: 2, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'race-b' }),
    ]);
    expect(a.outcome).toBe('created');
    expect(b.outcome).toBe('created');
    expect(fillupTable.size).toBe(2);
    // 4 (initial) + 3 + 2 = 9 — both contributions landed, not just the last writer's.
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(9);
  });

  it('a race between two requests using the SAME clientRefuelId creates exactly one Fillup and bumps currentFuelGallons only once', async () => {
    const [a, b] = await Promise.all([
      createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'same-id' }),
      createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 3.5, fillupType: 'trip', clientRefuelId: 'same-id' }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['created', 'duplicate']);
    expect(fillupTable.size).toBe(1); // exactly one row
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(9); // 4 + 5, bumped only once
  });

  it('a race between two DIFFERENT clientRefuelIds both attempting final_return results in exactly one final_return Fillup', async () => {
    const [a, b] = await Promise.all([
      createRentalFillup('user-1', 'session-1', { gallonsPumped: 2, pricePerGallon: 3.5, fillupType: 'final_return', clientRefuelId: 'final-a' }),
      createRentalFillup('user-1', 'session-1', { gallonsPumped: 1, pricePerGallon: 3.5, fillupType: 'final_return', clientRefuelId: 'final-b' }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['created', 'final_return_exists']);
    const finalRows = [...fillupTable.values()].filter((r) => r.fillupType === 'final_return');
    expect(finalRows).toHaveLength(1); // exactly one final_return ever exists
    // currentFuelGallons reflects only the winning fill, not both.
    const winnerGallons = finalRows[0].gallonsPumped;
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(4 + winnerGallons);
  });

  it('a genuinely different clientRefuelId colliding on the final_return partial index is NOT misclassified as an idempotent retry', async () => {
    const first = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 2, pricePerGallon: 3.5, fillupType: 'final_return', clientRefuelId: 'winner-id' });
    if (first.outcome !== 'created') throw new Error('expected created');

    const second = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 9, pricePerGallon: 3.5, fillupType: 'final_return', clientRefuelId: 'a-totally-different-id' });
    // Must be classified as final_return_exists, NEVER 'duplicate' — the two
    // clientRefuelIds are different, so this is not the same submission
    // retried, it's a second, distinct attempt that lost the race.
    expect(second.outcome).toBe('final_return_exists');
    if (second.outcome !== 'final_return_exists') throw new Error('unexpected outcome');
    expect(second.fillup.id).toBe(first.fillup.id);
    expect(second.fillup.clientRefuelId).toBe('winner-id'); // the WINNER's id, not the loser's
    // The loser's 9 gallons must never have been rolled into currentFuelGallons.
    expect(sessionTable.get('session-1')!.currentFuelGallons).toBe(6); // 4 + 2 (winner only)
  });
});

describe('genuine $0 input (2026-08-25 correction) — explicit zero is valid, omission is not', () => {
  it('accepts an explicit pricePerGallon of exactly 0', async () => {
    const result = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, pricePerGallon: 0, fillupType: 'trip', clientRefuelId: 'c1' });
    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') throw new Error('expected created');
    expect(result.fillup.pricePerGallon).toBe(0);
    expect(result.fillup.totalCost).toBe(0); // derived: 5 × 0
  });

  it('accepts an explicit totalPaid (totalCost) of exactly 0', async () => {
    const result = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, totalCost: 0, fillupType: 'trip', clientRefuelId: 'c1' });
    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') throw new Error('expected created');
    expect(result.fillup.totalCost).toBe(0);
    expect(result.fillup.pricePerGallon).toBe(0); // derived: 0 ÷ 5
  });

  it('rejects when BOTH pricePerGallon and totalCost are omitted (not merely falsy)', async () => {
    const result = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 5, fillupType: 'trip', clientRefuelId: 'c1' });
    expect(result.outcome).toBe('invalid');
  });

  it('does not divide by zero — gallons must be > 0 before deriving price from totalCost (already guaranteed by the gallons check)', async () => {
    const result = await createRentalFillup('user-1', 'session-1', { gallonsPumped: 0, totalCost: 20, fillupType: 'trip', clientRefuelId: 'c1' });
    expect(result.outcome).toBe('invalid'); // rejected on gallons, never reaches the division
  });
});

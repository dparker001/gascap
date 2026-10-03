/**
 * Rental delete integrity (2026-10-03). Since the Phase 3A canonical-fillup
 * cutover a rental's refuels are rows in the shared Fillup table, linked by a
 * nullable Fillup.rentalSessionId with NO database FK/cascade. Deleting a
 * rental removed only the RentalSession row, orphaning its Fillups in the
 * renter's personal fill-up list and stats (found in the PR #59 production
 * smoke test). Rental + its Fillups must now go together, atomically, scoped
 * by userId — and nothing else may be touched.
 *
 * The in-memory Prisma below models the array-form $transaction for real:
 * each deleteMany is a LAZY op that only runs when awaited (as Prisma's
 * PrismaPromise does), and a failing op rolls back the ops this transaction
 * already applied. So the rollback test fails if the code deletes outside a
 * single transaction.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const rentals = new Map<string, Row>();
const fillups = new Map<string, Row>();
let failRentalDelete = false;
const transactionCalls: number[] = [];

interface LazyOp<T> extends PromiseLike<T> { run: () => Promise<T>; undo?: () => void }
function lazy<T>(fn: () => Promise<{ value: T; undo: () => void }>): LazyOp<T> {
  let undo: (() => void) | undefined;
  const op: LazyOp<T> = {
    run: async () => { const r = await fn(); undo = r.undo; op.undo = undo; return r.value; },
    then: (ok, ko) => op.run().then(ok, ko),
  };
  return op;
}
const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rentalSession: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => { for (const r of rentals.values()) if (matches(r, where)) return { ...r }; return null; }),
      deleteMany: vi.fn(({ where }: { where: Row }) => lazy(async () => {
        if (failRentalDelete) throw new Error('simulated rental delete failure');
        const removed = [...rentals.values()].filter((r) => matches(r, where));
        removed.forEach((r) => rentals.delete(r.id as string));
        return { value: { count: removed.length }, undo: () => removed.forEach((r) => rentals.set(r.id as string, r)) };
      })),
    },
    fillup: {
      deleteMany: vi.fn(({ where }: { where: Row }) => lazy(async () => {
        const removed = [...fillups.values()].filter((f) => matches(f, where));
        removed.forEach((f) => fillups.delete(f.id as string));
        return { value: { count: removed.length }, undo: () => removed.forEach((f) => fillups.set(f.id as string, f)) };
      })),
    },
    $transaction: vi.fn(async (ops: LazyOp<unknown>[]) => {
      transactionCalls.push(ops.length);
      const done: LazyOp<unknown>[] = [];
      const out: unknown[] = [];
      try {
        for (const op of ops) { out.push(await op.run()); done.push(op); }
        return out;
      } catch (e) {
        for (const op of done.reverse()) op.undo?.();
        throw e;
      }
    }),
  },
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/featureFlags', () => ({ RENTAL_RETURN_ASSISTANT_ENABLED: true }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: vi.fn(async () => ({ outcome: 'recorded' })) }));

const rental = (id: string, userId = 'u1') => rentals.set(id, { id, userId, status: 'active' });
const fill = (id: string, userId: string, rentalSessionId: string | null, fillupType: string | null = rentalSessionId ? 'trip' : null) =>
  fillups.set(id, { id, userId, rentalSessionId, fillupType });
const ids = () => [...fillups.keys()].sort();

beforeEach(() => {
  rentals.clear(); fillups.clear(); failRentalDelete = false; transactionCalls.length = 0; vi.clearAllMocks();
  // Fixture: u1 owns rs-A (trip) and rs-B; u2 owns rs-C; plus personal and cross-user rows.
  rental('rs-A'); rental('rs-B'); rental('rs-C', 'u2');
  fill('f-personal', 'u1', null);                 // ordinary personal fill-up
  fill('f-B', 'u1', 'rs-B');                      // linked to a DIFFERENT rental
  fill('f-u2-same', 'u2', 'rs-A');                // another user's row carrying rs-A's id
  fill('f-C', 'u2', 'rs-C');
});
const del = async (id: string, userId = 'u1') => (await import('@/lib/rentalSessions')).deleteRentalSession(userId, id);

describe('deleteRentalSession — rental and its Fillups go together', () => {
  it('1. owned rental with one trip Fillup: both deleted', async () => {
    fill('f-A1', 'u1', 'rs-A', 'trip');
    expect(await del('rs-A')).toBe(true);
    expect(rentals.has('rs-A')).toBe(false);
    expect(fillups.has('f-A1')).toBe(false);
  });
  it('2. trip + final_return are both deleted', async () => {
    fill('f-A1', 'u1', 'rs-A', 'trip'); fill('f-A2', 'u1', 'rs-A', 'final_return');
    await del('rs-A');
    expect(fillups.has('f-A1') || fillups.has('f-A2')).toBe(false);
  });
  it('3–5. personal (null) Fillups, another rental\'s Fillups and another user\'s Fillups (even with the same rentalSessionId) survive', async () => {
    fill('f-A1', 'u1', 'rs-A');
    await del('rs-A');
    expect(ids()).toEqual(['f-B', 'f-C', 'f-personal', 'f-u2-same']);
  });
  it('6. nonexistent rental: returns false, zero Fillups deleted, no transaction', async () => {
    fill('f-orphan', 'u1', 'rs-gone');            // pre-existing orphan with that id
    expect(await del('rs-gone')).toBe(false);
    expect(fillups.has('f-orphan')).toBe(true);
    expect(transactionCalls).toEqual([]);
  });
  it('7. a rental owned by another user: returns false, nothing deleted', async () => {
    const before = ids();
    expect(await del('rs-C', 'u1')).toBe(false);
    expect(rentals.has('rs-C')).toBe(true);
    expect(ids()).toEqual(before);
  });
  it('atomic: one transaction containing both deletes', async () => {
    fill('f-A1', 'u1', 'rs-A');
    await del('rs-A');
    expect(transactionCalls).toEqual([2]);
  });
  it('atomic: if the rental delete fails, the Fillup delete is rolled back (no half-deleted state)', async () => {
    fill('f-A1', 'u1', 'rs-A');
    failRentalDelete = true;
    await expect(del('rs-A')).rejects.toThrow('simulated rental delete failure');
    expect(rentals.has('rs-A')).toBe(true);
    expect(fillups.has('f-A1')).toBe(true);
  });
});

describe('8. DELETE /api/rental-sessions/[id] — same contract, Fillups now go too', () => {
  const call = async (id: string) => {
    const { DELETE } = await import('@/app/api/rental-sessions/[id]/route');
    const res = await DELETE(new NextRequest(`https://www.gascap.app/api/rental-sessions/${id}`, { method: 'DELETE' }), { params: { id } });
    return { status: res.status, body: await res.json() };
  };
  it('owned rental: 200 {ok:true}; its Fillups are gone', async () => {
    fill('f-A1', 'u1', 'rs-A');
    expect(await call('rs-A')).toEqual({ status: 200, body: { ok: true } });
    expect(fillups.has('f-A1')).toBe(false);
  });
  it('missing or not-owned rental: 404 {error:"Not found"} as before, nothing deleted', async () => {
    const before = ids();
    expect(await call('rs-nope')).toEqual({ status: 404, body: { error: 'Not found' } });
    expect(await call('rs-C')).toEqual({ status: 404, body: { error: 'Not found' } });
    expect(ids()).toEqual(before);
  });
});

describe('9. Help is now factually correct', () => {
  it('Help still says deleting a rental takes its fuel records and photos with it — true once Fillups are deleted', () => {
    const help = readFileSync(path.join(process.cwd(), 'app/help/page.tsx'), 'utf8');
    expect(help).toContain('deleting is permanent and takes that rental\\u2019s fuel records and photos with it');
    const lib = readFileSync(path.join(process.cwd(), 'lib/rentalSessions.ts'), 'utf8');
    const fn = lib.slice(lib.indexOf('export async function deleteRentalSession'), lib.indexOf('export async function deleteRentalSession') + 1500);
    expect(fn).toMatch(/prisma\.fillup\.deleteMany\(\{ where: \{ userId, rentalSessionId: id \} \}\)/);
  });
});

/**
 * Rental delete integrity (2026-10-03). Since the Phase 3A canonical-fillup
 * cutover a rental's refuels are rows in the shared Fillup table, linked by a
 * nullable Fillup.rentalSessionId with NO database FK/cascade. Deleting a
 * rental removed only the RentalSession row, orphaning its Fillups in the
 * renter's personal fill-up list and stats (found in the PR #59 production
 * smoke test). Rental + its Fillups must now go together, atomically, scoped
 * by userId — and nothing else may be touched.
 *
 * The in-memory Prisma below models an interactive $transaction: writes
 * record undos and a throwing callback rolls them back, so the rollback test
 * fails if the deletes are not inside one transaction. Concurrency with a
 * refuel (the shared row lock) is covered in rentalDeleteRefuelRace.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const rentals = new Map<string, Row>();
const fillups = new Map<string, Row>();
let failRentalDelete = false;
const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
const transactionCalls: number[] = [];

const opLog: string[] = [];

// Interactive-transaction model: the callback gets a tx client; every write
// records an undo, and if the callback throws, this transaction's writes are
// undone in reverse (rollback). $queryRaw models the shared row lock's
// SELECT … FOR UPDATE: it returns the owned row if it exists.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn !== 'function') throw new Error('expected an interactive $transaction(async tx => …)');
      transactionCalls.push(1);
      const undos: Array<() => void> = [];
      const tx = {
        $queryRaw: async (_s: TemplateStringsArray, id: string, userId: string) => {
          opLog.push('lock');
          const r = rentals.get(id);
          return r && r.userId === userId ? [{ id }] : [];
        },
        fillup: {
          deleteMany: async ({ where }: { where: Row }) => {
            opLog.push('fillup.deleteMany');
            const removed = [...fillups.values()].filter((f) => matches(f, where));
            removed.forEach((f) => fillups.delete(f.id as string));
            undos.push(() => removed.forEach((f) => fillups.set(f.id as string, f)));
            return { count: removed.length };
          },
        },
        rentalSession: {
          deleteMany: async ({ where }: { where: Row }) => {
            opLog.push('rentalSession.deleteMany');
            if (failRentalDelete) throw new Error('simulated rental delete failure');
            const removed = [...rentals.values()].filter((r) => matches(r, where));
            removed.forEach((r) => rentals.delete(r.id as string));
            undos.push(() => removed.forEach((r) => rentals.set(r.id as string, r)));
            return { count: removed.length };
          },
        },
      };
      try { return await (fn as (t: typeof tx) => Promise<unknown>)(tx); }
      catch (e) { undos.reverse().forEach((u) => u()); throw e; }
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
  rentals.clear(); fillups.clear(); failRentalDelete = false; transactionCalls.length = 0; opLog.length = 0; vi.clearAllMocks();
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
  it('6. nonexistent rental: returns false, zero Fillups deleted (the lock finds no row, nothing else runs)', async () => {
    fill('f-orphan', 'u1', 'rs-gone');            // pre-existing orphan with that id
    expect(await del('rs-gone')).toBe(false);
    expect(fillups.has('f-orphan')).toBe(true);
    expect(opLog).toEqual(['lock']);
  });
  it('7. a rental owned by another user: returns false, nothing deleted', async () => {
    const before = ids();
    expect(await del('rs-C', 'u1')).toBe(false);
    expect(rentals.has('rs-C')).toBe(true);
    expect(ids()).toEqual(before);
  });
  it('atomic: one interactive transaction; the row lock is taken BEFORE any Fillup is deleted', async () => {
    fill('f-A1', 'u1', 'rs-A');
    await del('rs-A');
    expect(transactionCalls).toEqual([1]);
    expect(opLog).toEqual(['lock', 'fillup.deleteMany', 'rentalSession.deleteMany']);
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
    expect(fn).toMatch(/tx\.fillup\.deleteMany\(\{ where: \{ userId, rentalSessionId: id \} \}\)/);
  });
});

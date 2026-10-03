/**
 * Delete-vs-refuel race (2026-10-03, ChatGPT review). deleteRentalSession()
 * and createRentalFillup() must serialize on the SAME RentalSession row lock
 * (lib/rentalLock.ts) so a refuel can never insert a Fillup around a delete —
 * Fillup.rentalSessionId has no FK, so the database would not stop it.
 *
 * Mock fidelity (stated plainly): this is NOT Postgres. The lock is modelled
 * as a per-row async mutex taken by `$queryRaw` (the `SELECT … FOR UPDATE`)
 * and held until the interactive transaction ends; after acquiring, the
 * waiter re-reads the row (Postgres READ COMMITTED re-check behaviour). Test
 * gates pause one transaction mid-flight so both orderings are forced
 * deterministically. It proves the two code paths take the same lock before
 * mutating Fillups and behave correctly under each ordering; it does not
 * prove Postgres' lock implementation itself.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

type Row = Record<string, unknown>;
const rentals = new Map<string, Row>();
const fillups = new Map<string, Row>();
const log: string[] = [];
const gates: Record<string, (() => Promise<void>) | undefined> = {};
let n = 0;

const held = new Map<string, Promise<void>>();
async function acquire(id: string): Promise<() => void> {
  while (held.has(id)) await held.get(id);
  let release!: () => void;
  held.set(id, new Promise<void>((r) => { release = r; }));
  return () => { held.delete(id); release(); };
}
const ownedRow = (id: string, userId: string) => { const r = rentals.get(id); return r && r.userId === userId ? r : null; };
const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);

vi.mock('@/lib/prisma', () => ({
  prisma: {
    // Non-transactional reads (used only by the pre-fix code shape).
    rentalSession: { findFirst: async ({ where }: { where: { id: string; userId: string } }) => ownedRow(where.id, where.userId) },
    fillup: { findFirst: async ({ where }: { where: Row }) => [...fillups.values()].find((f) => matches(f, where)) ?? null },
    $transaction: async (fn: unknown) => {
      if (typeof fn !== 'function') throw new Error('expected an interactive transaction');
      const releases: Array<() => void> = [];
      const undos: Array<() => void> = [];
      const tx = {
        $queryRaw: async (_s: TemplateStringsArray, id: string, userId: string) => {
          releases.push(await acquire(id));
          return ownedRow(id, userId) ? [{ id }] : [];
        },
        $executeRaw: async (_s: TemplateStringsArray, gallons: number, _g2: number, _n1: string, now: string, sessionId: string) => {
          const r = rentals.get(sessionId);
          if (r && r.currentFuelGallons != null) { r.currentFuelGallons = (r.currentFuelGallons as number) + gallons; r.currentFuelSource = 'RECEIPT'; r.updatedAt = now; }
          return r ? 1 : 0;
        },
        rentalSession: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) => ownedRow(where.id, where.userId),
          deleteMany: async ({ where }: { where: Row }) => {
            await gates.beforeRentalDelete?.();
            const gone = [...rentals.values()].filter((r) => matches(r, where));
            gone.forEach((r) => rentals.delete(r.id as string));
            undos.push(() => gone.forEach((r) => rentals.set(r.id as string, r)));
            log.push('rental deleted');
            return { count: gone.length };
          },
        },
        fillup: {
          findFirst: async ({ where }: { where: Row }) => [...fillups.values()].find((f) => matches(f, where)) ?? null,
          create: async ({ data }: { data: Row }) => {
            await gates.beforeFillupCreate?.();
            const row = { ...data, id: data.id ?? `f-${++n}` };
            fillups.set(row.id as string, row);
            undos.push(() => fillups.delete(row.id as string));
            log.push('fillup created');
            return row;
          },
          deleteMany: async ({ where }: { where: Row }) => {
            const gone = [...fillups.values()].filter((f) => matches(f, where));
            gone.forEach((f) => fillups.delete(f.id as string));
            undos.push(() => gone.forEach((f) => fillups.set(f.id as string, f)));
            log.push(`fillups deleted:${gone.length}`);
            return { count: gone.length };
          },
        },
      };
      try { return await (fn as (t: typeof tx) => Promise<unknown>)(tx); }
      catch (e) { undos.reverse().forEach((u) => u()); throw e; }
      finally { releases.forEach((r) => r()); }
    },
  },
}));
vi.mock('@/lib/generated/prisma/client', () => ({ Prisma: { PrismaClientKnownRequestError: class extends Error { code = ''; } } }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: vi.fn(async () => ({ outcome: 'recorded' })) }));

/** A gate that marks when it's reached and holds until released. */
function gate(name: string) {
  let release!: () => void;
  const opened = new Promise<void>((r) => { release = r; });
  let reached!: () => void;
  const hit = new Promise<void>((r) => { reached = r; });
  gates[name] = async () => { gates[name] = undefined; reached(); await opened; };
  return { hit, release };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const REFUEL = { gallonsPumped: 2, pricePerGallon: 3, fillupType: 'trip' as const, clientRefuelId: 'c-1' };

beforeEach(() => {
  rentals.clear(); fillups.clear(); log.length = 0; held.clear(); n = 0;
  delete gates.beforeRentalDelete; delete gates.beforeFillupCreate;
  rentals.set('rs', { id: 'rs', userId: 'u1', rentalCompany: 'Hertz', vehicleYear: null, vehicleMake: null, vehicleModel: null,
                      vehicleId: null, currentFuelGallons: 6, currentFuelSource: 'MANUAL_GALLONS' });
});

describe('delete wins the lock first', () => {
  it('the waiting refuel finds no rental and creates NO Fillup (no orphan)', async () => {
    const { deleteRentalSession } = await import('@/lib/rentalSessions');
    const { createRentalFillup } = await import('@/lib/rentalFillups');
    const g = gate('beforeRentalDelete');               // delete holds the lock, paused mid-transaction
    const del = deleteRentalSession('u1', 'rs');
    await g.hit;
    const refuel = createRentalFillup('u1', 'rs', REFUEL);
    await settle();
    expect(log).toEqual(['fillups deleted:0']);         // refuel is blocked on the lock, has done nothing
    g.release();
    expect(await del).toBe(true);
    expect(await refuel).toEqual({ outcome: 'not_found' });
    expect(fillups.size).toBe(0);
    expect(rentals.has('rs')).toBe(false);
  });
});

describe('refuel wins the lock first', () => {
  it('the refuel commits, then the delete removes that Fillup with the rental', async () => {
    const { deleteRentalSession } = await import('@/lib/rentalSessions');
    const { createRentalFillup } = await import('@/lib/rentalFillups');
    const g = gate('beforeFillupCreate');               // refuel holds the lock, paused before insert
    const refuel = createRentalFillup('u1', 'rs', REFUEL);
    await g.hit;
    const del = deleteRentalSession('u1', 'rs');
    await settle();
    expect(rentals.has('rs')).toBe(true);               // delete is blocked on the lock
    expect(log).toEqual([]);
    g.release();
    expect((await refuel).outcome).toBe('created');
    expect(await del).toBe(true);
    expect(log).toEqual(['fillup created', 'fillups deleted:1', 'rental deleted']);
    expect(fillups.size).toBe(0);
    expect(rentals.has('rs')).toBe(false);
  });
});

describe('structure: both paths take the same lock before touching Fillups', () => {
  const body = (file: string, fn: string) => {
    const src = readFileSync(path.join(process.cwd(), file), 'utf8');
    const i = src.indexOf(`export async function ${fn}`);
    return src.slice(i, src.indexOf('\nexport ', i + 10));
  };
  it('deleteRentalSession: lock → fillup.deleteMany → rentalSession.deleteMany, all on tx', () => {
    const b = body('lib/rentalSessions.ts', 'deleteRentalSession');
    const lock = b.indexOf('lockOwnedRentalSession(tx, id, userId)');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(b.indexOf('tx.fillup.deleteMany'));
    expect(b.indexOf('tx.fillup.deleteMany')).toBeLessThan(b.indexOf('tx.rentalSession.deleteMany'));
  });
  it('createRentalFillup: lock → session read → final_return check → fillup.create → fuel bump, all on tx', () => {
    const b = body('lib/rentalFillups.ts', 'createRentalFillup');
    const lock = b.indexOf('lockOwnedRentalSession(tx, rentalSessionId, userId)');
    expect(lock).toBeGreaterThan(-1);
    for (const later of ['tx.rentalSession.findFirst', 'tx.fillup.findFirst', 'tx.fillup.create', 'bumpCurrentFuelGallonsOnCreateSql(tx,']) {
      expect(b.indexOf(later)).toBeGreaterThan(lock);
    }
    expect(b).not.toMatch(/prisma\.rentalSession\.findFirst/);   // no unlocked ownership read anymore
  });
  it('both import the one shared lock helper', () => {
    for (const f of ['lib/rentalSessions.ts', 'lib/rentalFillups.ts']) {
      expect(readFileSync(path.join(process.cwd(), f), 'utf8')).toContain("import { lockOwnedRentalSession } from './rentalLock';");
    }
    expect(readFileSync(path.join(process.cwd(), 'lib/rentalLock.ts'), 'utf8')).toMatch(/SELECT "id" FROM "RentalSession" WHERE "id" = \$\{id\} AND "userId" = \$\{userId\} FOR UPDATE/);
  });
});

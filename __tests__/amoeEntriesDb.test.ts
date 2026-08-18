/**
 * Tests for lib/amoeEntriesDb.ts — the dual-write mirror and idempotent
 * backfill supporting the staged AMOE migration (see that file's header for
 * why this sprint doesn't cut the draw's read path over to Postgres yet).
 *
 * Post-Sprint-2 Revision 1: backfill now reconciles by (email, month) key
 * plus field content, not just a count comparison, and uses an atomic
 * createMany({skipDuplicates:true}) batch insert instead of a per-row
 * findUnique-then-create race.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AmoeEntry } from '../lib/amoeEntries';

interface Row extends AmoeEntry {}
const table = new Map<string, Row>(); // keyed by `${email}|${month}`
const k = (email: string, month: string) => `${email.toLowerCase()}|${month}`;

const prismaMock = {
  amoeEntry: {
    upsert: vi.fn(async ({ where, create }: { where: { email_month: { email: string; month: string } }; create: Row }) => {
      const key = k(where.email_month.email, where.email_month.month);
      if (!table.has(key)) table.set(key, create);
      return table.get(key);
    }),
    findMany: vi.fn(async () => [...table.values()]),
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const entry of data) {
        const key = k(entry.email, entry.month);
        if (table.has(key)) {
          if (!skipDuplicates) throw new Error('unique constraint violation');
          continue;
        }
        table.set(key, entry);
        count++;
      }
      return { count };
    }),
    count: vi.fn(async () => table.size),
  },
};

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const entry = (overrides: Partial<AmoeEntry> = {}): AmoeEntry => ({
  id: 'id-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
  month: '2026-08', submittedAt: '2026-08-01T00:00:00.000Z', ...overrides,
});

beforeEach(() => { table.clear(); vi.clearAllMocks(); });

describe('mirrorAmoeEntryToDb', () => {
  it('writes a new entry', async () => {
    const { mirrorAmoeEntryToDb } = await import('../lib/amoeEntriesDb');
    await mirrorAmoeEntryToDb(entry());
    expect(table.size).toBe(1);
  });

  it('never throws, even if Postgres is unreachable — the file write must not be blocked by this', async () => {
    const { mirrorAmoeEntryToDb } = await import('../lib/amoeEntriesDb');
    prismaMock.amoeEntry.upsert.mockRejectedValueOnce(new Error('connection refused'));
    await expect(mirrorAmoeEntryToDb(entry())).resolves.toBeUndefined();
  });

  it('does not overwrite an existing (email, month) row — first write wins', async () => {
    const { mirrorAmoeEntryToDb } = await import('../lib/amoeEntriesDb');
    await mirrorAmoeEntryToDb(entry({ id: 'first' }));
    await mirrorAmoeEntryToDb(entry({ id: 'second-should-not-land' }));
    expect(table.get('jane@example.com|2026-08')!.id).toBe('first');
  });
});

describe('backfillAmoeEntries', () => {
  it('inserts every entry from an empty table and reports verified:true', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    const entries = [entry({ id: '1' }), entry({ id: '2', email: 'other@example.com' })];
    const res = await backfillAmoeEntries(entries);
    expect(res.inserted).toBe(2);
    expect(res.alreadyPresent).toBe(0);
    expect(res.fileCount).toBe(2);
    expect(res.dbCount).toBe(2);
    expect(res.missingInDb).toBe(0);
    expect(res.extraInDb).toBe(0);
    expect(res.fieldMismatchCount).toBe(0);
    expect(res.verified).toBe(true);
  });

  it('is idempotent — running it twice inserts nothing the second time', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    const entries = [entry({ id: '1' }), entry({ id: '2', email: 'other@example.com' })];
    await backfillAmoeEntries(entries);
    const second = await backfillAmoeEntries(entries);
    expect(second.inserted).toBe(0);
    expect(second.alreadyPresent).toBe(2);
    expect(second.dbCount).toBe(2); // unchanged
    expect(second.verified).toBe(true);
  });

  it('a partial re-run only inserts what is genuinely missing', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    await backfillAmoeEntries([entry({ id: '1' })]);
    const res = await backfillAmoeEntries([entry({ id: '1' }), entry({ id: '2', email: 'new@example.com' })]);
    expect(res.inserted).toBe(1);
    expect(res.alreadyPresent).toBe(1);
    expect(res.dbCount).toBe(2);
    expect(res.verified).toBe(true);
  });

  it('handles an empty file (nobody has ever entered) without error', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    const res = await backfillAmoeEntries([]);
    expect(res.inserted).toBe(0);
    expect(res.fileCount).toBe(0);
    expect(res.verified).toBe(true); // vacuously — nothing to mismatch
  });

  it('DETECTS a same-count-but-different-content mismatch — the exact gap a count-only check would miss', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    // Seed the DB with an entry the file does NOT contain (simulating drift:
    // a DB row that shouldn't exist, e.g. from a bad manual edit).
    table.set('extra@example.com|2026-08', entry({ id: 'extra', email: 'extra@example.com' }));
    const fileEntries = [entry({ id: '1' })]; // file has 1 entry, DB (after backfill) will have 2
    const res = await backfillAmoeEntries(fileEntries);
    expect(res.fileCount).toBe(1);
    expect(res.dbCount).toBe(2);
    expect(res.extraInDb).toBe(1);
    expect(res.verified).toBe(false);
  });

  it('detects a field-level mismatch on an otherwise-matching key', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    // DB row exists for jane@example.com|2026-08 but with a different last name.
    table.set('jane@example.com|2026-08', entry({ lastName: 'TYPO-MISMATCH' }));
    const res = await backfillAmoeEntries([entry({ lastName: 'Doe' })]);
    expect(res.fieldMismatchCount).toBe(1);
    expect(res.verified).toBe(false);
    // A field mismatch does NOT get re-inserted (the key already exists) —
    // it's flagged for investigation, not silently overwritten.
    expect(res.inserted).toBe(0);
  });

  it('detects entries genuinely missing from the DB after the insert attempt', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    // Force createMany to silently fail to insert (simulating a DB-level
    // rejection that isn't a duplicate-key situation).
    prismaMock.amoeEntry.createMany.mockResolvedValueOnce({ count: 0 });
    const res = await backfillAmoeEntries([entry({ id: '1' })]);
    expect(res.missingInDb).toBe(1);
    expect(res.verified).toBe(false);
  });

  it('uses createMany with skipDuplicates — not a per-row findUnique/create race', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    await backfillAmoeEntries([entry({ id: '1' }), entry({ id: '2', email: 'other@example.com' })]);
    expect(prismaMock.amoeEntry.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('does not call createMany at all when nothing is missing (no-op insert)', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    await backfillAmoeEntries([entry({ id: '1' })]);
    prismaMock.amoeEntry.createMany.mockClear();
    await backfillAmoeEntries([entry({ id: '1' })]);
    expect(prismaMock.amoeEntry.createMany).not.toHaveBeenCalled();
  });
});

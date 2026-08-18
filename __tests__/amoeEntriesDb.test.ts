/**
 * Tests for lib/amoeEntriesDb.ts — the dual-write mirror and idempotent
 * backfill supporting the staged AMOE migration (see that file's header for
 * why this sprint doesn't cut the draw's read path over to Postgres yet).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AmoeEntry } from '../lib/amoeEntries';

interface Row extends AmoeEntry {}
const table = new Map<string, Row>(); // keyed by `${email}|${month}`
const k = (email: string, month: string) => `${email}|${month}`;

const prismaMock = {
  amoeEntry: {
    upsert: vi.fn(async ({ where, create }: { where: { email_month: { email: string; month: string } }; create: Row }) => {
      const key = k(where.email_month.email, where.email_month.month);
      if (!table.has(key)) table.set(key, create);
      return table.get(key);
    }),
    findUnique: vi.fn(async ({ where }: { where: { email_month: { email: string; month: string } } }) =>
      table.get(k(where.email_month.email, where.email_month.month)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      table.set(k(data.email, data.month), data);
      return data;
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
  it('inserts every entry from an empty table', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    const entries = [entry({ id: '1' }), entry({ id: '2', email: 'other@example.com' })];
    const res = await backfillAmoeEntries(entries);
    expect(res.inserted).toBe(2);
    expect(res.alreadyPresent).toBe(0);
    expect(res.dbCountBefore).toBe(0);
    expect(res.dbCountAfter).toBe(2);
    expect(res.fileCount).toBe(2);
  });

  it('is idempotent — running it twice inserts nothing the second time', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    const entries = [entry({ id: '1' }), entry({ id: '2', email: 'other@example.com' })];
    await backfillAmoeEntries(entries);
    const second = await backfillAmoeEntries(entries);
    expect(second.inserted).toBe(0);
    expect(second.alreadyPresent).toBe(2);
    expect(second.dbCountAfter).toBe(2); // unchanged
  });

  it('a partial re-run only inserts what is genuinely missing', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    await backfillAmoeEntries([entry({ id: '1' })]);
    const res = await backfillAmoeEntries([entry({ id: '1' }), entry({ id: '2', email: 'new@example.com' })]);
    expect(res.inserted).toBe(1);
    expect(res.alreadyPresent).toBe(1);
    expect(res.dbCountAfter).toBe(2);
  });

  it('fileCount vs dbCountAfter is the caller-facing verification signal', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    const res = await backfillAmoeEntries([entry({ id: '1' }), entry({ id: '2', email: 'b@example.com' })]);
    expect(res.fileCount).toBe(res.dbCountAfter);
  });

  it('handles an empty file (nobody has ever entered) without error', async () => {
    const { backfillAmoeEntries } = await import('../lib/amoeEntriesDb');
    const res = await backfillAmoeEntries([]);
    expect(res.inserted).toBe(0);
    expect(res.fileCount).toBe(0);
  });
});

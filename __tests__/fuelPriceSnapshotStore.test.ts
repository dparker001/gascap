/**
 * Phase 0.5B — FuelPriceSnapshot persistence (lib/fuelPriceSnapshots.ts).
 * Prisma is mocked with an in-memory table that enforces the real unique
 * key (source, duoarea, product, observedOn), so idempotency is exercised,
 * not assumed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Row { source: string; duoarea: string; product: string; grade: string; observedOn: string; price: number }
const table = new Map<string, Row>();
const key = (r: Row) => [r.source, r.duoarea, r.product, r.observedOn].join('|');

const createMany = vi.fn(async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
  let count = 0;
  for (const r of data) {
    if (table.has(key(r))) {
      if (!skipDuplicates) throw new Error('P2002');
      continue;
    }
    table.set(key(r), r);
    count++;
  }
  return { count };
});
const findMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
  const w = where as { source?: string; duoarea?: string | { in: string[] }; grade?: string; observedOn?: { gte?: string; lte?: string } };
  return [...table.values()]
    .filter((r) => !w.source || r.source === w.source)
    .filter((r) => !w.grade || r.grade === w.grade)
    .filter((r) => !w.duoarea || (typeof w.duoarea === 'string' ? r.duoarea === w.duoarea : w.duoarea.in.includes(r.duoarea)))
    .filter((r) => !w.observedOn?.gte || r.observedOn >= w.observedOn.gte)
    .filter((r) => !w.observedOn?.lte || r.observedOn <= w.observedOn.lte)
    .sort((a, b) => a.observedOn.localeCompare(b.observedOn));
});
const findFirst = vi.fn(async ({ where }: { where: { duoarea: string; grade: string } }) => {
  const rows = (await findMany({ where })) as Row[];
  return rows.length ? rows[rows.length - 1] : null;
});
vi.mock('@/lib/prisma', () => ({ prisma: { fuelPriceSnapshot: { createMany, findMany, findFirst } } }));

const eiaRow = (duoarea: string, product: string, period: string, value: string) => ({
  period, duoarea, product, 'product-name': 'x', process: 'PTE', series: 's', value, units: '$/GAL',
});
// Every grade request gets the same-shaped payload for its product.
function fakeEia(periods: string[]) {
  return vi.fn(async (url: string) => {
    const product = new URL(url).searchParams.get('facets[product][]')!;
    const data = periods.flatMap((p) => [eiaRow('NUS', product, p, '4.354'), eiaRow('SFL', product, p, '3.97')]);
    return { ok: true, status: 200, json: async () => ({ response: { data } }) } as Response;
  });
}

beforeEach(() => { table.clear(); vi.clearAllMocks(); process.env.EIA_API_KEY = 'test-key-not-real'; });
const load = async () => { vi.resetModules(); return import('@/lib/fuelPriceSnapshots'); };

describe('syncFuelPriceSnapshots', () => {
  const now = new Date('2026-10-07T22:25:00Z');

  it('stores each (area, grade, EIA week) once, with the EIA survey date as observedOn', async () => {
    const { syncFuelPriceSnapshots } = await load();
    const r = await syncFuelPriceSnapshots({ weeks: 2, now, fetchImpl: fakeEia(['2026-10-05', '2026-09-28']) as unknown as typeof fetch });
    // 4 grades x 2 areas x 2 weeks
    expect(r.fetched).toBe(16);
    expect(r.inserted).toBe(16);
    expect(table.size).toBe(16);
    const sample = table.get('eia_weekly|NUS|EPMR|2026-10-05')!;
    expect(sample).toMatchObject({ grade: 'regular', observedOn: '2026-10-05', price: 4.354 });
    expect(r.latestObservedOn).toBe('2026-10-05');
    expect(r.ageDays).toBe(2);
    expect(r.stale).toBe(false);
  });

  it('is idempotent: a second run over the same data inserts nothing', async () => {
    const { syncFuelPriceSnapshots } = await load();
    const f = fakeEia(['2026-10-05']) as unknown as typeof fetch;
    await syncFuelPriceSnapshots({ weeks: 1, now, fetchImpl: f });
    const again = await syncFuelPriceSnapshots({ weeks: 1, now, fetchImpl: f });
    expect(again.inserted).toBe(0);
    expect(table.size).toBe(8);
    expect(createMany.mock.calls.every((c) => (c[0] as { skipDuplicates?: boolean }).skipDuplicates === true)).toBe(true);
  });

  it('first-seen value wins: a later differing price does NOT overwrite a stored one', async () => {
    const { syncFuelPriceSnapshots } = await load();
    await syncFuelPriceSnapshots({ weeks: 1, now, fetchImpl: fakeEia(['2026-10-05']) as unknown as typeof fetch });
    const revised = vi.fn(async (url: string) => {
      const product = new URL(url).searchParams.get('facets[product][]')!;
      return { ok: true, status: 200, json: async () => ({ response: { data: [eiaRow('NUS', product, '2026-10-05', '9.999')] } }) } as Response;
    });
    await syncFuelPriceSnapshots({ weeks: 1, now, fetchImpl: revised as unknown as typeof fetch });
    expect(table.get('eia_weekly|NUS|EPMR|2026-10-05')!.price).toBe(4.354);
  });

  it('flags stale when EIA\'s newest national Regular week is >14 days old', async () => {
    const { syncFuelPriceSnapshots } = await load();
    const r = await syncFuelPriceSnapshots({ weeks: 1, now, fetchImpl: fakeEia(['2026-09-14']) as unknown as typeof fetch });
    expect(r.stale).toBe(true);
    expect(r.ageDays).toBe(23);
  });

  it('throws (so the cron fails visibly) when EIA returns nothing usable', async () => {
    const { syncFuelPriceSnapshots } = await load();
    const empty = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ response: { data: [] } }) }) as Response);
    await expect(syncFuelPriceSnapshots({ weeks: 1, fetchImpl: empty as unknown as typeof fetch })).rejects.toThrow(/no valid observations/);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('clamps the requested weeks to the backfill cap', async () => {
    const { syncFuelPriceSnapshots, MAX_BACKFILL_WEEKS } = await load();
    const f = fakeEia(['2026-10-05']);
    await syncFuelPriceSnapshots({ weeks: 99999, now, fetchImpl: f as unknown as typeof fetch });
    const len = Number(new URL((f.mock.calls[0] as unknown as [string])[0]).searchParams.get('length'));
    expect(len).toBeLessThanOrEqual(MAX_BACKFILL_WEEKS * 17);
  });
});

describe('history reads', () => {
  async function seed() {
    const { syncFuelPriceSnapshots } = await load();
    await syncFuelPriceSnapshots({
      weeks: 3, now: new Date('2026-10-07T22:25:00Z'),
      fetchImpl: fakeEia(['2026-10-05', '2026-09-28', '2026-09-21']) as unknown as typeof fetch,
    });
  }

  it('loadNationalSnapshots returns the NUS series per grade, oldest first', async () => {
    await seed();
    const { loadNationalSnapshots } = await load();
    const n = await loadNationalSnapshots('2026-09-25');
    expect(n.regular?.map((p) => p.observedOn)).toEqual(['2026-09-28', '2026-10-05']);
    expect(Object.keys(n).sort()).toEqual(['diesel', 'midgrade', 'premium', 'regular']);
  });

  it('latestSnapshotForChain takes the first area in the chain that has data', async () => {
    await seed();
    const { latestSnapshotForChain } = await load();
    expect(await latestSnapshotForChain(['SFL', 'R1Z', 'NUS'], 'regular')).toEqual({ price: 3.97, area: 'SFL', observedOn: '2026-10-05' });
    // R1Z has no rows in this fixture -> skipped, NUS used
    expect((await latestSnapshotForChain(['R1Z', 'NUS'], 'regular'))?.area).toBe('NUS');
    expect(await latestSnapshotForChain(['R1Z'], 'regular')).toBeNull();
  });

  it('resolveNewFillupBaseline: grade-matched, time-matched, coarse area only', async () => {
    await seed();
    const { resolveNewFillupBaseline } = await load();
    const b = await resolveNewFillupBaseline({ grade: 'premium', date: '2026-10-07', state: 'FL' });
    expect(b).toEqual({ price: 3.97, source: 'eia_weekly', area: 'SFL', period: '2026-10-05' });
    expect(Object.keys(b!).sort()).toEqual(['area', 'period', 'price', 'source']); // no coordinates/address
  });

  it('resolveNewFillupBaseline: null for unknown grade, and for dates with no recent week', async () => {
    await seed();
    const { resolveNewFillupBaseline } = await load();
    expect(await resolveNewFillupBaseline({ grade: undefined, date: '2026-10-07' })).toBeNull();
    expect(await resolveNewFillupBaseline({ grade: 'e85', date: '2026-10-07' })).toBeNull();
    expect(await resolveNewFillupBaseline({ grade: 'regular', date: '2027-03-01' })).toBeNull();
  });
});

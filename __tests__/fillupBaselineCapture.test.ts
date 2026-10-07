/**
 * Phase 0.5B — addFillup freezes a defensible baseline at log time;
 * updateFillup drops it when the date or grade it was captured for changes.
 * A baseline failure must NEVER fail the fill-up itself.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Row = Record<string, unknown>;
let created: Row | null = null;
const store = new Map<string, Row>();

const resolveNewFillupBaseline = vi.fn();
vi.mock('@/lib/fuelPriceSnapshots', () => ({ resolveNewFillupBaseline }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: vi.fn(async () => ({ outcome: 'written', id: 'e' })) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    fillup: {
      create: vi.fn(async ({ data }: { data: Row }) => { created = data; return { ...data }; }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
        const r = store.get(where.id);
        return r && r.userId === where.userId ? r : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const r = store.get(where.id)!;
        Object.assign(r, data);
        return r;
      }),
    },
  },
}));

const baseInput = {
  vehicleName: 'Civic', date: '2026-10-07', gallonsPumped: 10, pricePerGallon: 3.9, fuelGrade: 'regular',
};
const BASELINE = { price: 3.97, source: 'eia_weekly', area: 'SFL', period: '2026-10-05' };

beforeEach(() => {
  created = null; store.clear(); vi.clearAllMocks();
  resolveNewFillupBaseline.mockResolvedValue(BASELINE);
});
const load = async () => { vi.resetModules(); return import('@/lib/fillups'); };

describe('addFillup — baseline capture', () => {
  it('stores the four baseline columns when a baseline is defensible', async () => {
    const { addFillup } = await load();
    const out = await addFillup('u1', { ...baseInput, areaState: 'FL' });
    expect(resolveNewFillupBaseline).toHaveBeenCalledWith({ grade: 'regular', date: '2026-10-07', state: 'FL' });
    expect(created).toMatchObject({ baselinePrice: 3.97, baselineSource: 'eia_weekly', baselineArea: 'SFL', baselinePeriod: '2026-10-05' });
    expect(out.baselinePrice).toBe(3.97);
  });

  it('never persists the raw state/area input (only the coarse EIA area)', async () => {
    const { addFillup } = await load();
    await addFillup('u1', { ...baseInput, areaState: 'FL' });
    expect(created).not.toHaveProperty('areaState');
    expect(created).not.toHaveProperty('state');
  });

  it('stores nulls when no baseline is defensible', async () => {
    resolveNewFillupBaseline.mockResolvedValue(null);
    const { addFillup } = await load();
    await addFillup('u1', { ...baseInput, fuelGrade: undefined });
    expect(created).toMatchObject({ baselinePrice: null, baselineSource: null, baselineArea: null, baselinePeriod: null });
  });

  it('REGRESSION GUARD: a baseline lookup failure does not fail or block the fill-up', async () => {
    resolveNewFillupBaseline.mockRejectedValue(new Error('relation "FuelPriceSnapshot" does not exist'));
    const { addFillup } = await load();
    const out = await addFillup('u1', baseInput);
    expect(out.gallonsPumped).toBe(10);
    expect(created).toMatchObject({ baselinePrice: null });
  });
});

describe('updateFillup — baseline invalidation', () => {
  const seedRow = (over: Row = {}) => store.set('f1', {
    id: 'f1', userId: 'u1', vehicleId: null, vehicleName: 'Civic', date: '2026-10-07',
    gallonsPumped: 10, pricePerGallon: 3.9, totalCost: 39, odometerReading: null, fuelLevelBefore: null,
    stationName: null, notes: null, driverLabel: null, fuelGrade: 'regular', receiptThumb: null,
    createdAt: '2026-10-07T00:00:00.000Z',
    baselinePrice: 3.97, baselineSource: 'eia_weekly', baselineArea: 'SFL', baselinePeriod: '2026-10-05',
    ...over,
  });

  it('keeps the baseline for edits that do not change date or grade', async () => {
    seedRow();
    const { updateFillup } = await load();
    const r = await updateFillup('u1', 'f1', { stationName: 'Shell', notes: 'x' });
    expect(r?.baselinePrice).toBe(3.97);
  });

  it('keeps it when date/grade are re-sent unchanged (full-object PATCH)', async () => {
    seedRow();
    const { updateFillup } = await load();
    const r = await updateFillup('u1', 'f1', { date: '2026-10-07', fuelGrade: 'regular' });
    expect(r?.baselinePrice).toBe(3.97);
  });

  it('drops it when the date changes (it was matched to a different week)', async () => {
    seedRow();
    const { updateFillup } = await load();
    const r = await updateFillup('u1', 'f1', { date: '2026-08-01' });
    expect(r?.baselinePrice).toBeUndefined();
    expect(r?.baselinePeriod).toBeUndefined();
  });

  it('drops it when the grade changes (it was matched to a different product)', async () => {
    seedRow();
    const { updateFillup } = await load();
    const r = await updateFillup('u1', 'f1', { fuelGrade: 'premium' });
    expect(r?.baselinePrice).toBeUndefined();
    expect(r?.baselineSource).toBeUndefined();
  });
});

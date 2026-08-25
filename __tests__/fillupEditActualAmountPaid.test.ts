/**
 * lib/fillups.ts's updateFillup() — "Actual Amount Paid" edit fix
 * (2026-08-25 P0). Previously totalCost was unconditionally recomputed as
 * gallonsPumped × pricePerGallon on EVERY edit, silently discarding any
 * manually-entered actual payment (e.g. a rounded pump total or a
 * discount) whenever any field was edited — and the edit UI didn't even
 * expose the field to re-enter it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Row {
  id: string; userId: string; vehicleId: string | null; vehicleName: string;
  date: string; gallonsPumped: number; pricePerGallon: number; totalCost: number;
  odometerReading: number | null; fuelLevelBefore: number | null;
  stationName: string | null; notes: string | null; driverLabel: string | null;
  fuelGrade: string | null; receiptThumb: string | null; createdAt: string;
}

const table = new Map<string, Row>();

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'fu-1', userId: 'user-1', vehicleId: null, vehicleName: 'Civic',
    date: '2026-08-01', gallonsPumped: 10, pricePerGallon: 3.50, totalCost: 42.00, // explicit actual paid, not 35.00
    odometerReading: null, fuelLevelBefore: null,
    stationName: null, notes: null, driverLabel: null,
    fuelGrade: null, receiptThumb: null, createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const prismaMock = {
  fillup: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
      const row = table.get(where.id);
      return row && row.userId === where.userId ? row : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = table.get(where.id)!;
      Object.assign(row, data);
      return row;
    }),
  },
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: vi.fn(async () => ({ outcome: 'recorded' })) }));

beforeEach(() => {
  table.clear();
  vi.clearAllMocks();
});

async function getModule() {
  vi.resetModules();
  return import('@/lib/fillups');
}

describe('updateFillup — Actual Amount Paid preservation', () => {
  it('1. existing totalCost is returned/available to the caller (edit UI prepopulation source)', async () => {
    table.set('fu-1', makeRow());
    const { updateFillup } = await getModule();
    const result = await updateFillup('user-1', 'fu-1', { stationName: 'Shell' });
    expect(result?.totalCost).toBe(42.00); // untouched by an unrelated edit
  });

  it('2. an explicitly-provided totalCost is used exactly, even when gallons/price also change', async () => {
    table.set('fu-1', makeRow());
    const { updateFillup } = await getModule();
    const result = await updateFillup('user-1', 'fu-1', { gallonsPumped: 12, pricePerGallon: 3.60, totalCost: 45.50 });
    expect(result?.totalCost).toBe(45.50); // NOT 12 * 3.60 = 43.20
  });

  it('3. unrelated edits (station, notes, odometer) preserve the existing totalCost exactly', async () => {
    table.set('fu-1', makeRow({ totalCost: 42.00 }));
    const { updateFillup } = await getModule();
    const result = await updateFillup('user-1', 'fu-1', { notes: 'road trip', odometerReading: 50000 });
    expect(result?.totalCost).toBe(42.00);
  });

  it('4. changing gallons/price WITHOUT an explicit totalCost never silently recomputes over an existing value', async () => {
    table.set('fu-1', makeRow({ totalCost: 42.00 }));
    const { updateFillup } = await getModule();
    const result = await updateFillup('user-1', 'fu-1', { gallonsPumped: 11, pricePerGallon: 3.50 });
    expect(result?.totalCost).toBe(42.00); // NOT recomputed to 38.50
  });

  it('5. clearing behavior is intentional — an explicit null totalCost recomputes from gallons × price', async () => {
    table.set('fu-1', makeRow({ gallonsPumped: 10, pricePerGallon: 3.50, totalCost: 42.00 }));
    const { updateFillup } = await getModule();
    const result = await updateFillup('user-1', 'fu-1', { totalCost: null });
    expect(result?.totalCost).toBe(35.00); // 10 * 3.50, explicitly requested
  });

  it('5b. clearing + simultaneously changing gallons/price recomputes from the NEW values', async () => {
    table.set('fu-1', makeRow({ totalCost: 42.00 }));
    const { updateFillup } = await getModule();
    const result = await updateFillup('user-1', 'fu-1', { gallonsPumped: 12, pricePerGallon: 3.60, totalCost: null });
    expect(result?.totalCost).toBe(43.20);
  });

  it('returns null for a fillup that does not belong to the user (ownership check unaffected)', async () => {
    table.set('fu-1', makeRow({ userId: 'someone-else' }));
    const { updateFillup } = await getModule();
    const result = await updateFillup('user-1', 'fu-1', { totalCost: 10 });
    expect(result).toBeNull();
  });
});

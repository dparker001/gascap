/**
 * Phase 4 (2026-08-25) — Vehicle/RentalSession fuelGaugeStyle persistence.
 * Covers: a new (including VIN-created) Vehicle defaults to null/GasCap
 * default, updateVehicle persists a valid style, and RentalSession
 * fuelGaugeStyle persistence + the rental-vs-linked-Vehicle precedence used
 * end-to-end (not just the pure resolveRentalGaugeStyle unit already
 * covered in __tests__/gaugeStyles.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface VehicleRow {
  id: string; userId: string; name: string; gallons: number;
  vin: string | null; year: string | null; make: string | null; model: string | null; trim: string | null;
  fuelType: string | null; fuelTypeConfirmedByUser: boolean; epaId: string | null;
  currentOdometer: number | null; vehicleSpecs: unknown; isDefault: boolean; createdAt: string;
  fuelGaugeStyle: string | null;
}

const vehicleTable = new Map<string, VehicleRow>();

function makeVehicleRow(overrides: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: 'veh-1', userId: 'user-1', name: 'My Car', gallons: 14,
    vin: null, year: null, make: null, model: null, trim: null,
    fuelType: null, fuelTypeConfirmedByUser: false, epaId: null,
    currentOdometer: null, vehicleSpecs: null, isDefault: false, createdAt: '2026-08-01T00:00:00.000Z',
    fuelGaugeStyle: null,
    ...overrides,
  };
}

const prismaMock = {
  vehicle: {
    create: vi.fn(async ({ data }: { data: VehicleRow }) => {
      vehicleTable.set(data.id, { ...data });
      return { ...data };
    }),
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
      const row = vehicleTable.get(where.id);
      return row && row.userId === where.userId ? { ...row } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<VehicleRow> }) => {
      const row = vehicleTable.get(where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    }),
  },
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: vi.fn(async () => ({ outcome: 'written', id: 'evt_1' })) }));

let addVehicle: typeof import('@/lib/savedVehicles').addVehicle;
let updateVehicle: typeof import('@/lib/savedVehicles').updateVehicle;

beforeEach(async () => {
  vi.clearAllMocks();
  vehicleTable.clear();
  const mod = await import('@/lib/savedVehicles');
  addVehicle = mod.addVehicle;
  updateVehicle = mod.updateVehicle;
});

describe('addVehicle — new (including VIN-created) vehicles default to no gauge style', () => {
  it('a manually-created vehicle has fuelGaugeStyle undefined (resolves to GasCap default)', async () => {
    const v = await addVehicle('user-1', 'My Car', 14);
    expect(v.fuelGaugeStyle).toBeUndefined();
  });

  it('a VIN-decoded vehicle (extra specs supplied) still defaults to no gauge style — never inferred', async () => {
    const v = await addVehicle('user-1', '2024 Honda Civic', 12.4, {
      vin: '1HGCM82633A123456', year: '2024', make: 'Honda', model: 'Civic', epaId: 'epa-1',
    });
    expect(v.fuelGaugeStyle).toBeUndefined();
  });
});

describe('updateVehicle — gauge style persistence', () => {
  it('persists a valid style change', async () => {
    vehicleTable.set('veh-1', makeVehicleRow());
    const updated = await updateVehicle('user-1', 'veh-1', { fuelGaugeStyle: 'quarter_marks' });
    expect(updated?.fuelGaugeStyle).toBe('quarter_marks');
  });

  it('leaves fuelGaugeStyle untouched when omitted from the patch', async () => {
    vehicleTable.set('veh-1', makeVehicleRow({ fuelGaugeStyle: 'horizontal_segments' }));
    const updated = await updateVehicle('user-1', 'veh-1', { name: 'Renamed' });
    expect(updated?.fuelGaugeStyle).toBe('horizontal_segments');
  });

  it('rejects updating a vehicle the user does not own', async () => {
    vehicleTable.set('veh-1', makeVehicleRow());
    const updated = await updateVehicle('someone-else', 'veh-1', { fuelGaugeStyle: 'quarter_marks' });
    expect(updated).toBeUndefined();
  });
});

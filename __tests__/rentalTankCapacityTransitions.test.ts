/**
 * Part A / A1 (2026-10-02) — tank-capacity transitions and the "never derive
 * gallons without a tank" invariant, exercised SERVER-SIDE through the real
 * PATCH /api/rental-sessions/[id] route and the real lib/rentalSessions
 * domain layer (Prisma is an in-memory stand-in).
 *
 *   null  → value : derived values recomputed (a `full` target = capacity).
 *   value → value : gauge/percent rescale kept; a `full` target follows the
 *                   NEW capacity (previously only clamped — 14→18 stayed 14).
 *   value → null  : rejected while a gauge/percent reading exists (the model
 *                   stores no raw fraction independently of its gallons, so
 *                   clearing would silently discard a real observation);
 *                   otherwise capacity-derived gallons become null and
 *                   absolute gallons are kept.
 *   A gauge/percent reading is never accepted while capacity is unknown.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const table = new Map<string, Row>();
const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => (v === null ? row[k] == null : row[k] === v));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rentalSession: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => { for (const r of table.values()) if (matches(r, where)) return { ...r }; return null; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => { const r = table.get(where.id)!; Object.assign(r, data); return { ...r }; }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0; for (const r of table.values()) if (matches(r, where)) { Object.assign(r, data); count++; } return { count };
      }),
      create: vi.fn(async ({ data }: { data: Row }) => { table.set(data.id as string, { ...data, refuelLogs: [] }); return { ...data, refuelLogs: [] }; }),
    },
    vehicle: { findUnique: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/featureFlags', () => ({ RENTAL_RETURN_ASSISTANT_ENABLED: true }));
vi.mock('@/lib/rentalFillups', () => ({ getRentalFillups: vi.fn(async () => []) }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: vi.fn(async () => ({ outcome: 'recorded' })) }));

function seed(over: Row = {}): Row {
  const row: Row = {
    id: 'rs1', userId: 'u1', status: 'active', rentalCompany: 'Hertz',
    fuelTankCapacityGallons: 14,
    pickupFuelGallons: 7, pickupFuelSource: 'MANUAL_GAUGE',
    currentFuelGallons: 7, currentFuelSource: 'MANUAL_GAUGE', currentFuelUpdatedAt: '2026-10-01T00:00:00.000Z',
    requiredReturnFuelGallons: 7, requiredReturnPolicyType: 'same_as_pickup',
    pickupDateTime: null, returnDateTime: null, timeZone: null, pickupDateTimeUtc: null, returnDateTimeUtc: null,
    pickupTimeZone: null, returnTimeZone: null, pickupTimeZoneSource: null, returnTimeZoneSource: null,
    refuelLogs: [],
    ...over,
  };
  table.set('rs1', row);
  return row;
}

async function patch(body: Row) {
  const { PATCH } = await import('@/app/api/rental-sessions/[id]/route');
  const res = await PATCH(new NextRequest('https://www.gascap.app/api/rental-sessions/rs1', { method: 'PATCH', body: JSON.stringify(body) }), { params: { id: 'rs1' } });
  return { status: res.status, json: await res.json() as Row };
}
const row = () => table.get('rs1')!;

beforeEach(() => { table.clear(); });

describe('null → value', () => {
  it('a `full` return target becomes the newly entered capacity', async () => {
    seed({ fuelTankCapacityGallons: null, pickupFuelGallons: null, pickupFuelSource: null, currentFuelGallons: null, currentFuelSource: null,
           requiredReturnFuelGallons: null, requiredReturnPolicyType: 'full' });
    const r = await patch({ fuelTankCapacityGallons: 15 });
    expect(r.status).toBe(200);
    expect(row().requiredReturnFuelGallons).toBe(15);
  });
  it('absolute readings that fit are kept exactly; same-as-pickup target follows pickup', async () => {
    seed({ fuelTankCapacityGallons: null, pickupFuelGallons: 10, pickupFuelSource: 'MANUAL_GALLONS',
           currentFuelGallons: 9, currentFuelSource: 'RECEIPT', requiredReturnFuelGallons: 10 });
    await patch({ fuelTankCapacityGallons: 16 });
    expect([row().pickupFuelGallons, row().currentFuelGallons, row().requiredReturnFuelGallons]).toEqual([10, 9, 10]);
  });
});

describe('value → different value', () => {
  it('a `full` target follows the NEW capacity, up as well as down', async () => {
    seed({ requiredReturnPolicyType: 'full', requiredReturnFuelGallons: 14 });
    await patch({ fuelTankCapacityGallons: 18 });
    expect(row().requiredReturnFuelGallons).toBe(18);
    await patch({ fuelTankCapacityGallons: 12 });
    expect(row().requiredReturnFuelGallons).toBe(12);
  });
  it('gauge readings keep their observed fraction (existing behaviour)', async () => {
    seed();
    await patch({ fuelTankCapacityGallons: 18 });
    expect([row().pickupFuelGallons, row().currentFuelGallons, row().requiredReturnFuelGallons]).toEqual([9, 9, 9]);
  });
  it('an explicit target in the same request wins over reconciliation', async () => {
    seed({ requiredReturnPolicyType: 'exact', requiredReturnFuelGallons: 10 });
    await patch({ fuelTankCapacityGallons: 18, requiredReturnFuelGallons: 11 });
    expect(row().requiredReturnFuelGallons).toBe(11);
  });
});

describe('value → null', () => {
  it('REJECTED (422) while a gauge/percent reading exists; nothing is written', async () => {
    seed();
    const before = { ...row() };
    const r = await patch({ fuelTankCapacityGallons: null });
    expect(r.status).toBe(422);
    expect(r.json).toEqual({ error: 'tank_clear_would_discard_reading', field: 'fuelTankCapacityGallons' });
    expect(row()).toEqual(before);
  });
  it('a percent CURRENT reading alone also blocks it', async () => {
    seed({ pickupFuelGallons: 10, pickupFuelSource: 'MANUAL_GALLONS', currentFuelSource: 'MANUAL_PERCENT' });
    expect((await patch({ fuelTankCapacityGallons: null })).status).toBe(422);
  });
  it('with only absolute readings: capacity-derived values become null, absolute gallons are kept', async () => {
    seed({ pickupFuelGallons: 10, pickupFuelSource: 'MANUAL_GALLONS', currentFuelGallons: 8, currentFuelSource: 'RECEIPT',
           requiredReturnPolicyType: 'full', requiredReturnFuelGallons: 14 });
    const r = await patch({ fuelTankCapacityGallons: null });
    expect(r.status).toBe(200);
    expect([row().fuelTankCapacityGallons, row().requiredReturnFuelGallons, row().pickupFuelGallons, row().currentFuelGallons]).toEqual([null, null, 10, 8]);
  });
  it('same-as-pickup target stays the (absolute) pickup reading', async () => {
    seed({ pickupFuelGallons: 10, pickupFuelSource: 'MANUAL_GALLONS', currentFuelGallons: 8, currentFuelSource: 'RECEIPT', requiredReturnFuelGallons: 10 });
    await patch({ fuelTankCapacityGallons: null });
    expect(row().requiredReturnFuelGallons).toBe(10);
  });
  it('allowed when the same request replaces the gauge readings with absolute ones', async () => {
    seed();
    const r = await patch({ fuelTankCapacityGallons: null,
      pickupFuelGallons: 6, pickupFuelSource: 'MANUAL_GALLONS', currentFuelGallons: 6, currentFuelSource: 'MANUAL_GALLONS' });
    expect(r.status).toBe(200);
    expect([row().fuelTankCapacityGallons, row().pickupFuelGallons, row().currentFuelGallons]).toEqual([null, 6, 6]);
  });
});

describe('never derive gallons while capacity is unknown', () => {
  const noTank = { fuelTankCapacityGallons: null, pickupFuelGallons: null, pickupFuelSource: null,
                   currentFuelGallons: null, currentFuelSource: null, requiredReturnFuelGallons: null, currentFuelUpdatedAt: null };
  it.each(['MANUAL_GAUGE', 'MANUAL_PERCENT'])('a %s pickup reading is rejected (422) without a tank', async (src) => {
    seed(noTank);
    const r = await patch({ pickupFuelGallons: 7, pickupFuelSource: src });
    expect(r.status).toBe(422);
    expect(r.json).toEqual({ error: 'tank_capacity_required', field: 'pickupFuelGallons' });
    expect(row().pickupFuelGallons).toBeNull();
  });
  it('the current-fuel CONFIRM path enforces it too', async () => {
    seed(noTank);
    const r = await patch({ currentFuelGallons: 7, currentFuelSource: 'MANUAL_PERCENT',
      expectedPriorCurrentFuelGallons: null, expectedPriorCurrentFuelSource: null,
      expectedPriorCurrentFuelUpdatedAt: null, expectedPriorFuelTankCapacityGallons: null });
    expect(r.status).toBe(422);
    expect(row().currentFuelGallons).toBeNull();
  });
  it('an exact-gallons reading is fine without a tank (it never depended on one)', async () => {
    seed(noTank);
    expect((await patch({ pickupFuelGallons: 7, pickupFuelSource: 'MANUAL_GALLONS' })).status).toBe(200);
    expect(row().pickupFuelGallons).toBe(7);
  });
  it('a gauge reading sent together with the tank it was read against is accepted', async () => {
    seed(noTank);
    expect((await patch({ fuelTankCapacityGallons: 14, pickupFuelGallons: 7, pickupFuelSource: 'MANUAL_GAUGE' })).status).toBe(200);
  });
  it('create: a gauge/percent pickup without a tank is refused with 422', async () => {
    const { createRentalSession, RentalScheduleError } = await import('@/lib/rentalSessions');
    const err = await createRentalSession('u1', { rentalCompany: 'Hertz', pickupFuelGallons: 7, pickupFuelSource: 'MANUAL_GAUGE' }).catch((e) => e);
    expect(err).toBeInstanceOf(RentalScheduleError);
    expect([err.code, err.field, err.status]).toEqual(['tank_capacity_required', 'pickupFuelGallons', 422]);
  });
});

describe('tank capacity input validation', () => {
  it.each([0, -3, 'x', ''])('rejects %j with 400', async (v) => {
    seed();
    expect((await patch({ fuelTankCapacityGallons: v })).status).toBe(400);
    expect(row().fuelTankCapacityGallons).toBe(14);
  });
});

// Review fix (2026-10-02): an absolute observation is never silently clamped.
// GasCap knows a 15.2 gal reading and a 14 gal tank conflict, not which is
// wrong — so it refuses instead of rewriting the reading.
describe('absolute readings vs a new capacity — preserve or refuse, never clamp', () => {
  const absolute = { pickupFuelGallons: 15.2, pickupFuelSource: 'MANUAL_GALLONS', currentFuelGallons: 12, currentFuelSource: 'RECEIPT',
                     requiredReturnFuelGallons: 15.2 };
  it('null → value: an absolute pickup above the new tank → 422 on that field; nothing written', async () => {
    seed({ ...absolute, fuelTankCapacityGallons: null });
    const before = { ...row() };
    const r = await patch({ fuelTankCapacityGallons: 14 });
    expect(r.status).toBe(422);
    expect(r.json).toEqual({ error: 'fuel_reading_exceeds_tank_capacity', field: 'pickupFuelGallons' });
    expect(row()).toEqual(before);
  });
  it('value → smaller value: an absolute CURRENT reading above the new tank → 422', async () => {
    seed({ fuelTankCapacityGallons: 20, pickupFuelGallons: 10, pickupFuelSource: 'MANUAL_GALLONS',
           currentFuelGallons: 15.2, currentFuelSource: 'RECEIPT', requiredReturnFuelGallons: 10 });
    const r = await patch({ fuelTankCapacityGallons: 14 });
    expect(r.json).toEqual({ error: 'fuel_reading_exceeds_tank_capacity', field: 'currentFuelGallons' });
    expect(row().fuelTankCapacityGallons).toBe(20);
  });
  it('absolute readings within the new tank are preserved EXACTLY (no rounding, no rewrite)', async () => {
    seed({ fuelTankCapacityGallons: 20, pickupFuelGallons: 10.1234567, pickupFuelSource: 'MANUAL_GALLONS',
           currentFuelGallons: 9.87654321, currentFuelSource: 'RECEIPT', requiredReturnFuelGallons: 10.1234567 });
    expect((await patch({ fuelTankCapacityGallons: 14 })).status).toBe(200);
    expect([row().pickupFuelGallons, row().currentFuelGallons, row().requiredReturnFuelGallons]).toEqual([10.1234567, 9.87654321, 10.1234567]);
  });
  it('an explicit corrected reading sent WITH the new tank is accepted', async () => {
    seed({ ...absolute, fuelTankCapacityGallons: null });
    const r = await patch({ fuelTankCapacityGallons: 14, pickupFuelGallons: 13.5, pickupFuelSource: 'MANUAL_GALLONS' });
    expect(r.status).toBe(200);
    expect([row().fuelTankCapacityGallons, row().pickupFuelGallons, row().requiredReturnFuelGallons]).toEqual([14, 13.5, 13.5]);
  });
  it('an explicit reading still above the new tank is refused by the route (400), as before', async () => {
    seed({ ...absolute, fuelTankCapacityGallons: null });
    expect((await patch({ fuelTankCapacityGallons: 14, pickupFuelGallons: 15, pickupFuelSource: 'MANUAL_GALLONS' })).status).toBe(400);
  });
  it('gauge/percent readings still rescale with the tank (they are fractions, not observations in gallons)', async () => {
    seed({ fuelTankCapacityGallons: 20, pickupFuelGallons: 15, pickupFuelSource: 'MANUAL_GAUGE',
           currentFuelGallons: 15, currentFuelSource: 'MANUAL_PERCENT', requiredReturnFuelGallons: 15 });
    expect((await patch({ fuelTankCapacityGallons: 14 })).status).toBe(200);
    expect([row().pickupFuelGallons, row().currentFuelGallons, row().requiredReturnFuelGallons]).toEqual([10.5, 10.5, 10.5]);
  });
  it('an `exact` return target above a reduced tank → 422 on requiredReturnFuelGallons (not silently lowered)', async () => {
    seed({ fuelTankCapacityGallons: 20, pickupFuelGallons: 10, pickupFuelSource: 'MANUAL_GALLONS', currentFuelGallons: 10, currentFuelSource: 'MANUAL_GALLONS',
           requiredReturnPolicyType: 'exact', requiredReturnFuelGallons: 16 });
    const r = await patch({ fuelTankCapacityGallons: 14 });
    expect(r.json).toEqual({ error: 'fuel_reading_exceeds_tank_capacity', field: 'requiredReturnFuelGallons' });
    expect(row().requiredReturnFuelGallons).toBe(16);
  });
  it('an `exact` target that fits is preserved; an explicit new target with the new tank is accepted', async () => {
    seed({ fuelTankCapacityGallons: 20, pickupFuelGallons: 10, pickupFuelSource: 'MANUAL_GALLONS', currentFuelGallons: 10, currentFuelSource: 'MANUAL_GALLONS',
           requiredReturnPolicyType: 'exact', requiredReturnFuelGallons: 12.25 });
    await patch({ fuelTankCapacityGallons: 14 });
    expect(row().requiredReturnFuelGallons).toBe(12.25);
    row().requiredReturnFuelGallons = 16; row().fuelTankCapacityGallons = 20;
    expect((await patch({ fuelTankCapacityGallons: 14, requiredReturnFuelGallons: 13 })).status).toBe(200);
    expect(row().requiredReturnFuelGallons).toBe(13);
  });
});


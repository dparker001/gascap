/**
 * Phase 4 (2026-08-25) — route-level validation for fuelGaugeStyle on both
 * PATCH /api/vehicles and PATCH /api/rental-sessions/:id. Confirms invalid
 * values are rejected with 400, valid values pass through to the
 * persistence layer, and — critically — that a rental gauge-style change
 * never touches currentFuelGallons.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getServerSession = vi.fn(async () => ({ user: { id: 'user-1' } }) as unknown);
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/featureFlags', () => ({ RENTAL_RETURN_ASSISTANT_ENABLED: true }));

// ── Vehicles route ───────────────────────────────────────────────────────
const findById = vi.fn(async () => ({ plan: 'pro' }));
const getVehiclesForUser = vi.fn(async () => []);
const addVehicle = vi.fn(async () => ({}));
const deleteVehicle = vi.fn(async () => true);
const updateVehicle = vi.fn(async (..._a: unknown[]) => ({ id: 'veh-1', fuelGaugeStyle: 'quarter_marks' }));
const setDefaultVehicle = vi.fn(async () => ({}));
const clearDefaultVehicle = vi.fn(async () => ({}));
vi.mock('@/lib/savedVehicles', () => ({
  getVehiclesForUser: (...a: unknown[]) => getVehiclesForUser(...(a as [])),
  addVehicle: (...a: unknown[]) => addVehicle(...(a as [])),
  deleteVehicle: (...a: unknown[]) => deleteVehicle(...(a as [])),
  updateVehicle: (...a: unknown[]) => updateVehicle(...(a as [])),
  setDefaultVehicle: (...a: unknown[]) => setDefaultVehicle(...(a as [])),
  clearDefaultVehicle: (...a: unknown[]) => clearDefaultVehicle(...(a as [])),
}));
vi.mock('@/lib/users', () => ({ findById: (...a: unknown[]) => findById(...(a as [])) }));

async function patchVehicle(id: string, body: unknown) {
  const { PATCH } = await import('@/app/api/vehicles/route');
  const req = new Request(`https://www.gascap.app/api/vehicles?id=${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return PATCH(req);
}

// ── Rental sessions route ────────────────────────────────────────────────
const updateRentalSession = vi.fn(async (..._a: unknown[]) => ({ id: 'rs-1', fuelGaugeStyle: 'quarter_marks', currentFuelGallons: 6 }));
const getRentalSession = vi.fn(async () => ({ id: 'rs-1', vehicleId: null, currentFuelGallons: 6 }));
const deleteRentalSession = vi.fn(async () => true);
vi.mock('@/lib/rentalSessions', () => ({
  getRentalSession: (...a: unknown[]) => getRentalSession(...(a as [])),
  updateRentalSession: (...a: unknown[]) => updateRentalSession(...(a as [])),
  deleteRentalSession: (...a: unknown[]) => deleteRentalSession(...(a as [])),
}));
vi.mock('@/lib/rentalFillups', () => ({ getRentalFillups: vi.fn(async () => []) }));
vi.mock('@/lib/photoLimits', () => ({
  validateRentalPhotos: () => ({ ok: true }), photoCapKb: () => 500, PHOTO_MAX_DATA_URL_BYTES: 500_000,
}));
vi.mock('@/lib/prisma', () => ({ prisma: { vehicle: { findUnique: vi.fn(async () => null) } } }));

async function patchRental(id: string, body: unknown) {
  const { PATCH } = await import('@/app/api/rental-sessions/[id]/route');
  const req = new Request(`https://www.gascap.app/api/rental-sessions/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  // @ts-expect-error — NextRequest-compatible enough for this route's usage
  return PATCH(req, { params: { id } });
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
  findById.mockResolvedValue({ plan: 'pro' });
  updateVehicle.mockResolvedValue({ id: 'veh-1', fuelGaugeStyle: 'quarter_marks' });
  updateRentalSession.mockResolvedValue({ id: 'rs-1', fuelGaugeStyle: 'quarter_marks', currentFuelGallons: 6 });
  getRentalSession.mockResolvedValue({ id: 'rs-1', vehicleId: null, currentFuelGallons: 6 });
});

describe('PATCH /api/vehicles?id= — fuelGaugeStyle validation', () => {
  it('accepts a valid gauge style', async () => {
    const res = await patchVehicle('veh-1', { fuelGaugeStyle: 'quarter_marks' });
    expect(res.status).toBe(200);
    expect(updateVehicle).toHaveBeenCalledWith('user-1', 'veh-1', expect.objectContaining({ fuelGaugeStyle: 'quarter_marks' }));
  });

  it('rejects an invalid gauge style with 400', async () => {
    const res = await patchVehicle('veh-1', { fuelGaugeStyle: 'not_a_real_style' });
    expect(res.status).toBe(400);
    expect(updateVehicle).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/rental-sessions/:id — fuelGaugeStyle validation and persistence', () => {
  it('accepts a valid gauge style and persists it', async () => {
    const res = await patchRental('rs-1', { fuelGaugeStyle: 'quarter_marks' });
    expect(res.status).toBe(200);
    expect(updateRentalSession).toHaveBeenCalledWith('user-1', 'rs-1', expect.objectContaining({ fuelGaugeStyle: 'quarter_marks' }));
  });

  it('rejects an invalid gauge style with 400', async () => {
    const res = await patchRental('rs-1', { fuelGaugeStyle: 'not_a_real_style' });
    expect(res.status).toBe(400);
    expect(updateRentalSession).not.toHaveBeenCalled();
  });

  it('changing the rental gauge style does not change currentFuelGallons — the mock never receives a fuel field alongside the style change', async () => {
    await patchRental('rs-1', { fuelGaugeStyle: 'quarter_marks' });
    const call = updateRentalSession.mock.calls[0][2] as Record<string, unknown>;
    expect(call).not.toHaveProperty('currentFuelGallons');
    expect(call).not.toHaveProperty('pickupFuelGallons');
  });
});

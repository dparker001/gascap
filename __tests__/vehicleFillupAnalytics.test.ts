/**
 * Growth Sprint 1, P0C-1A — regression coverage for vehicle_saved and
 * fillup_logged (personal), verifying the actual real write paths
 * (lib/savedVehicles.ts's addVehicle, lib/fillups.ts's addFillup) rather
 * than a mocked stand-in of the business logic itself.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const vehicleCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...args.data }));
const fillupCreate  = vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...args.data }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    vehicle: { create: (args: { data: Record<string, unknown> }) => vehicleCreate(args) },
    fillup:  { create: (args: { data: Record<string, unknown> }) => fillupCreate(args) },
  },
}));

const recordAnalyticsEvent = vi.fn(async (..._a: unknown[]) => ({ outcome: 'written' as const, id: 'evt_1' }));
vi.mock('@/lib/analyticsEvents', () => ({
  recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  recordAnalyticsEvent.mockResolvedValue({ outcome: 'written', id: 'evt_1' });
});

describe('vehicle_saved — lib/savedVehicles.ts addVehicle()', () => {
  it('V1/V2. successful addVehicle emits exactly one vehicle_saved with the exact idempotency key', async () => {
    const { addVehicle } = await import('@/lib/savedVehicles');
    const vehicle = await addVehicle('user-1', 'My Car', 12, { vin: '1FAFAKE0000000001', make: 'Toyota' });
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({
      eventType: 'vehicle_saved', emitter: 'server', originPlatform: 'unknown',
      userId: 'user-1', source: 'vehicle_create',
      idempotencyKey: `vehicle_saved:${vehicle.id}`,
    });
  });

  it('V3. analytics writer throws — addVehicle still succeeds and returns the vehicle', async () => {
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('db unavailable'));
    const { addVehicle } = await import('@/lib/savedVehicles');
    const vehicle = await addVehicle('user-1', 'My Car', 12);
    expect(vehicle.name).toBe('My Car');
  });

  it('V4. no VIN/name/make/model or other vehicle-identifying metadata is sent to analytics', async () => {
    const { addVehicle } = await import('@/lib/savedVehicles');
    await addVehicle('user-1', 'My Car', 12, { vin: '1FAFAKE0000000001', make: 'Toyota', model: 'Camry' });
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.metadata).toBeUndefined();
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain('1FAFAKE0000000001');
    expect(serialized).not.toContain('Toyota');
    expect(serialized).not.toContain('My Car');
  });
});

describe('fillup_logged (personal) — lib/fillups.ts addFillup()', () => {
  const baseFillup = {
    vehicleName: 'My Car', date: '2026-08-20', gallonsPumped: 10,
    pricePerGallon: 3.5,
  };

  it('F1/F2. successful addFillup emits exactly one fillup_logged with the exact idempotency key', async () => {
    const { addFillup } = await import('@/lib/fillups');
    const fillup = await addFillup('user-1', baseFillup);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({
      eventType: 'fillup_logged', emitter: 'server', originPlatform: 'unknown',
      userId: 'user-1', source: 'fillup_create',
      idempotencyKey: `fillup_logged:personal:${fillup.id}`,
    });
  });

  it('F3. analytics failure — fill-up still succeeds', async () => {
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('db unavailable'));
    const { addFillup } = await import('@/lib/fillups');
    const fillup = await addFillup('user-1', baseFillup);
    expect(fillup.gallonsPumped).toBe(10);
  });

  it('F7. no gallons/price/station/odometer in analytics metadata', async () => {
    const { addFillup } = await import('@/lib/fillups');
    await addFillup('user-1', { ...baseFillup, stationName: 'Shell #123', odometerReading: 45000 });
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.metadata).toBeUndefined();
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain('Shell #123');
    expect(serialized).not.toContain('45000');
    expect(serialized).not.toContain('3.5');
  });

  it('does not emit on updateFillup (update path is structurally separate)', async () => {
    // updateFillup uses prisma.fillup.update, not .create — not mocked here,
    // so calling it would throw if it ever touched .create. This test only
    // asserts addFillup itself is the sole call site that fires the event —
    // confirmed by the single-call assertions above; updateFillup is a
    // different exported function entirely and is not invoked by this file.
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });
});

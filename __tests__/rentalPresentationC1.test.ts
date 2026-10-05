/** C1 — grouping and deterministic primary-rental selection. */
import { describe, it, expect } from 'vitest';
import { groupRentals, selectPrimaryRental, lifecycleOf } from '@/lib/rentalPresentation';
import type { RentalSession } from '@/lib/rentalSessions';

const H = 3_600_000;
const NOW = Date.parse('2026-10-10T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

let n = 0;
function rental(over: Partial<RentalSession> & { pickupOffsetH?: number; returnOffsetH?: number; setup?: boolean }): RentalSession {
  const { pickupOffsetH, returnOffsetH, setup = true, ...rest } = over;
  n += 1;
  const p = pickupOffsetH === undefined ? null : iso(NOW + pickupOffsetH * H);
  const r = returnOffsetH === undefined ? null : iso(NOW + returnOffsetH * H);
  return {
    id: `r${n}`, userId: 'u', vehicleId: null, provider: 'manual', status: 'active', rentalCompany: 'Hertz',
    rentalAgreementNumber: null, rentalConfirmationNumber: null,
    vehicleYear: null, vehicleMake: setup ? 'Toyota' : null, vehicleModel: setup ? 'Camry' : null, vehicleTrim: null,
    fuelTankCapacityGallons: setup ? 14 : null, pickupFuelGallons: setup ? 7 : null, pickupFuelSource: null,
    requiredReturnFuelGallons: null, requiredReturnPolicyType: null, currentFuelGallons: null, currentFuelSource: null,
    currentFuelUpdatedAt: null, rentalFuelChargePerGallon: null,
    pickupDateTime: null, returnDateTime: null, timeZone: null, pickupDateTimeUtc: p, returnDateTimeUtc: r,
    pickupTimeZone: null, returnTimeZone: null, pickupTimeZoneSource: null, returnTimeZoneSource: null,
    pickupLatitude: null, pickupLongitude: null, pickupLocation: null, returnLocation: null, returnLatitude: null, returnLongitude: null,
    pickupVehiclePhotoThumb: null, pickupGaugePhotoThumb: null, pickupAgreementPhotoThumb: null, returnGaugePhotoThumb: null, returnReceiptPhotoThumb: null,
    refuelLogs: [], fuelFeeCharged: null, fuelFeeAmount: null, fuelFeeGallonsClaimed: null, fuelFeeRentalReportedLevel: null,
    disputeNotes: null, feedbackRating: null, feedbackText: null, notes: null,
    reminderSentAt: null, pickupReminder24SentAt: null, pickupReminder2SentAt: null, returnReminder2SentAt: null,
    completedAt: null, fuelGaugeStyle: null, createdAt: `2026-10-0${(n % 9) + 1}T00:00:00Z`, updatedAt: '2026-10-01T00:00:00Z',
    ...rest,
  } as RentalSession;
}

describe('groupRentals', () => {
  const upcoming = rental({ pickupOffsetH: 48, returnOffsetH: 120 });
  const atPickup = rental({ pickupOffsetH: 1, returnOffsetH: 73, setup: false });
  const active   = rental({ pickupOffsetH: -24, returnOffsetH: 100 });
  const overdue  = rental({ pickupOffsetH: -72, returnOffsetH: -2 });
  const stale    = rental({ pickupOffsetH: -300, returnOffsetH: -100 });
  const broken   = rental({ pickupOffsetH: 10, returnOffsetH: 5 });
  const done     = rental({ pickupOffsetH: -300, returnOffsetH: -100, status: 'completed' });
  const g = groupRentals([upcoming, atPickup, active, overdue, stale, broken, done], NOW);
  it('splits into In Progress / Upcoming / Needs attention and drops closed rentals', () => {
    expect(g.upcoming.map((s) => s.id)).toEqual([upcoming.id]);
    expect(g.inProgress.map((s) => s.id).sort()).toEqual([atPickup.id, active.id, overdue.id].sort());
    expect(g.attention.map((s) => s.id).sort()).toEqual([stale.id, broken.id].sort());
    expect(g.atPickup.map((s) => s.id)).toEqual([atPickup.id]);
  });
  it('stale and needs_schedule are never in In Progress', () => {
    expect(g.inProgress.some((s) => [stale.id, broken.id].includes(s.id))).toBe(false);
  });
});

describe('selectPrimaryRental', () => {
  it('priority overdue > pickup > near_return > active > upcoming', () => {
    const upcoming = rental({ pickupOffsetH: 48, returnOffsetH: 120 });
    const active   = rental({ pickupOffsetH: -24, returnOffsetH: 100 });
    const near     = rental({ pickupOffsetH: -24, returnOffsetH: 10 });
    const atPickup = rental({ pickupOffsetH: 1, returnOffsetH: 73, setup: false });
    const overdue  = rental({ pickupOffsetH: -72, returnOffsetH: -2 });
    const order = [upcoming, active, near, atPickup, overdue];
    expect(selectPrimaryRental(order, NOW)!.id).toBe(overdue.id);
    expect(selectPrimaryRental([upcoming, active, near, atPickup], NOW)!.id).toBe(atPickup.id);
    expect(selectPrimaryRental([upcoming, active, near], NOW)!.id).toBe(near.id);
    expect(selectPrimaryRental([upcoming, active], NOW)!.id).toBe(active.id);
    expect(selectPrimaryRental([upcoming], NOW)!.id).toBe(upcoming.id);
  });
  it('excludes stale, needs_schedule, completed and cancelled; null when nothing qualifies', () => {
    const stale = rental({ pickupOffsetH: -300, returnOffsetH: -100 });
    const broken = rental({ pickupOffsetH: 10, returnOffsetH: 5 });
    const cancelled = rental({ pickupOffsetH: -5, returnOffsetH: 40, status: 'cancelled' });
    expect(selectPrimaryRental([stale, broken, cancelled], NOW)).toBeNull();
    expect(selectPrimaryRental([], NOW)).toBeNull();
    const ok = rental({ pickupOffsetH: -24, returnOffsetH: 100 });
    expect(selectPrimaryRental([stale, broken, ok], NOW)!.id).toBe(ok.id);
  });
  it('ties: earliest return for overdue/near_return, earliest pickup otherwise — independent of row order', () => {
    const o1 = rental({ pickupOffsetH: -80, returnOffsetH: -10 });
    const o2 = rental({ pickupOffsetH: -80, returnOffsetH: -3 });
    expect(selectPrimaryRental([o2, o1], NOW)!.id).toBe(o1.id);
    expect(selectPrimaryRental([o1, o2], NOW)!.id).toBe(o1.id);
    const u1 = rental({ pickupOffsetH: 30, returnOffsetH: 100 });
    const u2 = rental({ pickupOffsetH: 60, returnOffsetH: 100 });
    expect(selectPrimaryRental([u2, u1], NOW)!.id).toBe(u1.id);
  });
  it('full ties fall back to newest createdAt then id (never to array order)', () => {
    const a = rental({ pickupOffsetH: 30, returnOffsetH: 100, createdAt: '2026-10-05T00:00:00Z' });
    const b = rental({ pickupOffsetH: 30, returnOffsetH: 100, createdAt: '2026-10-07T00:00:00Z' });
    expect(selectPrimaryRental([a, b], NOW)!.id).toBe(b.id);
    expect(selectPrimaryRental([b, a], NOW)!.id).toBe(b.id);
    const c = rental({ id: 'aaa', pickupOffsetH: 30, returnOffsetH: 100, createdAt: '2026-10-09T00:00:00Z' });
    const d = rental({ id: 'bbb', pickupOffsetH: 30, returnOffsetH: 100, createdAt: '2026-10-09T00:00:00Z' });
    expect(selectPrimaryRental([d, c], NOW)!.id).toBe('aaa');
  });
  it('unknown times sort last within a priority', () => {
    const known = rental({ pickupOffsetH: -24, returnOffsetH: 100 });
    const noPickup = rental({ returnOffsetH: 100 });
    expect(selectPrimaryRental([noPickup, known], NOW)!.id).toBe(known.id);
  });
});

describe('lifecycleOf uses the session setup state', () => {
  it('a bare quick-save inside the pickup window is pickup; a fully set up one is upcoming', () => {
    expect(lifecycleOf(rental({ pickupOffsetH: 1, returnOffsetH: 73, setup: false }), NOW)).toBe('pickup');
    expect(lifecycleOf(rental({ pickupOffsetH: 1, returnOffsetH: 73, setup: true }), NOW)).toBe('upcoming');
  });
});

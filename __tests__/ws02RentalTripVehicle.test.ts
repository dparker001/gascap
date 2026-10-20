/**
 * WS02 Phase 1C — Trip Planner reuses the active rental's real vehicle.
 *
 * Old behaviour this regresses against: components/TripCostEstimator.tsx's
 * rental mode offered ONLY RENTAL_PRESETS — class averages such as
 * "Midsize SUV, 24 mpg, 19 gal" — while an open RentalSession already held
 * this car's year/make/model and its actual tank size. `legacyRentalOptions`
 * reproduces that option list; the first test asserts the renter's own car
 * was not in it.
 *
 * The trust rules under test: the tank size is confirmed data from the
 * rental record, MPG is never on RentalSession and is never invented here,
 * and a rental with nothing useful falls back to the generic presets.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  rentalTripVehicleFrom, rentalTripVehicleFor, RENTAL_TANK_MAX_GALLONS,
} from '@/lib/rentalTripVehicle';
import type { RentalSession } from '@/lib/rentalSessions';

const read = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const H   = 3_600_000;
const NOW = Date.parse('2026-10-20T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

let n = 0;
function rental(over: Partial<RentalSession> & { pickupOffsetH?: number; returnOffsetH?: number } = {}): RentalSession {
  const { pickupOffsetH = -24, returnOffsetH = 100, ...rest } = over;
  n += 1;
  return {
    id: `r${n}`, userId: 'u', vehicleId: null, provider: 'manual', status: 'active', rentalCompany: 'Hertz',
    rentalAgreementNumber: null, rentalConfirmationNumber: null,
    vehicleYear: '2024', vehicleMake: 'Toyota', vehicleModel: 'Camry', vehicleTrim: 'SE',
    fuelTankCapacityGallons: 15.8, pickupFuelGallons: 7, pickupFuelSource: null,
    requiredReturnFuelGallons: null, requiredReturnPolicyType: null, currentFuelGallons: null, currentFuelSource: null,
    currentFuelUpdatedAt: null, rentalFuelChargePerGallon: null,
    pickupDateTime: null, returnDateTime: null, timeZone: null,
    pickupDateTimeUtc: iso(NOW + pickupOffsetH * H), returnDateTimeUtc: iso(NOW + returnOffsetH * H),
    pickupTimeZone: null, returnTimeZone: null, pickupTimeZoneSource: null, returnTimeZoneSource: null,
    pickupLatitude: null, pickupLongitude: null, pickupLocation: null, returnLocation: null,
    returnLatitude: null, returnLongitude: null,
    pickupVehiclePhotoThumb: null, pickupGaugePhotoThumb: null, pickupAgreementPhotoThumb: null,
    returnGaugePhotoThumb: null, returnReceiptPhotoThumb: null,
    refuelLogs: [], fuelFeeCharged: null, fuelFeeAmount: null, fuelFeeGallonsClaimed: null,
    fuelFeeRentalReportedLevel: null,
    disputeNotes: null, feedbackRating: null, feedbackText: null, notes: null,
    reminderSentAt: null, pickupReminder24SentAt: null, pickupReminder2SentAt: null, returnReminder2SentAt: null,
    completedAt: null, fuelGaugeStyle: null,
    createdAt: `2026-10-0${(n % 9) + 1}T00:00:00Z`, updatedAt: '2026-10-01T00:00:00Z',
    ...rest,
  } as RentalSession;
}

/** The only vehicle choices rental mode offered before this change. */
const legacyRentalOptions = [
  'Compact Car', 'Midsize Car', 'Full-size Car', 'Small SUV', 'Midsize SUV',
  'Large SUV', 'Minivan', 'Pickup (Half-ton)', 'Pickup (Full-ton)', 'Hybrid Car', 'Enter manually',
];

describe('WS02 1C — the gap being closed', () => {
  const active = rental();

  it('old behaviour: the renter s own car was not an option, only class averages', () => {
    expect(legacyRentalOptions).not.toContain('2024 Toyota Camry');
    expect(legacyRentalOptions.some((o) => o.includes('rental') || o.includes('Camry'))).toBe(false);
  });

  it('new behaviour: the active rental yields its real vehicle and confirmed tank', () => {
    expect(rentalTripVehicleFor([active], NOW)).toEqual({
      sessionId: active.id,
      label: '2024 Toyota Camry',
      year: '2024', make: 'Toyota', model: 'Camry', trim: 'SE',
      tankGallons: 15.8,
      tankSource: 'rental_record',
      mpgLookup: { year: '2024', make: 'Toyota', model: 'Camry' },
    });
  });

  it('Trip Planner wires it in without touching the presets', () => {
    const src = read('components/TripCostEstimator.tsx');
    expect(src).toMatch(/rentalTripVehicleFor\(/);
    expect(src).toMatch(/ACTIVE_RENTAL_OPTION/);
    expect(src).toMatch(/\/api\/rental-sessions\?status=active/);
    // The generic presets are still all there, unchanged.
    for (const p of legacyRentalOptions) expect(src, p).toContain(`'${p}'`);
  });
});

describe('rentalTripVehicleFrom — only what the record actually says', () => {
  it('no rental: nothing', () => {
    expect(rentalTripVehicleFrom(null)).toBeNull();
    expect(rentalTripVehicleFrom(undefined)).toBeNull();
  });

  it('a rental with no vehicle identity and no tank falls back to presets', () => {
    expect(rentalTripVehicleFrom(rental({
      vehicleYear: null, vehicleMake: null, vehicleModel: null, fuelTankCapacityGallons: null,
    }))).toBeNull();
  });

  it('tank size only: offered, with no MPG lookup invented from a partial name', () => {
    const v = rentalTripVehicleFrom(rental({
      vehicleYear: '2024', vehicleMake: 'Toyota', vehicleModel: null, fuelTankCapacityGallons: 15.8,
    }))!;
    expect(v.tankGallons).toBe(15.8);
    expect(v.tankSource).toBe('rental_record');
    expect(v.mpgLookup).toBeNull();
    expect(v.label).toBe('2024 Toyota');
  });

  it('identity only: offered for an EPA estimate, with tank left genuinely unknown', () => {
    const v = rentalTripVehicleFrom(rental({ fuelTankCapacityGallons: null }))!;
    expect(v.tankGallons).toBeNull();
    expect(v.tankSource).toBeNull();
    expect(v.mpgLookup).toEqual({ year: '2024', make: 'Toyota', model: 'Camry' });
  });

  it('MPG is never a field on the result — it can only come from an EPA lookup', () => {
    expect(rentalTripVehicleFrom(rental())).not.toHaveProperty('mpg');
  });

  it('blank and whitespace-only strings are not vehicle data', () => {
    expect(rentalTripVehicleFrom(rental({
      vehicleYear: '  ', vehicleMake: '', vehicleModel: '   ', vehicleTrim: ' ',
      fuelTankCapacityGallons: null,
    }))).toBeNull();
  });

  it('an implausible tank size is discarded, not passed through', () => {
    for (const tank of [0, -5, NaN, Infinity, RENTAL_TANK_MAX_GALLONS + 1]) {
      const v = rentalTripVehicleFrom(rental({ fuelTankCapacityGallons: tank }))!;
      expect(v.tankGallons, String(tank)).toBeNull();
      expect(v.tankSource, String(tank)).toBeNull();
    }
    expect(rentalTripVehicleFrom(rental({ fuelTankCapacityGallons: RENTAL_TANK_MAX_GALLONS }))!.tankGallons)
      .toBe(RENTAL_TANK_MAX_GALLONS);
  });

  it('the label falls back to the rental company, then a generic name — never blank', () => {
    expect(rentalTripVehicleFrom(rental({
      vehicleYear: null, vehicleMake: null, vehicleModel: null, rentalCompany: 'Avis',
    }))!.label).toBe('Avis');
    expect(rentalTripVehicleFrom(rental({
      vehicleYear: null, vehicleMake: null, vehicleModel: null, rentalCompany: '   ',
    }))!.label).toBe('Rental car');
  });
});

describe('rentalTripVehicleFor — which rental, and when none', () => {
  it('no sessions: nothing', () => {
    expect(rentalTripVehicleFor([], NOW)).toBeNull();
    expect(rentalTripVehicleFor(null, NOW)).toBeNull();
    expect(rentalTripVehicleFor(undefined, NOW)).toBeNull();
  });

  it('closed rentals are never offered', () => {
    expect(rentalTripVehicleFor([rental({ status: 'completed' })], NOW)).toBeNull();
    expect(rentalTripVehicleFor([rental({ status: 'cancelled' })], NOW)).toBeNull();
  });

  it('a rental with a broken schedule is never offered', () => {
    // Return before pickup — needs_schedule, excluded by selectPrimaryRental.
    expect(rentalTripVehicleFor([rental({ pickupOffsetH: 48, returnOffsetH: 10 })], NOW)).toBeNull();
  });

  it('an upcoming rental is offered — planning a trip before pickup is the point', () => {
    const upcoming = rental({ pickupOffsetH: 48, returnOffsetH: 120 });
    expect(rentalTripVehicleFor([upcoming], NOW)!.sessionId).toBe(upcoming.id);
  });

  it('with several open rentals it agrees with the shared primary-rental choice', () => {
    const upcoming = rental({ pickupOffsetH: 48,  returnOffsetH: 120, vehicleModel: 'Corolla' });
    const overdue  = rental({ pickupOffsetH: -72, returnOffsetH: -2,  vehicleModel: 'Tacoma'  });
    const active   = rental({ pickupOffsetH: -24, returnOffsetH: 100, vehicleModel: 'Camry'   });
    // overdue outranks active, which outranks upcoming.
    expect(rentalTripVehicleFor([upcoming, active, overdue], NOW)!.model).toBe('Tacoma');
    // …and the answer does not depend on the order rows came back in.
    expect(rentalTripVehicleFor([overdue, upcoming, active], NOW)!.model).toBe('Tacoma');
  });
});

describe('user overrides and provenance are preserved in the UI wiring', () => {
  const src = read('components/TripCostEstimator.tsx');

  it('the rental is offered once, and only into an untouched rental form', () => {
    expect(src).toMatch(/if \(rentalAutoAppliedRef\.current\) return;/);
    expect(src).toMatch(/if \(rentalType !== '' \|\| mpg !== '' \|\| tankGal !== ''\) return;/);
  });

  it('a hand-edited tank size stops claiming to come from the rental record', () => {
    expect(src).toMatch(/setTankGal\(e\.target\.value\); setTankFromRental\(false\)/);
  });

  it('the confirmed tank and the estimated MPG are labelled differently', () => {
    expect(src).toMatch(/tankFromRentalRecord/);       // "from your rental record"
    expect(src).toMatch(/epaEstimateForVehicle\(rental\.label\)/);
  });

  it('a late response for another account is dropped', () => {
    expect(src).toMatch(/if \(!open \|\| !rentalUserId\)/);
    expect(src).toMatch(/if \(cancelled \|\| !d\) return;/);
  });

  it('both languages carry the new copy', () => {
    const tr = read('lib/translations.ts');
    for (const key of ['yourRentalOption', 'tankFromRentalRecord']) {
      expect(tr.split(new RegExp(`\\b${key}:`)).length - 1, key).toBe(2);
    }
  });
});

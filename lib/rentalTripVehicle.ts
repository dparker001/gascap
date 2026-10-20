/**
 * Reuse an active rental's real vehicle in Trip Planner
 * (Workstream 02 Phase 1C, 2026-10-20).
 *
 * Trip Planner's rental mode offered only RENTAL_PRESETS — "Midsize SUV,
 * 24 mpg, 19 gal" — even while a RentalSession in the database held the
 * actual year/make/model and the actual tank size the renter (or the
 * agreement photo scan) had already entered. The renter re-described
 * their own car to a generic bucket.
 *
 * What this module does and deliberately does not do:
 *
 *  - Tank size comes from the rental record and is CONFIRMED data:
 *    somebody entered or scanned it for this specific car.
 *  - MPG is NOT on RentalSession and is never invented here. When
 *    year/make/model are all present the caller may look up an EPA
 *    estimate through the same `/api/mpg-lookup` the garage path uses,
 *    and it is labelled an estimate. Absent that, MPG stays empty and
 *    the renter types it.
 *  - A rental with neither a usable tank size nor enough identity for an
 *    EPA lookup yields null, and the generic presets stay in charge.
 *
 * "Which rental" is not decided here: it reuses selectPrimaryRental()
 * from lib/rentalPresentation.ts, the existing deterministic choice
 * (overdue > pickup > near_return > active > upcoming, excluding stale /
 * needs_schedule / completed / cancelled), so Trip Planner cannot
 * disagree with the calculator banner about which rental is current.
 */
import { selectPrimaryRental } from './rentalPresentation';
import type { RentalSession }   from './rentalSessions';

/** Per-field provenance, so the UI never presents an estimate as confirmed. */
export type RentalTripFieldSource =
  /** Entered or scanned for this exact rental car. */
  | 'rental_record'
  /** Derived from the car's identity by EPA lookup — an estimate. */
  | 'epa_estimate';

export interface RentalTripVehicle {
  sessionId:   string;
  /** "2024 Toyota Camry", falling back to the rental company. Never blank. */
  label:       string;
  year:        string | null;
  make:        string | null;
  model:       string | null;
  trim:        string | null;
  /** Confirmed tank size from the rental record, or null. */
  tankGallons: number | null;
  tankSource:  Extract<RentalTripFieldSource, 'rental_record'> | null;
  /**
   * Enough identity to ask /api/mpg-lookup for an EPA estimate, or null
   * when the rental record doesn't carry a full year/make/model. MPG
   * itself is never guessed here.
   */
  mpgLookup:   { year: string; make: string; model: string } | null;
}

/** Largest tank size treated as a real reading rather than a typo. */
export const RENTAL_TANK_MAX_GALLONS = 200;

function cleanText(v: string | null | undefined): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
}

function cleanTank(v: number | null | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v <= 0 || v > RENTAL_TANK_MAX_GALLONS) return null;
  return v;
}

/**
 * Map one rental session to the vehicle data Trip Planner can use, or
 * null when it carries nothing more useful than a generic preset.
 */
export function rentalTripVehicleFrom(session: RentalSession | null | undefined): RentalTripVehicle | null {
  if (!session) return null;

  const year  = cleanText(session.vehicleYear);
  const make  = cleanText(session.vehicleMake);
  const model = cleanText(session.vehicleModel);
  const trim  = cleanText(session.vehicleTrim);
  const tank  = cleanTank(session.fuelTankCapacityGallons);

  const mpgLookup = year && make && model ? { year, make, model } : null;

  // Nothing to offer over a preset — say so instead of producing an
  // "unknown vehicle, unknown tank" option the renter can select.
  if (tank === null && mpgLookup === null) return null;

  const label = [year, make, model].filter(Boolean).join(' ')
    || cleanText(session.rentalCompany)
    || 'Rental car';

  return {
    sessionId:   session.id,
    label,
    year, make, model, trim,
    tankGallons: tank,
    tankSource:  tank !== null ? 'rental_record' : null,
    mpgLookup,
  };
}

/**
 * The rental vehicle Trip Planner should offer, chosen from the user's
 * open rentals by the shared primary-rental rule.
 */
export function rentalTripVehicleFor(
  sessions: readonly RentalSession[] | null | undefined,
  now:      number = Date.now(),
): RentalTripVehicle | null {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  return rentalTripVehicleFrom(selectPrimaryRental(sessions as RentalSession[], now));
}

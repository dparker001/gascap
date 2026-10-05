/**
 * C1 — soft duplicate detection for a rental about to be created. Pure and
 * deliberately conservative: it only ever WARNS (the server answers
 * 409 possible_duplicate and the renter chooses), never merges or blocks.
 *
 * A match is an existing ACTIVE rental of the same user where either:
 *  - company AND confirmation number match (normalized), or
 *  - the company matches, the pickups are within ±36h, and the confirmation
 *    numbers do not CONFLICT (both present and different = different booking).
 * The pickup-window rule needs a known UTC instant on BOTH sides (a naive
 * local time is never guessed into an instant) and ignores existing rentals
 * whose schedule is malformed (classifyRentalSchedule !== 'ok').
 */
import { classifyRentalSchedule } from './rentalCalculations';

export const DUPLICATE_PICKUP_WINDOW_HOURS = 36;

export const normalizeCompany = (v: unknown): string =>
  typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '';

export const normalizeConfirmation = (v: unknown): string =>
  typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

export interface DuplicateCandidate {
  rentalCompany: string;
  rentalConfirmationNumber?: string | null;
  /** Server-derived UTC instant of the new rental's pickup, or null if unknown. */
  pickupDateTimeUtc: string | null;
}

export interface ExistingRentalForDuplicate {
  id: string;
  rentalCompany: string;
  rentalConfirmationNumber: string | null;
  pickupDateTime: string | null; returnDateTime: string | null;
  pickupDateTimeUtc: string | null; returnDateTimeUtc: string | null;
  pickupTimeZone: string | null; returnTimeZone: string | null; timeZone: string | null;
}

export interface DuplicateMatch { rentalId: string; matchedOn: 'confirmation' | 'pickup_window' }

export function findPossibleDuplicate(
  candidate: DuplicateCandidate, existing: ExistingRentalForDuplicate[],
): DuplicateMatch | null {
  const company = normalizeCompany(candidate.rentalCompany);
  if (!company) return null;
  const conf = normalizeConfirmation(candidate.rentalConfirmationNumber);
  const candMs = candidate.pickupDateTimeUtc ? Date.parse(candidate.pickupDateTimeUtc) : NaN;

  let windowMatch: { id: string; delta: number } | null = null;
  for (const r of existing) {
    if (normalizeCompany(r.rentalCompany) !== company) continue;
    const rConf = normalizeConfirmation(r.rentalConfirmationNumber);
    if (conf && rConf) {
      if (conf === rConf) return { rentalId: r.id, matchedOn: 'confirmation' };
      continue; // both present and different → a different booking, even if close in time
    }
    if (!Number.isFinite(candMs) || !r.pickupDateTimeUtc) continue;
    if (classifyRentalSchedule(r) !== 'ok') continue;
    const rMs = Date.parse(r.pickupDateTimeUtc);
    if (!Number.isFinite(rMs)) continue;
    const delta = Math.abs(rMs - candMs);
    if (delta <= DUPLICATE_PICKUP_WINDOW_HOURS * 3_600_000 && (!windowMatch || delta < windowMatch.delta)) {
      windowMatch = { id: r.id, delta };
    }
  }
  return windowMatch ? { rentalId: windowMatch.id, matchedOn: 'pickup_window' } : null;
}

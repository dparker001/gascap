/**
 * Entitlement exceptions tied to a rental's real-world timeframe.
 *
 * CLAUDE.md: "An active rental must remain fully usable if Pro lapses
 * mid-rental. Gate *starting* a rental, never finishing one." The exception
 * is bounded by TIME, not just by status: status stays 'active' for a rental
 * booked in advance (not picked up yet) and for one that was never marked
 * complete, and neither should keep a lapsed user's paid features forever.
 * (ChatGPT review of PR #55, 2026-09-30.)
 *
 *   window = pickup <= now <= scheduled return + RENTAL_RETURN_GRACE_HOURS
 *
 * - Uses the UTC instants (pickupDateTimeUtc / returnDateTimeUtc), which
 *   PATCH /api/rental-sessions/:id recomputes on edit — extending a rental
 *   extends the window.
 * - No pickup time → treated as already started (the set-it-up-at-the-counter
 *   case), matching isUpcomingRental() and the rentals list.
 * - No usable return time → no window (fail closed: normal Pro rules apply).
 *   Return time is required by the setup UI, so this is rare (rows written
 *   before the 2026-08-25 UTC fix, or no browser timezone).
 * - Completed / cancelled → never inside the window.
 */
import { isUpcomingRental } from '@/lib/rentalCalculations';

export const RENTAL_RETURN_GRACE_HOURS = 24;

export interface RentalWindowInput {
  status:            string;
  pickupDateTimeUtc: string | null | undefined;
  returnDateTimeUtc: string | null | undefined;
}

export function isWithinRentalWindow(rental: RentalWindowInput, now: number = Date.now()): boolean {
  if (rental.status !== 'active') return false;
  const returnMs = rental.returnDateTimeUtc ? new Date(rental.returnDateTimeUtc).getTime() : NaN;
  if (!Number.isFinite(returnMs)) return false;
  if (isUpcomingRental(rental.pickupDateTimeUtc, now)) return false;
  return now <= returnMs + RENTAL_RETURN_GRACE_HOURS * 3_600_000;
}

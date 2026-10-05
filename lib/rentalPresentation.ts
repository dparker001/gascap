/**
 * C1 — pure helpers over the derived lifecycle (lib/rentalCalculations.ts):
 * grouping for My Rentals / the calculator banner, and the deterministic
 * "primary rental" choice. Nothing here reads or writes the database.
 * Design: docs/RENTAL_CALENDAR_DISCOVERY_DESIGN.md Rev 2 §3.4 / Rev 3 §2.2.
 */
import {
  resolveRentalLifecycle, rentalLifecycleInput, rentalEventInstant, type RentalLifecycle,
} from './rentalCalculations';
import type { RentalSession } from './rentalSessions';

/** The lifecycle of a stored session, with its setup state and zones included. */
export function lifecycleOf(s: RentalSession, now: number = Date.now()): RentalLifecycle {
  return resolveRentalLifecycle(rentalLifecycleInput(s, now));
}

export interface RentalGroups {
  /** pickup / active / near_return / overdue — a car the renter is holding or collecting. */
  inProgress: RentalSession[];
  upcoming:   RentalSession[];
  /** stale + needs_schedule — never promoted to banners, auto-open or "primary". */
  attention:  RentalSession[];
  /** Subset of inProgress in the 'pickup' state. */
  atPickup:   RentalSession[];
}

export function groupRentals(sessions: RentalSession[], now: number = Date.now()): RentalGroups {
  const g: RentalGroups = { inProgress: [], upcoming: [], attention: [], atPickup: [] };
  for (const s of sessions) {
    switch (lifecycleOf(s, now)) {
      case 'upcoming': g.upcoming.push(s); break;
      case 'pickup': g.atPickup.push(s); g.inProgress.push(s); break;
      case 'active': case 'near_return': case 'overdue': g.inProgress.push(s); break;
      case 'stale': case 'needs_schedule': g.attention.push(s); break;
      default: break; // completed / cancelled — not an open rental
    }
  }
  return g;
}

/** Higher number = higher priority. */
const PRIORITY: Partial<Record<RentalLifecycle, number>> = {
  overdue: 5, pickup: 4, near_return: 3, active: 2, upcoming: 1,
};

function sortInstant(s: RentalSession, lifecycle: RentalLifecycle): number {
  // Return time for the return-driven states, pickup otherwise. Unknown → last.
  const iso = lifecycle === 'overdue' || lifecycle === 'near_return'
    ? rentalEventInstant(s.returnDateTimeUtc, s.returnDateTime)
    : rentalEventInstant(s.pickupDateTimeUtc, s.pickupDateTime);
  const ms = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/**
 * The one rental to surface. overdue > pickup > near_return > active >
 * upcoming; stale, needs_schedule, completed and cancelled are excluded.
 * Ties: earliest relevant instant, then newest created, then id — so the
 * answer never depends on the order the server happened to return rows.
 */
export function selectPrimaryRental(sessions: RentalSession[], now: number = Date.now()): RentalSession | null {
  const ranked = sessions
    .map((s) => ({ s, lc: lifecycleOf(s, now) }))
    .filter((x) => PRIORITY[x.lc] !== undefined);
  if (ranked.length === 0) return null;
  ranked.sort((a, b) => {
    const p = PRIORITY[b.lc]! - PRIORITY[a.lc]!;
    if (p !== 0) return p;
    const t = sortInstant(a.s, a.lc) - sortInstant(b.s, b.lc);
    if (t !== 0 && !Number.isNaN(t)) return t;
    if (a.s.createdAt !== b.s.createdAt) return a.s.createdAt < b.s.createdAt ? 1 : -1;
    return a.s.id < b.s.id ? -1 : 1;
  });
  return ranked[0].s;
}

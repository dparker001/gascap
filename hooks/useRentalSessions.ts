'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { RentalSession } from '@/lib/rentalSessions';
import { isUpcomingRental as isUpcomingAt, rentalEventInstant } from '@/lib/rentalCalculations';
import { groupRentals, selectPrimaryRental } from '@/lib/rentalPresentation';
import { useRentalClock } from './useRentalClock';
import { EMPTY_SCOPED, isLoadingFor, sessionsForUser, startRentalSessionsLoad, type ScopedSessions } from '@/lib/rentalSessionsScope';
import { syncRentalFallbacksFromSessions } from '@/lib/rentalReminderSync';

/**
 * The signed-in user's open rentals, split into in-progress and upcoming.
 *
 * "Upcoming" is not a database status — a rental's status is 'active' from
 * the moment it's created, and whether it has actually started is derived
 * from pickupDateTime. The previous hook ignored that and returned
 * sessions[0], so it reported a single arbitrary rental as "active": with two
 * open rentals it named whichever was created last, and it called a rental
 * "active" that nobody had picked up yet.
 *
 * Returns the whole picture instead, so callers can describe the real state
 * rather than guess from one row.
 */

export function isUpcomingRental(s: RentalSession): boolean {
  // UTC instant when present (2026-10-02) — not the viewer's reading of the wall clock.
  return isUpcomingAt(rentalEventInstant(s.pickupDateTimeUtc, s.pickupDateTime));
}

export interface RentalSessionsState {
  /** Rentals the user is holding or collecting: pickup, active, near return, overdue. */
  inProgress: RentalSession[];
  /** Booked, pickup still ahead. */
  upcoming: RentalSession[];
  /** Stale or with an untrustworthy schedule — never promoted to a banner or "primary". */
  attention: RentalSession[];
  /** Subset of inProgress that is at pickup right now. */
  atPickup: RentalSession[];
  /** Everything open, newest first. */
  all: RentalSession[];
  /**
   * The one rental to surface (lib/rentalPresentation.ts selectPrimaryRental):
   * overdue > pickup > near return > active > upcoming, ties broken by the
   * earliest relevant instant — deterministic, independent of row order.
   */
  primary: RentalSession | null;
  loading: boolean;
}

export function useRentalSessions(): RentalSessionsState {
  const { status, data: authSession } = useSession();
  const authUserId = (authSession?.user as { id?: string } | undefined)?.id ?? null;
  const authenticated = status === 'authenticated' && !!authUserId;
  // The data remembers WHICH account it belongs to; it is exposed only to that account.
  const [scoped, setScoped] = useState<ScopedSessions>(EMPTY_SCOPED);
  const all = sessionsForUser(scoped, authenticated ? authUserId : null);
  const loading = status === 'loading' || isLoadingFor(scoped, authenticated, authUserId);
  // Re-derives the groups at lifecycle boundaries and on resume (no polling/network).
  const clock = useRentalClock(all);

  useEffect(() => {
    // Logout / unauthenticated: drop everything. Account switch: the previous
    // account's data is dropped now and its in-flight request is cancelled below.
    setScoped(EMPTY_SCOPED);
    if (!authenticated || !authUserId) return;
    return startRentalSessionsLoad(authUserId, (url, init) => fetch(url, init), (next) => {
      setScoped(next);
      // App-open re-sync of this device's return fallbacks (Option C).
      void syncRentalFallbacksFromSessions(authUserId, next.sessions);
    });
  }, [authenticated, authUserId]);

  return useMemo(() => {
    const now = clock;
    const g = groupRentals(all, now);
    return {
      inProgress: g.inProgress,
      upcoming:   g.upcoming,
      attention:  g.attention,
      atPickup:   g.atPickup,
      all,
      primary: selectPrimaryRental(all, now),
      loading,
    };
  }, [scoped, authenticated, authUserId, loading, clock]);
}

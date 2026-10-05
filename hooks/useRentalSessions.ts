'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { RentalSession } from '@/lib/rentalSessions';
import { isUpcomingRental as isUpcomingAt, rentalEventInstant } from '@/lib/rentalCalculations';
import { groupRentals, selectPrimaryRental } from '@/lib/rentalPresentation';
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
  const authUserId = (authSession?.user as { id?: string } | undefined)?.id;
  const [all, setAll] = useState<RentalSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== 'authenticated') { setLoading(false); return; }
    fetch('/api/rental-sessions?status=active')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { sessions?: RentalSession[] } | null) => {
        setAll(d?.sessions ?? []);
        // App-open re-sync of this device's return fallbacks (Option C).
        void syncRentalFallbacksFromSessions(authUserId, d?.sessions ?? []);
      })
      .finally(() => setLoading(false));
  }, [status]);

  return useMemo(() => {
    const now = Date.now();
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
  }, [all, loading]);
}

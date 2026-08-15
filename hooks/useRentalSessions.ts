'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { RentalSession } from '@/lib/rentalSessions';
import { isUpcomingRental as isUpcomingAt } from '@/lib/rentalCalculations';

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
  return isUpcomingAt(s.pickupDateTime);
}

export interface RentalSessionsState {
  /** Rentals the user is currently holding a car for. */
  inProgress: RentalSession[];
  /** Booked, pickup still in the future. */
  upcoming: RentalSession[];
  /** Everything open, newest first. */
  all: RentalSession[];
  /**
   * The one to open when tapping through. An in-progress rental outranks an
   * upcoming one — that's the car the user is actually responsible for. Among
   * upcoming rentals, the soonest pickup wins.
   */
  primary: RentalSession | null;
  loading: boolean;
}

export function useRentalSessions(): RentalSessionsState {
  const { status } = useSession();
  const [all, setAll] = useState<RentalSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== 'authenticated') { setLoading(false); return; }
    fetch('/api/rental-sessions?status=active')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { sessions?: RentalSession[] } | null) => setAll(d?.sessions ?? []))
      .finally(() => setLoading(false));
  }, [status]);

  return useMemo(() => {
    const upcoming   = all.filter(isUpcomingRental);
    const inProgress = all.filter((s) => !isUpcomingRental(s));

    const soonest = [...upcoming].sort((a, b) =>
      new Date(a.pickupDateTime!).getTime() - new Date(b.pickupDateTime!).getTime());

    return {
      inProgress,
      upcoming,
      all,
      primary: inProgress[0] ?? soonest[0] ?? null,
      loading,
    };
  }, [all, loading]);
}

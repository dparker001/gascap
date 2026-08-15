'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { RentalSession } from '@/lib/rentalSessions';

/**
 * Whether the signed-in user currently has an active Rental Return
 * Assistant session — drives the calculator's "Rental Car Mode" toggle so
 * it reflects real status (does the user actually have a rental in
 * progress?) rather than a client-side flag that can drift from reality.
 */
export function useActiveRentalSession() {
  const { status } = useSession();
  const [session, setSession] = useState<RentalSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== 'authenticated') { setLoading(false); return; }
    fetch('/api/rental-sessions?status=active')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { sessions?: RentalSession[] } | null) => {
        if (d?.sessions && d.sessions.length > 0) setSession(d.sessions[0]);
      })
      .finally(() => setLoading(false));
  }, [status]);

  return { activeSession: session, loading };
}

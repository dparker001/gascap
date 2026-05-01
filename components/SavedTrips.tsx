'use client';

/**
 * SavedTrips — shows the user's saved trip calculations.
 *
 * Pro/Fleet: full access — view details, delete trips.
 * Free (post-trial): trips are visible but detail is locked; upgrade prompt shown.
 * Not signed in: renders nothing.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSession }                       from 'next-auth/react';
import Link                                 from 'next/link';
import { getPlanTier }                      from '@/lib/featureAccess';
import type { SavedTrip }                   from '@/lib/savedTrips';

export default function SavedTrips() {
  const { data: session } = useSession();
  const plan    = getPlanTier((session?.user as { plan?: string } | null) ?? null);
  const canView = plan === 'pro' || plan === 'fleet';

  const [trips,           setTrips]           = useState<SavedTrip[]>([]);
  const [loading,         setLoading]         = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting,        setDeleting]        = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const res = await fetch('/api/trips');
      if (res.ok) {
        const data = await res.json() as { trips: SavedTrip[] };
        setTrips(data.trips ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  async function handleDelete(id: string) {
    setDeleting(true);
    await fetch(`/api/trips?id=${id}`, { method: 'DELETE' });
    setPendingDeleteId(null);
    setDeleting(false);
    void load();
  }

  // Don't render if not signed in, still loading first paint, or no trips saved
  if (!session) return null;
  if (!loading && trips.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-50">
        <div className="flex items-center gap-2">
          <span className="text-base">🗺️</span>
          <p className="text-xs font-black uppercase tracking-widest text-slate-600">Saved Trips</p>
        </div>
        <span className="text-[10px] text-slate-400">
          {loading ? '…' : `${trips.length} trip${trips.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Trip list */}
      {!loading && (
        <div className="divide-y divide-slate-50">
          {trips.map((trip) => {
            const dateStr   = new Date(trip.savedAt).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
            });
            const isLocked  = !canView;
            const isPending = pendingDeleteId === trip.id;

            return (
              <div
                key={trip.id}
                className={`px-4 py-3 transition-colors ${isPending ? 'bg-red-50' : ''}`}
              >
                {isPending ? (
                  /* Inline delete confirmation */
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-red-700">Remove this saved trip?</p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setPendingDeleteId(null)}
                        className="text-[11px] font-bold text-slate-500 hover:text-slate-700 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleDelete(trip.id)}
                        disabled={deleting}
                        className="text-[11px] font-bold text-white bg-red-500 hover:bg-red-600
                                   disabled:opacity-50 px-3 py-1 rounded-lg transition-colors"
                      >
                        {deleting ? '…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">

                      {/* Lock badge for free users */}
                      {isLocked && (
                        <div className="flex items-center gap-1 mb-1">
                          <span className="text-[9px]">🔒</span>
                          <span className="text-[9px] font-black text-amber-600 uppercase tracking-wide">
                            Pro required
                          </span>
                        </div>
                      )}

                      {/* Route or distance label */}
                      {trip.origin && trip.destination ? (
                        <p className="text-sm font-bold text-slate-700 truncate">
                          {trip.origin} → {trip.destination}
                        </p>
                      ) : (
                        <p className="text-sm font-bold text-slate-700">
                          {trip.distanceMiles.toLocaleString(undefined, { maximumFractionDigits: 0 })} mi trip
                        </p>
                      )}

                      {/* Key stats row */}
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="text-[11px] text-slate-500">
                          {trip.distanceMiles.toLocaleString(undefined, { maximumFractionDigits: 0 })} mi
                        </span>
                        {isLocked ? (
                          <span className="text-[11px] font-bold text-amber-500">$•••</span>
                        ) : (
                          <span className="text-[11px] font-bold text-amber-600">
                            ${trip.fuelCost.toFixed(2)} fuel cost
                          </span>
                        )}
                        {trip.stops > 0 && !isLocked && (
                          <span className="text-[11px] text-slate-400">
                            {trip.stops} stop{trip.stops !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      <p className="text-[10px] text-slate-400 mt-0.5">{dateStr}</p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 flex-shrink-0 mt-0.5">
                      {isLocked ? (
                        <Link
                          href="/upgrade"
                          className="text-[11px] font-black text-amber-600 hover:underline whitespace-nowrap"
                        >
                          Upgrade →
                        </Link>
                      ) : (
                        <button
                          onClick={() => setPendingDeleteId(trip.id)}
                          className="text-slate-300 hover:text-red-400 transition-colors"
                          aria-label={`Delete saved trip`}
                        >
                          <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none"
                               stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <path d="M1 1l10 10M11 1L1 11" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Upgrade footer for locked users who have trips */}
      {!canView && trips.length > 0 && (
        <div className="px-4 py-3 bg-amber-50 border-t border-amber-100">
          <p className="text-xs text-amber-700 font-medium leading-snug">
            Your saved trips are locked.{' '}
            <Link href="/upgrade" className="font-black underline">
              Upgrade to Pro
            </Link>{' '}
            to access your full trip history.
          </p>
        </div>
      )}
    </div>
  );
}

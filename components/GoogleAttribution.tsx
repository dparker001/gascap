'use client';

/**
 * Required attribution for displaying Google Places/Maps content (address
 * predictions, resolved place data) outside of an actual Google Map.
 * Phase 2 (2026-10-11): added when wiring session tokens for the Trip
 * Planner's address autocomplete, after finding this attribution was
 * missing from every existing autocomplete consumer (TripCostEstimator,
 * the Rental Return return-location picker) — a pre-existing gap, not
 * something those features introduced.
 */
export default function GoogleAttribution() {
  return (
    <p className="text-[10px] text-slate-400 px-3 py-1">
      Powered by Google
    </p>
  );
}

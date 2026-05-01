'use client';

import { useSession }                                   from 'next-auth/react';
import { buildGoogleMapsUrl, type GoogleMapsUrlOptions } from '@/lib/googleMaps';
import { gtagEvent, fbTrack }                            from '@/lib/gtag';
import { getPlanTier }                                   from '@/lib/featureAccess';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GoogleMapsButtonMode =
  | 'target_fill'
  | 'budget'
  | 'rental_return'
  | 'trip'
  | 'station_result'
  | 'unknown';

interface CalculationData {
  /** Estimated gallons to add — do NOT include vehicle/user identifiers */
  gallonsNeeded?:   number;
  estimatedCost?:   number;
  gasPrice?:        number;
  targetLevel?:     number;
  tripDistance?:    number;
  stationName?:     string;
  stationSelected?: boolean;
}

export interface GoogleMapsHandoffButtonProps
  extends Omit<GoogleMapsUrlOptions, 'mode'> {
  /** Calculation context — drives default label and analytics */
  mode?: GoogleMapsButtonMode;
  /** 'search' | 'directions' — passed to buildGoogleMapsUrl as its mode */
  mapMode?: GoogleMapsUrlOptions['mode'];
  /** Override the auto-generated label */
  label?: string;
  /** Optional calc data for enriched analytics (no PII) */
  calculationData?: CalculationData;
  /** Extra Tailwind classes */
  className?: string;
}

// ── Default labels ────────────────────────────────────────────────────────────

const DEFAULT_LABELS: Record<GoogleMapsButtonMode, string> = {
  target_fill:    'Open Google Maps to Find Gas Nearby',
  budget:         'Open Google Maps to Find Gas Nearby',
  rental_return:  'Find a Fuel Stop Before Return',
  trip:           'Find Fuel Along the Way',
  station_result: 'Open This Station in Google Maps',
  unknown:        'Open Google Maps to Find Gas Nearby',
};

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Tappable button that opens Google Maps to find nearby gas stations or
 * navigate to a selected station. Always rendered — works without coords
 * (Google Maps uses device GPS for "near me" searches).
 *
 * Place this BEFORE WazeDeepLinkButton in the nav handoff row.
 */
export default function GoogleMapsHandoffButton({
  mode = 'unknown',
  mapMode,
  label,
  calculationData,
  className = '',
  ...urlOptions
}: GoogleMapsHandoffButtonProps) {
  const { data: session } = useSession();
  const plan = getPlanTier((session?.user as { plan?: string } | null) ?? null);

  const url          = buildGoogleMapsUrl({ ...urlOptions, mode: mapMode });
  const displayLabel = label ?? DEFAULT_LABELS[mode];
  const hasCoords    = urlOptions.latitude != null && urlOptions.longitude != null;
  const stationSel   = !!(urlOptions.destinationLat || urlOptions.destination);

  function handleClick() {
    // GA4 event with full context — no PII
    gtagEvent('google_maps_open_clicked', {
      mode,
      source_screen:     mode,
      station_selected:  stationSel,
      station_name:      calculationData?.stationName     ?? '',
      has_coordinates:   hasCoords,
      gallons_needed:    calculationData?.gallonsNeeded   ?? 0,
      estimated_cost:    calculationData?.estimatedCost   ?? 0,
      gas_price:         calculationData?.gasPrice        ?? 0,
      target_level:      calculationData?.targetLevel     ?? 0,
      trip_distance:     calculationData?.tripDistance    ?? 0,
      user_plan:         plan,
      feature_locked:    false,
      upgrade_prompt_shown: false,
    });

    // Meta Pixel custom event
    fbTrack('GoogleMapsButtonClicked', {
      mode,
      has_coordinates: hasCoords,
    });
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={[
        'flex items-center justify-center gap-2.5 w-full',
        'rounded-2xl border-2 border-[#4285F4]/30 bg-[#4285F4]/10',
        'px-4 py-3 text-sm font-bold text-[#1a73e8]',
        'hover:bg-[#4285F4]/20 hover:border-[#4285F4]/60',
        'active:scale-[0.98] transition-all',
        className,
      ].join(' ')}
      aria-label={`${displayLabel} — opens Google Maps`}
    >
      {/* Google Maps pin icon */}
      <svg
        viewBox="0 0 24 24"
        className="w-5 h-5 flex-shrink-0"
        aria-hidden="true"
      >
        <path
          d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
          fill="#4285F4"
        />
        <circle cx="12" cy="9" r="2.5" fill="white" />
      </svg>

      <span>{displayLabel}</span>

      {/* External link indicator */}
      <svg
        className="w-3.5 h-3.5 opacity-50 flex-shrink-0"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3" />
        <path d="M10 2h4v4" />
        <line x1="14" y1="2" x2="7" y2="9" />
      </svg>
    </a>
  );
}

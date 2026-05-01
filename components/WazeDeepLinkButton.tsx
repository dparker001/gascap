'use client';

import { buildWazeDeepLink } from '@/lib/waze';

interface WazeDeepLinkButtonProps {
  latitude?: number | null;
  longitude?: number | null;
  /** Override the default "Find a Gas Station" label */
  label?: string;
  /** Passed through to buildWazeDeepLink — defaults to "gas station" */
  query?: string;
  /** Extra Tailwind classes for the outer wrapper */
  className?: string;
}

/**
 * A tappable button that opens Waze and searches for a nearby gas station.
 * Always rendered — works without coords (Waze will use the user's GPS).
 */
export default function WazeDeepLinkButton({
  latitude,
  longitude,
  label = 'Find a Gas Station',
  query = 'gas station',
  className = '',
}: WazeDeepLinkButtonProps) {
  const url = buildWazeDeepLink({ latitude, longitude, query });

  function handleClick() {
    // Fire optional Meta Pixel custom event (pixel may not be present in all envs)
    if (typeof window !== 'undefined' && typeof (window as Window & { fbq?: Function }).fbq === 'function') {
      (window as Window & { fbq?: Function }).fbq!('trackCustom', 'WazeButtonClicked', {
        has_coords: latitude != null && longitude != null,
      });
    }
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={[
        'flex items-center justify-center gap-2.5 w-full',
        'rounded-2xl border-2 border-[#05c8f0]/40 bg-[#05c8f0]/10',
        'px-4 py-3 text-sm font-bold text-[#007cba]',
        'hover:bg-[#05c8f0]/20 hover:border-[#05c8f0]/70',
        'active:scale-[0.98] transition-all',
        className,
      ].join(' ')}
      aria-label={`Open Waze to ${label.toLowerCase()}`}
    >
      {/* Waze logo mark — the iconic winking face outline */}
      <svg
        viewBox="0 0 32 32"
        className="w-5 h-5 flex-shrink-0"
        aria-hidden="true"
        fill="none"
      >
        {/* Body */}
        <ellipse cx="16" cy="17" rx="13" ry="12" fill="#33CCFF" />
        {/* Right eye */}
        <circle cx="12" cy="14" r="2" fill="#fff" />
        <circle cx="12.7" cy="14.4" r="1" fill="#1a1a1a" />
        {/* Left eye (winking — closed) */}
        <path d="M18.5 13.5 Q20 12.5 21.5 13.5" stroke="#1a1a1a" strokeWidth="1.6"
          strokeLinecap="round" fill="none" />
        {/* Smile */}
        <path d="M11 19 Q16 23 21 19" stroke="#1a1a1a" strokeWidth="1.6"
          strokeLinecap="round" fill="none" />
        {/* Antenna */}
        <line x1="22" y1="7" x2="24" y2="3" stroke="#1a1a1a" strokeWidth="1.8"
          strokeLinecap="round" />
        <circle cx="24.5" cy="2.5" r="1.5" fill="#FF9500" />
      </svg>

      <span>{label}</span>

      {/* Subtle external link icon */}
      <svg className="w-3.5 h-3.5 opacity-50 flex-shrink-0" viewBox="0 0 16 16"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        aria-hidden="true">
        <path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3" />
        <path d="M10 2h4v4" />
        <line x1="14" y1="2" x2="7" y2="9" />
      </svg>
    </a>
  );
}

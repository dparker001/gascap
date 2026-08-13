/**
 * Shared "neon glow" icon tile for marketing/landing pages — a dark
 * brand-green tile with a glowing brand-orange line icon, matching the
 * illustration style already established in the /download share image
 * (public/og-image-download.png: neon fuel-gauge icon on brand.dark).
 * Meant to be the one consistent graphic language across /rewards,
 * /rental, /download, /ambassador, etc. rather than one-off emoji/icons.
 */

export type GlowIconName =
  | 'star' | 'trophy' | 'diamond' | 'crown' | 'gift'
  | 'hotel' | 'dining' | 'handshake' | 'pump' | 'coin';

const PATHS: Record<GlowIconName, string> = {
  star:      'M12 3l2.4 5.9 6.3.5-4.8 4.1 1.5 6.2L12 16.6 6.6 19.7l1.5-6.2-4.8-4.1 6.3-.5L12 3z',
  trophy:    'M7 4h10v3a5 5 0 01-5 5 5 5 0 01-5-5V4z M7 5H4a3 3 0 003 3 M17 5h3a3 3 0 01-3 3 M12 12v3 M9 19h6 M9 19c0-1.5.6-2.5 1.5-3h3c.9.5 1.5 1.5 1.5 3',
  diamond:   'M6 9l3-5h6l3 5-6 11-6-11z M6 9h12 M9 4l1.5 5L9 9 M15 4l-1.5 5L15 9',
  crown:     'M4 18h16 M4 18l-1.5-9L8 12l4-7 4 7 5.5-3L20 18 M4 18v1h16v-1',
  gift:      'M4 9h16v4H4z M6 13v7h12v-7 M12 9V5.5a2 2 0 10-2 2H12 M12 9V5.5a2 2 0 112 2H12',
  hotel:     'M3 20V6l5-2v16 M8 20V10h9a3 3 0 013 3v7 M3 20h20 M5.5 9h1 M5.5 12h1 M5.5 15h1 M11.5 13.5h2v2h-2z',
  dining:    'M7 3v7a2 2 0 002 2 2 2 0 002-2V3 M9 3v18 M17 3c-1.5 0-2.5 1.5-2.5 4v3c0 1.2.7 2 1.5 2v9',
  handshake: 'M3 11l4-4 4 3 2-2 4 4-3 3-1-1-3 3-1-1-3 3-3-3 4-4',
  pump:      'M6 21V8a2 2 0 012-2h4a2 2 0 012 2v13 M4 21h10 M14 9h2l3 3v6a1.5 1.5 0 01-3 0v-3h-2 M7 5h4',
  coin:      'M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v10 M9.5 9.5c0-1 1-1.8 2.5-1.8s2.5.8 2.5 1.8-1 1.5-2.5 1.8-2.5.8-2.5 1.9 1 1.8 2.5 1.8 2.5-.8 2.5-1.8',
};

export function GlowIcon({
  name,
  size = 56,
  className = '',
}: {
  name: GlowIconName;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`flex-shrink-0 rounded-2xl flex items-center justify-center ${className}`}
      style={{
        width:  size,
        height: size,
        background: 'radial-gradient(circle at 30% 25%, #0a7a5f 0%, #00402f 70%, #002e21 100%)',
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="#FF8300"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ width: size * 0.52, height: size * 0.52, filter: 'drop-shadow(0 0 4px rgba(255,131,0,0.75))' }}
      >
        <path d={PATHS[name]} />
      </svg>
    </div>
  );
}

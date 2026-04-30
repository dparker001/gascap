'use client';

// ── EndorserMarquee ────────────────────────────────────────────────────────────
//
// A slow auto-scrolling strip of endorser / partner logos shown on the guest
// landing page below the hero section to build credibility.
//
// HOW TO ADD A REAL LOGO:
//   1. Upload the logo file to /public/logos/<filename>.png  (recommended: SVG or
//      transparent-background PNG, ~200×80px or similar horizontal format)
//   2. In the ENDORSERS array below, update the matching placeholder entry:
//      • Set `logo` to the public path:  logo: '/logos/shell.svg'
//      • Set `isPlaceholder` to false:   isPlaceholder: false
//      • Update `name` to the real business name
//   That's it — the card will automatically switch from the placeholder pill to
//   a real logo image on the next deploy.
//
// HOW TO ADD A NEW PARTNER:
//   Append a new object to the ENDORSERS array (see the shape below).
//   The marquee duplicates the array for a seamless infinite loop, so any count
//   of items works fine — though 6–10 fills the strip nicely.

interface Endorser {
  id: string;
  name: string;          // Business / brand name
  category: string;      // Short descriptor shown under placeholder pills
  icon: string;          // Emoji used in placeholder mode only
  logo: string | null;   // Public path to logo image, or null if not yet received
  isPlaceholder: boolean;
}

// ── Partner / endorser list ──────────────────────────────────────────────────
//
// All entries start as isPlaceholder:true until a real logo is received.
// The category names match the target location types from the Field Ambassador
// program so the marquee visually communicates who GasCap™ partners with.

const ENDORSERS: Endorser[] = [
  { id: 'gs-1',   name: 'Gas Station',         category: 'Fuel & Convenience', icon: '⛽', logo: null, isPlaceholder: true },
  { id: 'oc-1',   name: 'Oil Change Shop',      category: 'Quick Lube',         icon: '🛢️', logo: null, isPlaceholder: true },
  { id: 'tc-1',   name: 'Tire Center',          category: 'Tires & Wheels',     icon: '🔩', logo: null, isPlaceholder: true },
  { id: 'cw-1',   name: 'Car Wash',             category: 'Auto Detailing',     icon: '🚗', logo: null, isPlaceholder: true },
  { id: 'ms-1',   name: 'Mechanic Shop',        category: 'Auto Repair',        icon: '🔧', logo: null, isPlaceholder: true },
  { id: 'cs-1',   name: 'Convenience Store',    category: 'C-Store & Fuel',     icon: '🏪', logo: null, isPlaceholder: true },
  { id: 'ucl-1',  name: 'Used Car Lot',         category: 'Pre-Owned Vehicles', icon: '🚙', logo: null, isPlaceholder: true },
  { id: 'gs-2',   name: 'Gas Station',          category: 'Fuel & Convenience', icon: '⛽', logo: null, isPlaceholder: true },
];

// ── Placeholder card ─────────────────────────────────────────────────────────

function PlaceholderCard({ endorser }: { endorser: Endorser }) {
  return (
    <div
      className="flex-shrink-0 flex flex-col items-center justify-center gap-1
                 w-[110px] h-[60px] mx-3 rounded-xl
                 border-2 border-dashed border-slate-200 bg-white
                 opacity-60"
      title={`Partner slot — ${endorser.category}`}
      aria-label={`${endorser.category} partner slot`}
    >
      <span className="text-lg leading-none" aria-hidden="true">{endorser.icon}</span>
      <span className="text-[9px] font-semibold text-slate-400 text-center leading-tight px-1">
        {endorser.category}
      </span>
    </div>
  );
}

// ── Real logo card ───────────────────────────────────────────────────────────

function LogoCard({ endorser }: { endorser: Endorser }) {
  return (
    <div
      className="flex-shrink-0 flex items-center justify-center
                 w-[120px] h-[60px] mx-3 rounded-xl
                 bg-white border border-slate-100 shadow-sm px-3"
      aria-label={endorser.name}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={endorser.logo!}
        alt={endorser.name}
        className="max-h-[40px] max-w-[100px] object-contain grayscale hover:grayscale-0 transition-all"
      />
    </div>
  );
}

// ── Marquee track ────────────────────────────────────────────────────────────

function LogoTrack({ endorsers }: { endorsers: Endorser[] }) {
  // Duplicate for seamless infinite loop (same technique as ReviewsMarquee)
  const doubled = [...endorsers, ...endorsers];
  return (
    <div className="flex marquee-track-logos" style={{ width: 'max-content' }}>
      {doubled.map((e, i) =>
        e.isPlaceholder
          ? <PlaceholderCard key={`${e.id}-${i}`} endorser={e} />
          : <LogoCard        key={`${e.id}-${i}`} endorser={e} />
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function EndorserMarquee() {
  // Count how many real logos we have (for display logic)
  const realCount = ENDORSERS.filter((e) => !e.isPlaceholder).length;

  // Always render the marquee — placeholders keep the strip active until real
  // logos arrive, so the feature is never "dormant" from the visitor's POV.
  return (
    <section
      aria-label="Trusted by drivers at these local businesses"
      className="w-full py-4 overflow-hidden bg-slate-50/80 border-y border-slate-100"
    >
      {/* Label */}
      <p className="text-center text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-3 px-4">
        {realCount > 0 ? 'Trusted by drivers at' : 'Partnering with local businesses'}
      </p>

      {/* Scrolling strip */}
      <div className="marquee-root select-none overflow-hidden">
        <LogoTrack endorsers={ENDORSERS} />
      </div>
    </section>
  );
}

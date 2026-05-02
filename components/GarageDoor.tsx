'use client';

/**
 * GarageDoor — Pro-only animated garage door overlay
 *
 * Wraps the garage vehicles section with a decorative door that opens when
 * the section scrolls into view (IntersectionObserver). The door remains open
 * for the rest of the session (sessionStorage flag), so switching tabs or
 * scrolling away and back doesn't trigger the animation again.
 *
 * For non-Pro users the component is a transparent pass-through.
 *
 * Door styles:  Classic · Modern · Wood · Steel
 * Open directions: Roll Up · Slide Left · Slide Right
 *
 * Vehicle silhouettes: up to 3 vehicle-type-matched SVG silhouettes are
 * etched onto the door panel, inferred from each vehicle's name / make / model.
 */

import { useRef, useState, useEffect, type ReactNode } from 'react';
import type { DoorStyle, DoorDirection } from '@/hooks/useGarageDoorPrefs';

export type { DoorStyle, DoorDirection };

// ── Display labels (used by the settings UI) ─────────────────────────────────

export const DOOR_STYLE_LABELS: Record<DoorStyle, string> = {
  classic: 'Classic',
  modern:  'Modern',
  wood:    'Wood',
  steel:   'Steel',
};

export const DOOR_DIRECTION_LABELS: Record<DoorDirection, string> = {
  'roll-up':    '↑ Roll Up',
  'slide-left': '← Slide Left',
  'slide-right': '→ Slide Right',
};

// ── Vehicle silhouettes ───────────────────────────────────────────────────────

/** Minimal vehicle info needed to pick a silhouette type */
export interface VehicleInfo {
  name:   string;
  make?:  string;
  model?: string;
}

type VehicleType = 'sedan' | 'suv' | 'truck' | 'van';

/** Infer a vehicle body type from name / make / model keywords */
function detectVehicleType(v: VehicleInfo): VehicleType {
  const text = [v.name, v.make, v.model]
    .filter(Boolean).join(' ').toLowerCase();

  if (/\b(truck|pickup|f-?150|f-?250|f-?350|silverado|sierra|ram\b|tundra|tacoma|frontier|ridgeline|colorado|canyon|ranger|maverick|gladiator|titan)\b/.test(text))
    return 'truck';

  if (/\b(van|minivan|caravan|odyssey|sienna|pacifica|transit|express|savana|voyager|town.?country)\b/.test(text))
    return 'van';

  if (/\b(suv|crossover|explorer|expedition|tahoe|suburban|yukon|escalade|4runner|highlander|rav4|cr-?v|cx-?[0-9]|pilot|traverse|equinox|edge|escape|rogue|murano|pathfinder|armada|sequoia|land.?cruiser|wrangler|compass|cherokee|durango|terrain|blazer|bronco|defender|range.?rover|navigator|santa.?fe|tucson|sportage|telluride|palisade|atlas|tiguan|passport|4wd|awd|4x4)\b/.test(text))
    return 'suv';

  return 'sedan';
}

/**
 * SVG path data for each vehicle type.
 * viewBox "0 0 100 40" — wheels are cubic-bezier arches cut from the bottom.
 * Paths face LEFT (front of vehicle on left side).
 */
const VEHICLE_PATHS: Record<VehicleType, string> = {
  // 3-box sedan: sloped hood, defined roofline, short trunk
  sedan:
    'M4,34 L4,24 L16,13 L28,10 L72,10 L84,13 L96,24 L96,34 ' +
    'L88,34 C88,26 72,26 72,34 ' +
    'L28,34 C28,26 12,26 12,34 Z',

  // SUV / crossover: taller, boxier, higher roofline
  suv:
    'M4,34 L4,20 L11,10 L22,7 L78,7 L89,10 L96,20 L96,34 ' +
    'L88,34 C88,26 72,26 72,34 ' +
    'L28,34 C28,26 12,26 12,34 Z',

  // Pickup truck: sloped cab on left, flat low bed on right, 3 wheel arches
  truck:
    'M4,34 L4,22 L10,11 Q16,8 22,8 L56,8 L58,14 L96,14 L96,34 ' +
    'L88,34 C88,26 72,26 72,34 ' +
    'L28,34 C28,26 12,26 12,34 Z',

  // Van / minivan: very tall, near-vertical sides, curved rear top
  van:
    'M4,34 L4,14 L9,8 L18,6 L76,6 L85,10 L93,18 L96,24 L96,34 ' +
    'L88,34 C88,26 72,26 72,34 ' +
    'L28,34 C28,26 12,26 12,34 Z',
};

// ── Style configs ─────────────────────────────────────────────────────────────

interface StyleConfig {
  panelBg:           string;
  panelBorder:       string;
  handleBg:          string;
  handle:            string;
  trackBg:           string;
  labelColor:        string;
  silhouetteFill:    string;   // fill color for vehicle silhouettes
  silhouetteOpacity: number;   // opacity for vehicle silhouettes
  gradient?:         (i: number) => string;
}

const STYLE_CONFIGS: Record<DoorStyle, StyleConfig> = {
  classic: {
    panelBg:           '#F5F0E8',
    panelBorder:       '#D9D1C4',
    handleBg:          '#C8BFB4',
    handle:            '#8C7B6E',
    trackBg:           '#9C9490',
    labelColor:        'text-stone-400',
    silhouetteFill:    '#7A6A5E',
    silhouetteOpacity: 0.22,
  },
  modern: {
    panelBg:           '#2D3142',
    panelBorder:       '#3D4256',
    handleBg:          '#4D5262',
    handle:            '#6C7280',
    trackBg:           '#1D2132',
    labelColor:        'text-slate-500',
    silhouetteFill:    '#FFFFFF',
    silhouetteOpacity: 0.18,
  },
  wood: {
    panelBg:           '#8B5E3C',
    panelBorder:       '#6B4A2E',
    handleBg:          '#A0714E',
    handle:            '#5C3A1E',
    trackBg:           '#4A2E18',
    labelColor:        'text-amber-200/40',
    silhouetteFill:    '#2A1408',
    silhouetteOpacity: 0.22,
    gradient: (i) =>
      i % 2 === 0
        ? 'linear-gradient(to bottom, #9B6E4C 0%, #7B4E2C 50%, #8B5E3C 100%)'
        : 'linear-gradient(to bottom, #8B5E3C 0%, #6B4A2E 50%, #9B6E4C 100%)',
  },
  steel: {
    panelBg:           '#7A8491',
    panelBorder:       '#5E6872',
    handleBg:          '#9AAAB7',
    handle:            '#3A4350',
    trackBg:           '#4E5968',
    labelColor:        'text-slate-300/30',
    silhouetteFill:    '#1A2530',
    silhouetteOpacity: 0.20,
    gradient: (i) =>
      `linear-gradient(to bottom, ${i % 2 === 0 ? '#8A9499' : '#7A8491'} 0%, ${i % 2 === 0 ? '#6E7880' : '#7A8491'} 100%)`,
  },
};

// ── Vehicle silhouette renderer ───────────────────────────────────────────────

function VehicleSilhouettes({
  vehicles,
  style,
}: {
  vehicles: VehicleInfo[];
  style:    DoorStyle;
}) {
  const cfg      = STYLE_CONFIGS[style];
  const shown    = vehicles.slice(0, 3);
  const count    = shown.length;
  if (count === 0) return null;

  // Width each silhouette should occupy (as % of the SVG container)
  const widthMap = [55, 36, 26] as const;
  const w        = widthMap[Math.min(count - 1, 2) as 0 | 1 | 2];

  return (
    <div
      className="absolute inset-x-4 flex items-end justify-center gap-4 pointer-events-none select-none"
      style={{ bottom: '28%' }}
    >
      {shown.map((v, idx) => {
        const type = detectVehicleType(v);
        return (
          <svg
            key={idx}
            viewBox="0 0 100 40"
            style={{
              width:   `${w}%`,
              fill:    cfg.silhouetteFill,
              opacity: cfg.silhouetteOpacity,
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            <path d={VEHICLE_PATHS[type]} />
          </svg>
        );
      })}
    </div>
  );
}

// ── Door face ─────────────────────────────────────────────────────────────────

function DoorFace({
  style,
  vehicles,
}: {
  style:     DoorStyle;
  vehicles?: VehicleInfo[];
}) {
  const cfg = STYLE_CONFIGS[style];

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">

      {/* Panel stack */}
      {Array.from({ length: PANEL_COUNT }).map((_, i) => (
        <div
          key={i}
          className="flex-1 relative"
          style={{
            background:   cfg.gradient ? cfg.gradient(i) : cfg.panelBg,
            borderBottom: i < PANEL_COUNT - 1 ? `2px solid ${cfg.panelBorder}` : 'none',
          }}
        >
          {/* Top ridge highlight on each panel (depth illusion) */}
          <div
            className="absolute inset-x-0 top-0 h-px opacity-40"
            style={{ background: 'rgba(255,255,255,0.5)' }}
          />

          {/* Steel rivets */}
          {style === 'steel' && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between px-5">
              <div className="w-2 h-2 rounded-full shadow-inner"
                   style={{ background: '#4E5968', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)' }} />
              <div className="w-2 h-2 rounded-full shadow-inner"
                   style={{ background: '#4E5968', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)' }} />
            </div>
          )}

          {/* Wood grain overlay */}
          {style === 'wood' && (
            <div
              className="absolute inset-0 opacity-10"
              style={{
                background: 'repeating-linear-gradient(90deg, transparent, transparent 8px, rgba(0,0,0,0.15) 8px, rgba(0,0,0,0.15) 9px)',
              }}
            />
          )}
        </div>
      ))}

      {/* Vehicle silhouettes — etched into the door center */}
      {vehicles && vehicles.length > 0 && (
        <VehicleSilhouettes vehicles={vehicles} style={style} />
      )}

      {/* "My Garage" label — shown only when no vehicles are set */}
      {(!vehicles || vehicles.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <span className={`text-[11px] font-black tracking-[0.25em] uppercase opacity-60 ${cfg.labelColor}`}>
            My Garage
          </span>
        </div>
      )}

      {/* Door handle — centered on the lower section */}
      <div className="absolute bottom-[10%] left-1/2 -translate-x-1/2 z-10">
        <div
          className="rounded-full px-5 py-2 shadow-md flex items-center justify-center"
          style={{ background: cfg.handleBg }}
        >
          <div
            className="w-10 h-[5px] rounded-full shadow-sm"
            style={{ background: cfg.handle }}
          />
        </div>
      </div>

      {/* Left + right track rails */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 opacity-80"
        style={{ background: cfg.trackBg }}
      />
      <div
        className="absolute right-0 top-0 bottom-0 w-2 opacity-80"
        style={{ background: cfg.trackBg }}
      />
    </div>
  );
}

// ── Mini preview (used in settings) ──────────────────────────────────────────

export function DoorMiniPreview({ style, active }: { style: DoorStyle; active: boolean }) {
  const cfg = STYLE_CONFIGS[style];
  return (
    <div
      className={`relative w-full aspect-[3/2] rounded-lg overflow-hidden border-2 transition-all ${
        active ? 'border-amber-400 shadow-md' : 'border-slate-200'
      }`}
      style={{ background: cfg.panelBg }}
    >
      {/* Mini panels */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="relative"
          style={{
            height:       '33.33%',
            background:   cfg.gradient ? cfg.gradient(i) : cfg.panelBg,
            borderBottom: i < 2 ? `1px solid ${cfg.panelBorder}` : 'none',
          }}
        />
      ))}
      {/* Mini sedan silhouette */}
      <div className="absolute inset-x-0 flex justify-center" style={{ bottom: '30%' }}>
        <svg
          viewBox="0 0 100 40"
          style={{
            width:   '55%',
            fill:    cfg.silhouetteFill,
            opacity: cfg.silhouetteOpacity,
          }}
          aria-hidden="true"
        >
          <path d={VEHICLE_PATHS.sedan} />
        </svg>
      </div>
      {/* Mini handle */}
      <div className="absolute inset-x-0 bottom-[8%] flex justify-center">
        <div
          className="w-6 h-1.5 rounded-full"
          style={{ background: cfg.handle, opacity: 0.8 }}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const PANEL_COUNT = 5;

// sessionStorage key — door stays open for the whole browser session once opened
const SESSION_KEY = 'gc_garage_door_opened';

// Transform applied when the door is fully open
const OPEN_TRANSFORMS: Record<DoorDirection, string> = {
  'roll-up':    'translateY(-102%)',
  'slide-left': 'translateX(-102%)',
  'slide-right': 'translateX(102%)',
};

interface GarageDoorProps {
  isPro:          boolean;
  doorStyle:      DoorStyle;
  doorDirection:  DoorDirection;
  vehicles?:      VehicleInfo[];
  children:       ReactNode;
}

export function GarageDoor({
  isPro,
  doorStyle,
  doorDirection,
  vehicles,
  children,
}: GarageDoorProps) {
  const [isOpen,  setIsOpen]  = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isOpenRef  = useRef(false);

  // Hydration gate — keeps server and first-client renders in sync
  useEffect(() => {
    setMounted(true);
    try {
      if (sessionStorage.getItem(SESSION_KEY)) {
        isOpenRef.current = true;
        setIsOpen(true);
      }
    } catch { /* sessionStorage unavailable */ }
  }, []);

  // IntersectionObserver — opens the door when the garage section enters view
  useEffect(() => {
    if (!isPro || !mounted) return;
    if (isOpenRef.current) return;

    const el = wrapperRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || isOpenRef.current) return;
        isOpenRef.current = true;
        try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
        setTimeout(() => setIsOpen(true), 250);
      },
      { threshold: 0.2, rootMargin: '0px 0px -40px 0px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isPro, mounted]);

  // Non-Pro: transparent pass-through
  if (!isPro || !mounted) return <>{children}</>;

  const openTransform = OPEN_TRANSFORMS[doorDirection];

  return (
    <div ref={wrapperRef} className="relative overflow-hidden rounded-xl">
      {children}

      {/* Door overlay — absolutely positioned on top, animates away when open */}
      <div
        role="presentation"
        aria-hidden="true"
        className="absolute inset-0 z-10"
        style={{
          transform:     isOpen ? openTransform : 'translate(0, 0)',
          transition:    isOpen
            ? 'transform 1.6s cubic-bezier(0.22, 1, 0.36, 1)'
            : 'none',
          willChange:    'transform',
          pointerEvents: isOpen ? 'none' : 'auto',
        }}
      >
        <DoorFace style={doorStyle} vehicles={vehicles} />
      </div>
    </div>
  );
}

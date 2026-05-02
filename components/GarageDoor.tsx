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

// ── Style configs ─────────────────────────────────────────────────────────────

interface StyleConfig {
  panelBg:     string;   // base background color
  panelBorder: string;   // panel separator hex
  handleBg:    string;   // handle surround hex
  handle:      string;   // handle grip hex
  trackBg:     string;   // side-rail hex
  labelColor:  string;   // "My Garage" watermark Tailwind text class
  gradient?:   (i: number) => string; // optional per-panel inline background
}

const STYLE_CONFIGS: Record<DoorStyle, StyleConfig> = {
  classic: {
    panelBg:     '#F5F0E8',
    panelBorder: '#D9D1C4',
    handleBg:    '#C8BFB4',
    handle:      '#8C7B6E',
    trackBg:     '#9C9490',
    labelColor:  'text-stone-400',
  },
  modern: {
    panelBg:     '#2D3142',
    panelBorder: '#3D4256',
    handleBg:    '#4D5262',
    handle:      '#6C7280',
    trackBg:     '#1D2132',
    labelColor:  'text-slate-500',
  },
  wood: {
    panelBg:     '#8B5E3C',
    panelBorder: '#6B4A2E',
    handleBg:    '#A0714E',
    handle:      '#5C3A1E',
    trackBg:     '#4A2E18',
    labelColor:  'text-amber-200/40',
    gradient: (i) =>
      i % 2 === 0
        ? 'linear-gradient(to bottom, #9B6E4C 0%, #7B4E2C 50%, #8B5E3C 100%)'
        : 'linear-gradient(to bottom, #8B5E3C 0%, #6B4A2E 50%, #9B6E4C 100%)',
  },
  steel: {
    panelBg:     '#7A8491',
    panelBorder: '#5E6872',
    handleBg:    '#9AAAB7',
    handle:      '#3A4350',
    trackBg:     '#4E5968',
    labelColor:  'text-slate-300/30',
    gradient: (i) =>
      `linear-gradient(to bottom, ${i % 2 === 0 ? '#8A9499' : '#7A8491'} 0%, ${i % 2 === 0 ? '#6E7880' : '#7A8491'} 100%)`,
  },
};

// Transform applied when the door is fully open
const OPEN_TRANSFORMS: Record<DoorDirection, string> = {
  'roll-up':    'translateY(-102%)',
  'slide-left': 'translateX(-102%)',
  'slide-right': 'translateX(102%)',
};

// sessionStorage key — door stays open for the whole browser session once opened
const SESSION_KEY = 'gc_garage_door_opened';

const PANEL_COUNT = 5;

// ── Door face ─────────────────────────────────────────────────────────────────

function DoorFace({ style }: { style: DoorStyle }) {
  const cfg = STYLE_CONFIGS[style];

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">

      {/* Panel stack */}
      {Array.from({ length: PANEL_COUNT }).map((_, i) => (
        <div
          key={i}
          className="flex-1 relative"
          style={{
            background: cfg.gradient ? cfg.gradient(i) : cfg.panelBg,
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

      {/* Door handle — centered on the lower third */}
      <div className="absolute bottom-[18%] left-1/2 -translate-x-1/2 flex items-center gap-0 z-10">
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

      {/* "My Garage" watermark */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
        <span className={`text-[11px] font-black tracking-[0.25em] uppercase opacity-60 ${cfg.labelColor}`}>
          My Garage
        </span>
      </div>

      {/* Left + right track rails (visible for roll-up, decorative for slide) */}
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
            height: '33.33%',
            background: cfg.gradient ? cfg.gradient(i) : cfg.panelBg,
            borderBottom: i < 2 ? `1px solid ${cfg.panelBorder}` : 'none',
          }}
        />
      ))}
      {/* Mini handle */}
      <div className="absolute inset-x-0 bottom-[15%] flex justify-center">
        <div
          className="w-6 h-1.5 rounded-full"
          style={{ background: cfg.handle, opacity: 0.8 }}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface GarageDoorProps {
  isPro:          boolean;
  doorStyle:      DoorStyle;
  doorDirection:  DoorDirection;
  children:       ReactNode;
}

export function GarageDoor({
  isPro,
  doorStyle,
  doorDirection,
  children,
}: GarageDoorProps) {
  const [isOpen,  setIsOpen]  = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isOpenRef  = useRef(false);   // avoids stale closure in observer callback

  // Hydration gate — keeps server and first-client renders in sync
  useEffect(() => {
    setMounted(true);
    // If already opened this session (e.g. user switched calculator tab and
    // the component remounted), keep the door open immediately
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
    if (isOpenRef.current) return;   // already open, no need to observe

    const el = wrapperRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || isOpenRef.current) return;
        isOpenRef.current = true;
        try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
        // Brief pause so the user sees the closed door before it opens
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
        <DoorFace style={doorStyle} />
      </div>
    </div>
  );
}

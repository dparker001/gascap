'use client';

/**
 * GarageDoor — Pro-only animated garage door overlay
 *
 * Wraps the garage vehicles section with a decorative door. The user taps/clicks
 * the door to open it. On first open each calendar day, the server awards +5
 * daily draw entries (garage bonus). Once opened, the door stays open for
 * the rest of that calendar day (localStorage date-stamp, Option C). It resets
 * automatically the next day — giving every daily visit a fresh personalized reveal.
 *
 * Door styles:  Classic · Modern · Wood · Steel
 * Open directions: Roll Up · Open from Center (split)
 *
 * Vehicle silhouettes: up to 3 body-type-matched SVG silhouettes etched onto
 * the closed door, inferred from each vehicle's name / make / model.
 */

import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { DoorStyle, DoorDirection } from '@/hooks/useGarageDoorPrefs';
import { VEHICLE_PATHS } from '@/lib/vehicleSilhouette';
import { useTranslation } from '@/contexts/LanguageContext';

export type { DoorStyle, DoorDirection };

// ── Display labels (used by the settings UI) ─────────────────────────────────

export const DOOR_STYLE_LABELS: Record<DoorStyle, string> = {
  classic: 'Classic',
  modern:  'Modern',
  wood:    'Wood',
  steel:   'Steel',
};

export const DOOR_DIRECTION_LABELS: Record<DoorDirection, string> = {
  'roll-up': '↑ Roll Up',
  'center':  '↔ Open from Center',
};

// ── Style configs ─────────────────────────────────────────────────────────────

interface StyleConfig {
  panelBg:           string;
  panelBorder:       string;
  handleBg:          string;
  handle:            string;
  trackBg:           string;
  labelColor:        string;
  silhouetteFill:    string;
  silhouetteOpacity: number;
  hintColor:         string;   // "TAP TO OPEN" hint text color class
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
    hintColor:         'text-stone-500',
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
    hintColor:         'text-slate-400',
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
    hintColor:         'text-amber-200/60',
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
    hintColor:         'text-slate-200/60',
    gradient: (i) =>
      `linear-gradient(to bottom, ${i % 2 === 0 ? '#8A9499' : '#7A8491'} 0%, ${i % 2 === 0 ? '#6E7880' : '#7A8491'} 100%)`,
  },
};

const ROLL_UP_TRANSFORM = 'translateY(-102%)';

const PANEL_COUNT = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns today's date as YYYY-MM-DD in local time. */
function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Extracts and upper-cases the first word of a display name. */
function toFirstName(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? '').toUpperCase();
}

// ── Door face ─────────────────────────────────────────────────────────────────

function DoorFace({ style, nameLabel, locked }: { style: DoorStyle; nameLabel: string; locked?: boolean }) {
  const cfg = STYLE_CONFIGS[style];
  const { t } = useTranslation();

  // Dark doors (modern) use a light-tinted plate; light doors use a dark-tinted plate
  const plateBg     = style === 'modern'
    ? 'rgba(255,255,255,0.08)'
    : 'rgba(0,0,0,0.10)';
  const plateBorder = style === 'modern'
    ? 'rgba(255,255,255,0.14)'
    : 'rgba(0,0,0,0.18)';

  return (
    <div className={`absolute inset-0 flex flex-col overflow-hidden select-none ${locked ? 'cursor-default' : 'cursor-pointer'}`}>

      {/* Panel stack — nameplate lives inside the centre panel (index 2) */}
      {Array.from({ length: PANEL_COUNT }).map((_, i) => (
        <div
          key={i}
          className="flex-1 relative"
          style={{
            background:   cfg.gradient ? cfg.gradient(i) : cfg.panelBg,
            borderBottom: i < PANEL_COUNT - 1 ? `2px solid ${cfg.panelBorder}` : 'none',
          }}
        >
          <div className="absolute inset-x-0 top-0 h-px opacity-40"
               style={{ background: 'rgba(255,255,255,0.5)' }} />
          {style === 'steel' && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between px-5">
              <div className="w-2 h-2 rounded-full"
                   style={{ background: '#4E5968', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)' }} />
              <div className="w-2 h-2 rounded-full"
                   style={{ background: '#4E5968', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)' }} />
            </div>
          )}
          {style === 'wood' && (
            <div className="absolute inset-0 opacity-10"
                 style={{ background: 'repeating-linear-gradient(90deg,transparent,transparent 8px,rgba(0,0,0,0.15) 8px,rgba(0,0,0,0.15) 9px)' }} />
          )}

          {/* ── Nameplate: centred inside middle panel, not locked ── */}
          {i === 2 && !locked && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="flex items-center gap-2.5 px-5 py-2 rounded-[3px]"
                style={{
                  background:  plateBg,
                  border:      `1px solid ${plateBorder}`,
                  boxShadow:   'inset 0 1px 3px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.10)',
                }}
              >
                {/* Left rivet */}
                <div className="w-[5px] h-[5px] rounded-full flex-shrink-0 opacity-55"
                     style={{ background: cfg.handle, boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.4)' }} />
                <span className={`text-[13px] font-black tracking-[0.28em] uppercase ${cfg.labelColor}`}
                      style={{ textShadow: '0 1px 1px rgba(0,0,0,0.25)' }}>
                  {nameLabel}
                </span>
                {/* Right rivet */}
                <div className="w-[5px] h-[5px] rounded-full flex-shrink-0 opacity-55"
                     style={{ background: cfg.handle, boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.4)' }} />
              </div>
            </div>
          )}
        </div>
      ))}

      {locked ? (
        /* ── Locked state: no vehicle saved ─────────────────────── */
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
             style={{ paddingBottom: '15%' }}>
          <div className="flex flex-col items-center gap-2.5 px-6">
            {/* Lock icon */}
            <div className="w-9 h-9 rounded-full flex items-center justify-center opacity-40"
                 style={{ background: plateBg, border: `1px solid ${plateBorder}` }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className={`w-5 h-5 ${cfg.labelColor}`} aria-hidden="true">
                <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
              </svg>
            </div>
            {/* Message */}
            <p className={`text-[10px] font-black text-center leading-relaxed tracking-wide uppercase opacity-45 ${cfg.labelColor}`}>
              {t.garageDoor.unlockLine1}<br />{t.garageDoor.unlockLine2}
            </p>
          </div>
        </div>
      ) : (
        /* ── Normal state: tap hint only (nameplate is in panel 2) ── */
        <>
          {/* "Tap to Open" hint — pulsing, above the handle */}
          <div className="absolute bottom-[22%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 pointer-events-none">
            <svg viewBox="0 0 16 10" className="w-4 h-3 animate-bounce opacity-70"
                 fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                 style={{ color: cfg.hintColor.replace('text-', '') }}>
              <path d="M2 8l6-6 6 6" />
            </svg>
            <span className={`text-[9px] font-black tracking-widest uppercase opacity-70 ${cfg.hintColor}`}>
              {t.garageDoor.tapToOpen}
            </span>
          </div>
        </>
      )}

      {/* Track rails */}
      <div className="absolute left-0 top-0 bottom-0 w-2 opacity-80" style={{ background: cfg.trackBg }} />
      <div className="absolute right-0 top-0 bottom-0 w-2 opacity-80" style={{ background: cfg.trackBg }} />
    </div>
  );
}

// ── Mini preview (settings) ───────────────────────────────────────────────────

export function DoorMiniPreview({ style, active }: { style: DoorStyle; active: boolean }) {
  const cfg = STYLE_CONFIGS[style];
  return (
    <div
      className={`relative w-full aspect-[3/2] rounded-lg overflow-hidden border-2 transition-all ${
        active ? 'border-amber-400 shadow-md' : 'border-slate-200'
      }`}
      style={{ background: cfg.panelBg }}
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="relative" style={{
          height: '33.33%',
          background: cfg.gradient ? cfg.gradient(i) : cfg.panelBg,
          borderBottom: i < 2 ? `1px solid ${cfg.panelBorder}` : 'none',
        }} />
      ))}
      {/* Mini sedan silhouette */}
      <div className="absolute inset-x-0 flex justify-center" style={{ bottom: '20%' }}>
        <svg viewBox="0 0 200 80"
             style={{ width: '68%', fill: cfg.silhouetteFill, opacity: cfg.silhouetteOpacity }}
             fillRule="evenodd"
             aria-hidden="true">
          <path d={VEHICLE_PATHS.sedan} />
        </svg>
      </div>
      <div className="absolute inset-x-0 bottom-[8%] flex justify-center">
        <div className="w-6 h-1.5 rounded-full" style={{ background: cfg.handle, opacity: 0.8 }} />
      </div>
    </div>
  );
}

// ── Bonus toast ───────────────────────────────────────────────────────────────

interface BonusToastProps {
  show:         boolean;
  bonusEntries: number;
  totalDays:    number;
}

function BonusToast({ show, bonusEntries, totalDays }: BonusToastProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`fixed inset-x-4 bottom-24 z-50 transition-all duration-500 ${
        show
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 translate-y-3 scale-95 pointer-events-none'
      }`}
    >
      <div className="bg-amber-500 rounded-2xl shadow-xl overflow-hidden">
        {/* Header row */}
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <span className="text-2xl flex-shrink-0">🎟️</span>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-black leading-tight">
              {t.garageDoor.dailyDrawEntries(bonusEntries)}
            </p>
            <p className="text-white/75 text-[11px] font-semibold leading-tight mt-0.5">
              {t.garageDoor.dailyGarageBonus}
            </p>
          </div>
          {totalDays > 1 && (
            <div className="flex-shrink-0 text-right">
              <p className="text-white text-[10px] font-black leading-tight">📅 {totalDays}</p>
              <p className="text-white/60 text-[9px] leading-tight">{t.garageDoor.dayStreak}</p>
            </div>
          )}
        </div>

        {/* Explanation */}
        <div className="bg-black/10 px-4 py-2.5">
          <p className="text-white/90 text-[11px] leading-relaxed">
            {t.garageDoor.bonusExplainLead}{' '}
            <span className="font-black text-white">{t.garageDoor.bonusExplainEntries(bonusEntries)}</span>{' '}
            {t.garageDoor.bonusExplainTail}
          </p>
        </div>
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
  /** Display name of the signed-in user — first word shown on the nameplate. */
  userName?:      string;
  /** Fleet accounts show "[NAME]'S FLEET" instead of "[NAME]'S GARAGE". */
  isFleet?:       boolean;
  /**
   * When true the door stays permanently closed with a "save a vehicle to
   * unlock" message and cannot be opened until a vehicle is added.
   */
  locked?:        boolean;
}

export function GarageDoor({
  isPro,
  doorStyle,
  doorDirection,
  children,
  userName,
  isFleet  = false,
  locked   = false,
}: GarageDoorProps) {
  const { t } = useTranslation();
  // Nameplate label: "DON'S FLEET" for fleet, "DON'S GARAGE" for pro, fallback variants
  const firstName = userName ? toFirstName(userName) : '';
  const nameLabel = firstName
    ? (isFleet
        ? t.garageDoor.nameplateFleet(firstName)
        : t.garageDoor.nameplateGarage(firstName))
    : (isFleet ? t.garageDoor.nameplateMyFleet : t.garageDoor.nameplateMyGarage);
  const alreadyOpenToday = typeof window !== 'undefined' &&
    localStorage.getItem('gascap:garage-open-date') === getToday();
  const [isOpen,       setIsOpen]       = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    // Open for the rest of the calendar day, reset each morning
    return localStorage.getItem('gascap:garage-open-date') === getToday();
  });
  const [mounted,      setMounted]      = useState(false);
  const [showToast,    setShowToast]    = useState(false);
  const [bonusEntries, setBonusEntries] = useState(10);
  const [totalDays,    setTotalDays]    = useState(1);
  // True when the door was already open on mount (bonus earned in a prior session today)
  const [earnedEarlier,   setEarnedEarlier]   = useState(false);
  const [earnedDismissed, setEarnedDismissed] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    // If the door was already open when we mounted, the bonus was earned earlier today.
    // Show a quiet indicator so users know their entries were credited.
    if (alreadyOpenToday) setEarnedEarlier(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpen = useCallback(async () => {
    if (isOpen) return;
    setIsOpen(true);
    // Stamp today's date so the door stays open all day and resets tomorrow
    localStorage.setItem('gascap:garage-open-date', getToday());

    // Fire-and-forget: award the daily garage bonus
    try {
      const res  = await fetch('/api/giveaway/garage-bonus', { method: 'POST' });
      const data = await res.json() as { awarded?: boolean; bonusEntries?: number; totalGarageDays?: number };
      if (data.awarded) {
        setBonusEntries(data.bonusEntries ?? 10);
        setTotalDays(data.totalGarageDays ?? 1);
        setShowToast(true);
        setTimeout(() => setShowToast(false), 6000);
      }
    } catch { /* ignore network errors — don't block the animation */ }
  }, [isOpen]);

  if (!isPro || !mounted) return <>{children}</>;

  const transition    = isOpen ? 'transform 1.6s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
  const pointerEvents = (isOpen || locked) ? 'none' : 'auto';
  const clickHandler  = locked ? undefined : handleOpen;
  const keyHandler    = locked ? undefined : (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') handleOpen();
  };

  return (
    <>
    <div ref={wrapperRef} className="relative overflow-hidden rounded-xl">
      {children}

      {doorDirection === 'center' ? (
        /* ── Open from center: two half-panels slide apart ── */
        <>
          {/* Left half */}
          <div
            role={locked ? 'img' : 'button'}
            aria-label={locked ? t.garageDoor.ariaLocked : t.garageDoor.ariaOpen}
            tabIndex={locked ? -1 : 0}
            onClick={clickHandler}
            onKeyDown={keyHandler}
            style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%',
              overflow: 'hidden', zIndex: 10,
              transform:     isOpen ? 'translateX(-102%)' : 'none',
              transition,
              willChange:    'transform',
              pointerEvents,
            }}
          >
            {/* Inner div is full door width; overflow:hidden clips to left half */}
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '200%' }}>
              <DoorFace style={doorStyle} nameLabel={nameLabel} locked={locked} />
            </div>
          </div>

          {/* Right half */}
          <div
            aria-hidden="true"
            onClick={clickHandler}
            style={{
              position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%',
              overflow: 'hidden', zIndex: 10,
              transform:     isOpen ? 'translateX(102%)' : 'none',
              transition,
              willChange:    'transform',
              pointerEvents,
            }}
          >
            {/* Inner div is full door width, right-anchored; overflow:hidden clips to right half */}
            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '200%' }}>
              <DoorFace style={doorStyle} nameLabel={nameLabel} locked={locked} />
            </div>
          </div>
        </>
      ) : (
        /* ── Roll up: single panel slides upward ── */
        <div
          role={locked ? 'img' : 'button'}
          aria-label={locked ? t.garageDoor.ariaLocked : t.garageDoor.ariaOpen}
          tabIndex={locked ? -1 : 0}
          className="absolute inset-0 z-10"
          onClick={clickHandler}
          onKeyDown={keyHandler}
          style={{
            transform:     isOpen ? ROLL_UP_TRANSFORM : 'translate(0,0)',
            transition,
            willChange:    'transform',
            pointerEvents,
          }}
        >
          <DoorFace style={doorStyle} nameLabel={nameLabel} locked={locked} />
        </div>
      )}
    </div>

    {/* Bonus-entries toast — rendered BELOW the overflow-hidden wrapper so it
        never clips or overlaps the vehicle cards. */}
    <BonusToast show={showToast} bonusEntries={bonusEntries} totalDays={totalDays} />

    {/* Quiet "already earned" pill — rendered BELOW the garage wrapper so it never
        overlaps vehicles. Tap the × to dismiss. */}
    {isOpen && earnedEarlier && !showToast && !earnedDismissed && (
      <div className="flex justify-center mt-2">
        <button
          onClick={() => setEarnedDismissed(true)}
          className="flex items-center gap-1.5 bg-amber-500/90 hover:bg-amber-500
                     text-white text-[10px] font-black px-3 py-1.5 rounded-full
                     shadow-sm transition-colors"
        >
          🎟️ {t.garageDoor.earnedToday(bonusEntries)}
          <span className="text-white/60 text-[9px] ml-0.5">✕</span>
        </button>
      </div>
    )}
    </>
  );
}

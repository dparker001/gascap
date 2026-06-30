'use client';

/**
 * NativeAppShell — the app-like experience for the iOS/Android wrappers.
 *
 * Replaces the marketing/scroll landing page on native (mounted from app/page.tsx
 * via `if (isNative) return <NativeAppShell/>`). A persistent bottom tab bar swaps
 * between five views, all reusing existing components. State-based (no route reloads)
 * so switching is instant and tab state (calculator inputs, scroll) is preserved:
 * a tab is mounted on first visit and then only hidden — never unmounted — when you
 * switch away.
 *
 * Pure web/CSS behind useIsNative() → ships live, no Codemagic rebuild.
 * Spec: docs/NATIVE_APP_SHELL_SPEC.md.
 */

import { useEffect, useRef, useState } from 'react';
import Link                    from 'next/link';
import { useSession }          from 'next-auth/react';
import { useTranslation }      from '@/contexts/LanguageContext';
import { initNativeChrome }    from '@/lib/nativeChrome';

import CalculatorTabs   from '@/components/CalculatorTabs';
import FillupHistory    from '@/components/FillupHistory';
import ToolsPanel       from '@/components/ToolsPanel';
import TrialExpiryBanner from '@/components/TrialExpiryBanner';
import AnnouncementToast from '@/components/AnnouncementToast';
import WinnerBanner     from '@/components/WinnerBanner';
import SettingsPage     from '@/app/settings/page';
import NativeTabBar, { type TabMeta } from './NativeTabBar';
import RewardsTab       from './tabs/RewardsTab';
import NearbyStations   from '@/components/NearbyStations';
import VehicleChip      from './VehicleChip';
import TabLockGate      from './TabLockGate';
import FirstLaunchSplash from './FirstLaunchSplash';
import GreetingStrip     from './GreetingStrip';
import ReviewNudge       from '@/components/ReviewNudge';
import LanguageToggle    from '@/components/LanguageToggle';
import { getPlanBadge, type PlanUser } from '@/lib/planBadge';
import FillupLogger from '@/components/FillupLogger';
import GigDriverTab from '@/components/GigDriverTab';
import UserModeSelector from '@/components/UserModeSelector';

export type TabId = 'calculator' | 'findgas' | 'history' | 'tools' | 'rewards' | 'settings' | 'driver';

const TAB_IDS: TabId[] = ['calculator', 'findgas', 'history', 'tools', 'rewards', 'settings', 'driver'];

const STORAGE_KEY = 'gc_active_tab';
const isTabId = (v: string | null): v is TabId => !!v && (TAB_IDS as string[]).includes(v ?? '');

export default function NativeAppShell() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();

  // Tab labels come from the translation system so the bottom bar + title bar follow
  // the language toggle (EN/ES).
  const userMode = (session?.user as { userMode?: string | null })?.userMode;
  const isGigDriver = userMode === 'gig';

  const TABS: TabMeta[] = [
    { id: 'calculator', label: t.nav.calculator },
    { id: 'findgas',    label: t.nav.findGas    },
    { id: 'history',    label: t.nav.history    },
    ...(isGigDriver ? [{ id: 'driver' as TabId, label: 'Driver' }] : []),
    { id: 'tools',      label: t.nav.tools      },
    { id: 'rewards',    label: t.nav.rewards    },
    { id: 'settings',   label: t.nav.settings   },
  ];
  // Guest = confirmed not-signed-in (don't gate while the session is still loading,
  // or signed-in tabs would flash the lock screen on every open).
  const isGuest = status === 'unauthenticated';

  // Plan badge for the title bar — shared with AuthButton; trial users get a live "Pro Trial · Nd".
  const planBadge = getPlanBadge(session?.user as PlanUser | undefined, t);

  const [modeSelectorDone, setModeSelectorDone] = useState(false);
  const showModeSelector = status === 'authenticated' && !userMode && !modeSelectorDone;

  const [active,  setActive]  = useState<TabId>('calculator');
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set<TabId>(['calculator']));
  const [historyKey,  setHistoryKey]  = useState(0);
  const [calcMountKey, setCalcMountKey] = useState(0);

  // Pending fill-up from Find Gas — shown as a banner on the Calculator tab
  const [pendingFillup, setPendingFillup] = useState<{
    price: string;
    stationName: string;
    grade: string;
  } | null>(null);
  const [showFillupSheet, setShowFillupSheet] = useState(false);

  // Initialize status bar + keyboard on native shell mount
  useEffect(() => { initNativeChrome(); }, []);

  // Handle iOS home screen shortcuts — ?shortcut=log|findgas|savings
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const shortcut = p.get('shortcut');
    if (shortcut === 'log')     { changeTab('history');    }
    if (shortcut === 'findgas') { changeTab('findgas');    }
    if (shortcut === 'savings') { changeTab('history');    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore last-active tab on mount (client-only; avoids SSR hydration mismatch).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isTabId(stored) && stored !== 'calculator') {
        setActive(stored);
        setVisited((prev) => new Set(prev).add(stored));
      }
    } catch { /* storage blocked — stay on default */ }
  }, []);

  // Persist the active tab so reopening the app returns where the user left off.
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, active); } catch { /* ignore */ }
  }, [active]);

  // Allow any component to switch tabs via custom event
  useEffect(() => {
    function handler(e: Event) {
      const tab = (e as CustomEvent<{ tab: TabId }>).detail?.tab;
      if (tab) changeTab(tab);
    }
    window.addEventListener('gc:switch-tab', handler);
    return () => window.removeEventListener('gc:switch-tab', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeTab(id: TabId) {
    if (id === active) return;
    setActive(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    if (id === 'history') setHistoryKey((k) => k + 1);
    contentRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }

  function handleVehicleSwitch(gallons: string, vehicle?: import('@/components/SavedVehicles').Vehicle) {
    try {
      const raw  = localStorage.getItem('gc_target_v2');
      const prev = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      localStorage.setItem('gc_target_v2', JSON.stringify({
        ...prev,
        tankCapacity:    gallons,
        vehicleId:       vehicle?.id       ?? '',
        vehicleName:     vehicle?.name     ?? '',
        vehicleOdometer: vehicle?.currentOdometer ?? undefined,
      }));
    } catch { /* ignore */ }
    setCalcMountKey((k) => k + 1);
  }

  function shiftTab(dir: -1 | 1) {
    const idx = TABS.findIndex((t) => t.id === active);
    const next = TABS[idx + dir];
    if (next) changeTab(next.id);   // clamp at the ends (no wrap)
  }

  // ── Swipe left/right between tabs ──────────────────────────────────────────
  const contentRef = useRef<HTMLDivElement>(null);
  const touchRef   = useRef<{ x: number; y: number; t: number; ignore: boolean } | null>(null);

  // Skip the swipe when the gesture starts on something that owns horizontal
  // motion: form fields, the fuel gauge (data-noswipe), or a horizontal scroller.
  function swipeBlocked(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    if (el.closest('input, textarea, select, [data-noswipe]')) return true;
    let node: HTMLElement | null = el;
    while (node && node !== contentRef.current) {
      const ox = getComputedStyle(node).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth + 4) return true;
      node = node.parentElement;
    }
    return false;
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now(), ignore: swipeBlocked(e.target) };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const s = touchRef.current;
    touchRef.current = null;
    if (!s || s.ignore) return;
    const c  = e.changedTouches[0];
    const dx = c.clientX - s.x;
    const dy = c.clientY - s.y;
    // Decisive, mostly-horizontal flick → switch tabs. Thresholds keep it from
    // firing on taps, vertical scrolls, or diagonal drags.
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - s.t < 600) {
      shiftTab(dx < 0 ? 1 : -1);   // swipe left → next tab, swipe right → previous
    }
  }

  const title = TABS.find((t) => t.id === active)?.label ?? 'GasCap';
  const show  = (id: TabId) => (id === active ? '' : 'hidden');

  return (
    <main
      className="h-screen flex flex-col bg-slate-50 dark:bg-slate-900 overflow-hidden"
    >

      {/* First-launch brand video overlay (inert until the MP4 is added — see component) */}
      <FirstLaunchSplash />

      {/* "Rate us" nudge — engaged signed-in users, after they've come back (≥2 days) */}
      <ReviewNudge />

      {/* Native title bar — pinned by being the first flex child of the h-screen shell,
          so it never scrolls. No position:fixed needed; the content area scrolls
          independently via overflow-y-auto on the sibling div below. */}
      <header
        className="flex-shrink-0 bg-brand-dark text-white shadow-sm"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="h-12 bg-[#1e3a5f] flex items-center justify-center px-4 relative gap-2">
          {/* Language switch — reachable from any tab (the native shell has no web header) */}
          <LanguageToggle className="absolute left-2 top-1/2 -translate-y-1/2 !py-1" />
          <div className="flex flex-col items-center">
            <h1 className="text-base font-bold tracking-tight">{title}</h1>
            {active === 'calculator' && status === 'authenticated' && (
              <VehicleChip onSelect={handleVehicleSwitch} />
            )}
          </div>
          {planBadge ? (
            <span
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black
                          text-white px-2 py-0.5 rounded-full ${planBadge.bg}`}
            >
              {planBadge.medal ? '🏅 ' : ''}{planBadge.text.toUpperCase()}
            </span>
          ) : isGuest ? (
            /* Guests had no obvious way to find sign-up after the splash — give them
               a persistent CTA in the title bar, visible on every tab. */
            <Link
              href="/signup"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-black
                         text-white bg-brand-orange px-2.5 py-1 rounded-full
                         active:opacity-90 transition-opacity"
            >
              {t.nav.signUp}
            </Link>
          ) : null}
        </div>
        {/* Personalized welcome bar — part of the FIXED header (Calculator tab, signed-in)
            so it stays static beneath the title bar instead of scrolling with content. */}
        {active === 'calculator' && status === 'authenticated' && (
          <GreetingStrip onOpenRewards={() => changeTab('rewards')} />
        )}
      </header>

      {/* Essential in-app overlays (marketing chrome is intentionally not mounted) */}
      <TrialExpiryBanner />
      {session && <WinnerBanner />}
      <AnnouncementToast />

      {/* Tab content — each tab mounts on first visit, then hides (state preserved).
          overflow-y-auto makes only THIS div scroll so the header and tab bar
          stay pinned as natural flex children (no position:fixed needed). */}
      <div
        ref={contentRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="flex-1 overflow-y-auto"
      >

        {visited.has('calculator') && (
          <div className={show('calculator')}>
            {/* One-click fill-up banner — appears after selecting a station in Find Gas */}
            {pendingFillup && (
              <div className="mx-4 mt-3 rounded-2xl bg-teal-50 border border-teal-200 px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-teal-800 truncate">
                    ⛽ {pendingFillup.stationName || 'Selected station'} · ${pendingFillup.price}/gal
                  </p>
                  <p className="text-[11px] text-teal-600 mt-0.5">Ready to log this fill-up?</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setShowFillupSheet(true)}
                    className="px-3 py-1.5 rounded-xl bg-[#005F4A] text-white text-xs font-black active:opacity-80"
                  >
                    Log Fill-up
                  </button>
                  <button
                    onClick={() => setPendingFillup(null)}
                    className="px-2 py-1.5 rounded-xl bg-teal-100 text-teal-700 text-xs font-bold active:opacity-80"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
            <div key={calcMountKey} className="px-4 pt-4 pb-2 max-w-lg mx-auto w-full">
              <CalculatorTabs />
            </div>
          </div>
        )}

        {visited.has('history') && (
          <div className={show('history')}>
            {isGuest ? (
              <TabLockGate
                icon="⛽"
                title={t.gate.history.title}
                subtitle={t.gate.history.subtitle}
                bullets={t.gate.history.bullets}
              />
            ) : (
              <div className="px-4 pt-4 max-w-lg mx-auto w-full">
                <FillupHistory refreshKey={historyKey} />
              </div>
            )}
          </div>
        )}

        {visited.has('tools') && (
          <div className={show('tools')}>
            {isGuest ? (
              <TabLockGate
                icon="🛠️"
                title={t.gate.tools.title}
                subtitle={t.gate.tools.subtitle}
                bullets={t.gate.tools.bullets}
              />
            ) : (
              <div className="px-4 pt-4 max-w-lg mx-auto w-full">
                <ToolsPanel />
              </div>
            )}
          </div>
        )}

        {visited.has('findgas') && (
          <div className={show('findgas')}>
            <NearbyStations isActive={active === 'findgas'} onApply={(price, lat, lng, stationName, distanceMi, grade) => {
              window.dispatchEvent(new CustomEvent('gc:inject-gas-price', { detail: { price, name: stationName, distanceMi, grade } }));
              setPendingFillup({ price, stationName, grade });
              setShowFillupSheet(false);
              setActive('calculator');
              setVisited((prev) => { const s = new Set(prev); s.add('calculator'); return s; });
            }} />
          </div>
        )}

        {isGigDriver && visited.has('driver') && (
          <div className={show('driver')}>
            <div className="px-4 pt-4 pb-6 max-w-lg mx-auto w-full">
              <GigDriverTab />
            </div>
          </div>
        )}

        {visited.has('rewards') && (
          <div className={show('rewards')}>
            <RewardsTab />
          </div>
        )}

        {visited.has('settings') && (
          <div className={show('settings')}>
            <SettingsPage />
          </div>
        )}

      </div>

      <NativeTabBar tabs={TABS} active={active} onChange={changeTab} />

      {/* Mode selector — shown on first login when userMode is not yet set */}
      {showModeSelector && (
        <UserModeSelector onComplete={() => setModeSelectorDone(true)} />
      )}

      {/* Fill-up bottom sheet — slides up when user taps "Log Fill-up" banner */}
      {showFillupSheet && pendingFillup && (() => {
        let vehicleName = 'My Vehicle';
        let vehicleId: string | undefined;
        let vehicleOdometer: number | undefined;
        try {
          const raw = localStorage.getItem('gc_target_v2');
          if (raw) {
            const stored = JSON.parse(raw) as Record<string, unknown>;
            if (stored.vehicleName) vehicleName = stored.vehicleName as string;
            if (stored.vehicleId)   vehicleId   = stored.vehicleId   as string;
            if (stored.vehicleOdometer) vehicleOdometer = Number(stored.vehicleOdometer);
          }
        } catch { /* ignore */ }

        const gradeMap: Record<string, 'regular' | 'midgrade' | 'premium' | 'diesel' | 'e85'> = {
          regular: 'regular', midgrade: 'midgrade', premium: 'premium',
          diesel: 'diesel', e85: 'e85',
        };
        const mappedGrade = gradeMap[pendingFillup.grade?.toLowerCase() ?? ''] ?? '';

        return (
          <div className="fixed inset-0 z-50 flex flex-col justify-end">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setShowFillupSheet(false)}
            />
            <div className="relative bg-white rounded-t-3xl shadow-2xl max-h-[90vh] overflow-y-auto"
              style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}
            >
              <div className="sticky top-0 bg-white pt-4 pb-2 px-4 flex items-center justify-between border-b border-slate-100 z-10">
                <h2 className="text-base font-black text-slate-900">Log Fill-up</h2>
                <button
                  onClick={() => setShowFillupSheet(false)}
                  className="text-slate-400 text-xl font-bold px-2"
                >✕</button>
              </div>
              <FillupLogger
                prefill={{
                  gallonsPumped:  0,
                  pricePerGallon: parseFloat(pendingFillup.price) || 0,
                  vehicleName,
                  vehicleId,
                  vehicleOdometer,
                  stationName:  pendingFillup.stationName,
                  fuelGrade:    mappedGrade,
                }}
                onSaved={() => {
                  setShowFillupSheet(false);
                  setPendingFillup(null);
                  setHistoryKey((k) => k + 1);
                }}
                onCancel={() => setShowFillupSheet(false)}
              />
            </div>
          </div>
        );
      })()}
    </main>
  );
}

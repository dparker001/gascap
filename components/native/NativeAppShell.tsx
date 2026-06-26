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

export type TabId = 'calculator' | 'findgas' | 'history' | 'tools' | 'rewards' | 'settings';

const TAB_IDS: TabId[] = ['calculator', 'findgas', 'history', 'tools', 'rewards', 'settings'];

const STORAGE_KEY = 'gc_active_tab';
const isTabId = (v: string | null): v is TabId => !!v && (TAB_IDS as string[]).includes(v ?? '');

export default function NativeAppShell() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();

  // Tab labels come from the translation system so the bottom bar + title bar follow
  // the language toggle (EN/ES).
  const TABS: TabMeta[] = [
    { id: 'calculator', label: t.nav.calculator },
    { id: 'findgas',    label: t.nav.findGas    },
    { id: 'history',    label: t.nav.history    },
    { id: 'tools',      label: t.nav.tools      },
    { id: 'rewards',    label: t.nav.rewards    },
    { id: 'settings',   label: t.nav.settings   },
  ];
  // Guest = confirmed not-signed-in (don't gate while the session is still loading,
  // or signed-in tabs would flash the lock screen on every open).
  const isGuest = status === 'unauthenticated';

  // Plan badge for the title bar — shared with AuthButton; trial users get a live "Pro Trial · Nd".
  const planBadge = getPlanBadge(session?.user as PlanUser | undefined, t);

  const [active,  setActive]  = useState<TabId>('calculator');
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set<TabId>(['calculator']));
  const [historyKey,  setHistoryKey]  = useState(0);
  const [calcMountKey, setCalcMountKey] = useState(0); // bump to remount calculator after vehicle switch

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
    window.scrollTo({ top: 0, behavior: 'instant' });
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
      className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900"
      style={{ paddingTop: `calc(${active === 'calculator' && status === 'authenticated' ? '84px' : '48px'} + env(safe-area-inset-top))` }}
    >

      {/* First-launch brand video overlay (inert until the MP4 is added — see component) */}
      <FirstLaunchSplash />

      {/* "Rate us" nudge — engaged signed-in users, after they've come back (≥2 days) */}
      <ReviewNudge />

      {/* Native title bar — ONE fixed element: a green band over the status-bar safe
          area (the header's brand-dark bg fills the safe-area paddingTop) with the navy
          title row beneath it. Combining them means the green can't scroll independently
          of the navy bar — whatever pins the navy bar pins the green band too. Fixed
          because sticky is unreliable inside this flex/scroll container on iOS. */}
      <header
        className="fixed top-0 left-0 right-0 z-30 bg-brand-dark text-white shadow-sm"
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
          Padding-bottom clears the fixed tab bar + the home-indicator safe area. */}
      <div
        ref={contentRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="flex-1"
        style={{ paddingBottom: 'calc(88px + env(safe-area-inset-bottom))' }}
      >

        {visited.has('calculator') && (
          <div className={show('calculator')}>
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
              setActive('calculator');
              setVisited((prev) => { const s = new Set(prev); s.add('calculator'); return s; });
            }} />
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
    </main>
  );
}

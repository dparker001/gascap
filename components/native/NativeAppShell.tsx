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
import TabLockGate      from './TabLockGate';
import FirstLaunchSplash from './FirstLaunchSplash';

export type TabId = 'calculator' | 'history' | 'tools' | 'rewards' | 'settings';

const TABS: TabMeta[] = [
  { id: 'calculator', label: 'Calculator' },
  { id: 'history',    label: 'History'    },
  { id: 'tools',      label: 'Tools'      },
  { id: 'rewards',    label: 'Rewards'    },
  { id: 'settings',   label: 'Settings'   },
];

const STORAGE_KEY = 'gc_active_tab';
const isTabId = (v: string | null): v is TabId => !!v && TABS.some((t) => t.id === v);

export default function NativeAppShell() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  // Guest = confirmed not-signed-in (don't gate while the session is still loading,
  // or signed-in tabs would flash the lock screen on every open).
  const isGuest = status === 'unauthenticated';

  // Plan badge for the title bar — same logic as AuthButton (which the native shell
  // doesn't render), so Pro/Lifetime/Fleet members keep their status pill in-app.
  const plan           = (session?.user as { plan?: string })?.plan ?? 'free';
  const stripeInterval = (session?.user as { stripeInterval?: string | null })?.stripeInterval ?? null;
  const isProTrial     = (session?.user as { isProTrial?: boolean })?.isProTrial ?? false;
  const isLifetime     = plan === 'pro' && !isProTrial && stripeInterval === 'lifetime';
  const planBadge =
    isLifetime       ? { text: t.plan.lifetimeShort, bg: 'bg-teal-600',     medal: true  } :
    plan === 'pro'   ? { text: t.plan.proShort,      bg: 'bg-brand-orange', medal: false } :
    plan === 'fleet' ? { text: t.plan.fleetShort,    bg: 'bg-blue-600',     medal: false } :
    null;

  const [active,  setActive]  = useState<TabId>('calculator');
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set<TabId>(['calculator']));
  const [historyKey, setHistoryKey] = useState(0); // bump to refresh FillupHistory on entry

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

  function changeTab(id: TabId) {
    if (id === active) return;
    setActive(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    if (id === 'history') setHistoryKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: 'instant' });
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
    <main className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900">

      {/* First-launch brand video overlay (inert until the MP4 is added — see component) */}
      <FirstLaunchSplash />

      {/* Native title bar — navy, doubles as the status-bar strip (safe-area top inset) */}
      <header
        className="sticky top-0 z-30 bg-[#1e3a5f] text-white shadow-sm"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="h-12 flex items-center justify-center px-4 relative">
          <h1 className="text-base font-bold tracking-tight">{title}</h1>
          {planBadge && (
            <span
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black
                          text-white px-2 py-0.5 rounded-full ${planBadge.bg}`}
            >
              {planBadge.medal ? '🏅 ' : ''}{planBadge.text.toUpperCase()}
            </span>
          )}
        </div>
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
            <div className="px-4 pt-4 pb-2 max-w-lg mx-auto w-full">
              <CalculatorTabs />
            </div>
          </div>
        )}

        {visited.has('history') && (
          <div className={show('history')}>
            {isGuest ? (
              <TabLockGate
                icon="⛽"
                title="Track every fill-up"
                subtitle="Sign in to log your fill-ups, watch your MPG, and see your fuel costs over time."
                bullets={['Automatic MPG tracking', 'Fuel cost history & trends', 'Every fill-up earns giveaway entries']}
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
                title="Unlock your fuel tools"
                subtitle="Sign in to use the AI Fuel Advisor, trip planner, MPG charts, and station comparison."
                bullets={['AI Fuel Advisor', 'Trip & budget planning', 'MPG charts & stats']}
              />
            ) : (
              <div className="px-4 pt-4 max-w-lg mx-auto w-full">
                <ToolsPanel />
              </div>
            )}
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

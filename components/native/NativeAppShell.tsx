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

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';

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
  // Guest = confirmed not-signed-in (don't gate while the session is still loading,
  // or signed-in tabs would flash the lock screen on every open).
  const isGuest = status === 'unauthenticated';

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

  const title = TABS.find((t) => t.id === active)?.label ?? 'GasCap';
  const show  = (id: TabId) => (id === active ? '' : 'hidden');

  return (
    <main className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900">

      {/* Native title bar — navy, doubles as the status-bar strip (safe-area top inset) */}
      <header
        className="sticky top-0 z-30 bg-[#1e3a5f] text-white shadow-sm"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="h-12 flex items-center justify-center px-4">
          <h1 className="text-base font-bold tracking-tight">{title}</h1>
        </div>
      </header>

      {/* Essential in-app overlays (marketing chrome is intentionally not mounted) */}
      <TrialExpiryBanner />
      {session && <WinnerBanner />}
      <AnnouncementToast />

      {/* Tab content — each tab mounts on first visit, then hides (state preserved).
          Padding-bottom clears the fixed tab bar + the home-indicator safe area. */}
      <div className="flex-1" style={{ paddingBottom: 'calc(88px + env(safe-area-inset-bottom))' }}>

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

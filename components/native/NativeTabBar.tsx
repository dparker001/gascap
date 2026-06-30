'use client';

/**
 * NativeTabBar — fixed, safe-area-aware bottom navigation for the iOS/Android
 * wrappers. Five icon+label buttons; active = brand teal, inactive = slate.
 * Pure web/CSS (no Capacitor plugins) so it ships live with no rebuild.
 *
 * Rendered only by NativeAppShell, which mounts only inside the native wrappers
 * (useIsNative). The web site never renders this.
 */

import type { TabId } from './NativeAppShell';


export interface TabMeta {
  id:    TabId;
  label: string;
}

interface Props {
  tabs:     TabMeta[];
  active:   TabId;
  onChange: (id: TabId) => void;
}

/** 24px Lucide-style stroke icons, keyed by tab id. Inherit `currentColor`. */
const ICONS: Record<TabId, JSX.Element> = {
  calculator: (
    <>
      <rect width="16" height="20" x="4" y="2" rx="2" />
      <line x1="8" x2="16" y1="6" y2="6" />
      <line x1="8" x2="8" y1="10" y2="10.01" />
      <line x1="12" x2="12" y1="10" y2="10.01" />
      <line x1="16" x2="16" y1="10" y2="10.01" />
      <line x1="8" x2="8" y1="14" y2="14.01" />
      <line x1="12" x2="12" y1="14" y2="14.01" />
      <line x1="8" x2="8" y1="18" y2="18.01" />
      <line x1="12" x2="12" y1="18" y2="18.01" />
      <line x1="16" x2="16" y1="14" y2="18" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  tools: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  findgas: (
    <>
      <path d="M3 22V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16"/>
      <path d="M3 11h11"/>
      <path d="M14 6h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V7l-3-3"/>
      <path d="M3 22h11"/>
    </>
  ),
  rewards: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </>
  ),
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

export default function NativeTabBar({ tabs, active, onChange }: Props) {
  return (
    <nav
      className="flex-shrink-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur
                 border-t border-slate-200 dark:border-slate-800"
      aria-label="Primary"
    >
      {/* Button row — fixed height, independent of safe-area math */}
      <div
        className="flex h-[52px]"
        style={{
          paddingLeft:  'calc(env(safe-area-inset-left) + 8px)',
          paddingRight: 'calc(env(safe-area-inset-right) + 8px)',
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5
                          transition-colors active:bg-slate-100 dark:active:bg-slate-800
                          ${isActive
                            ? 'text-teal-600 dark:text-teal-400'
                            : 'text-slate-400 dark:text-slate-500'}`}
            >
              <svg
                width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
              >
                {ICONS[tab.id]}
              </svg>
              <span className="text-[10px] font-medium leading-none">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Safe-area spacer — sits below buttons, never overlaps them */}
      <div style={{ height: 'max(env(safe-area-inset-bottom), 8px)' }} />
    </nav>
  );
}

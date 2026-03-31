'use client';

import { useEffect } from 'react';

const DARK_MODE_KEY = 'gascap_theme';

// Possible values in localStorage:
//   'dark'  — always dark
//   'light' — always light
//   'auto'  — (or missing) follow OS prefers-color-scheme (syncs with sunrise/sunset on iOS/macOS/Android)

function applyTheme() {
  try {
    const saved = localStorage.getItem(DARK_MODE_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const shouldBeDark =
      saved === 'dark' ||
      (saved !== 'light' && prefersDark); // 'auto' or not set → follow OS

    if (shouldBeDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch {
    // localStorage or matchMedia blocked — no-op
  }
}

/**
 * Reads `localStorage.gascap_theme` on mount, then watches for OS-level
 * prefers-color-scheme changes (fires automatically at sunrise/sunset on iOS,
 * macOS, and Android when auto-brightness is on).
 */
export default function DarkModeProvider() {
  useEffect(() => {
    applyTheme();

    // Re-apply when the OS switches between light and dark (sunrise/sunset)
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', applyTheme);
    } catch {}

    return () => {
      try { mq?.removeEventListener('change', applyTheme); } catch {}
    };
  }, []);

  return null;
}

// ── Exported helpers (used by Settings page) ──────────────────────────────────

export type ThemePreference = 'auto' | 'light' | 'dark';

/** Set preference and immediately apply */
export function setThemePreference(pref: ThemePreference): void {
  try {
    if (pref === 'auto') {
      localStorage.removeItem(DARK_MODE_KEY);
    } else {
      localStorage.setItem(DARK_MODE_KEY, pref);
    }
    applyTheme();
  } catch {}
}

/** Read the current stored preference ('auto' if not set) */
export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(DARK_MODE_KEY);
    if (v === 'dark' || v === 'light') return v;
    return 'auto';
  } catch {
    return 'auto';
  }
}

/** Toggle dark mode (cycles: auto → dark → light → auto) */
export function toggleDarkMode(): boolean {
  const current = getThemePreference();
  const next: ThemePreference = current === 'auto' ? 'dark' : current === 'dark' ? 'light' : 'auto';
  setThemePreference(next);
  return document.documentElement.classList.contains('dark');
}

/** Read current rendered dark mode state */
export function isDarkMode(): boolean {
  try {
    return document.documentElement.classList.contains('dark');
  } catch {
    return false;
  }
}

'use client';

import { useEffect } from 'react';

const DARK_MODE_KEY = 'gascap_theme';

/**
 * Reads `localStorage.gascap_theme` on mount and applies / removes the
 * `dark` class on `<html>`.  Must be rendered client-side so it runs in the
 * browser, not during SSR (which avoids hydration mismatches).
 */
export default function DarkModeProvider() {
  useEffect(() => {
    try {
      const theme = localStorage.getItem(DARK_MODE_KEY);
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch {
      // localStorage blocked — no-op
    }
  }, []);

  return null; // renders nothing
}

/** Toggle dark mode from anywhere in the app */
export function toggleDarkMode(): boolean {
  try {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem(DARK_MODE_KEY, isDark ? 'dark' : 'light');
    return isDark;
  } catch {
    return false;
  }
}

/** Read current dark mode state */
export function isDarkMode(): boolean {
  try {
    return localStorage.getItem(DARK_MODE_KEY) === 'dark';
  } catch {
    return false;
  }
}

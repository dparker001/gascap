'use client';

/**
 * Native-app detection for the iOS (Capacitor) and Android (TWA) wrappers.
 *
 * Both wrappers load the live site, so we detect "am I running inside a wrapped
 * native app?" so the web UI can hide things the App Store / Play policies don't
 * allow inside the app — primarily the in-app purchase / subscribe flows (we sell
 * Pro via Stripe, which would otherwise require Apple IAP / Play Billing). In the
 * native apps the product is a free utility; upgrades happen on the web.
 *
 * Detection signals (any one is sufficient, result persisted for the session):
 *  - window.Capacitor            → our iOS shell
 *  - ?native=ios|android in URL  → both wrappers load the site with this marker
 *  - android-app:// referrer     → Android TWA launch
 *  - persisted localStorage flag → survives in-app navigation
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'gc_native_platform';

type NativePlatform = 'ios' | 'android';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export function detectNativePlatform(): NativePlatform | null {
  if (typeof window === 'undefined') return null;

  // 1. Capacitor (iOS shell) injects a global
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  const capPlatform = cap?.getPlatform?.();
  if ((cap?.isNativePlatform?.() || capPlatform) && (capPlatform === 'ios' || capPlatform === 'android')) {
    persist(capPlatform);
    return capPlatform;
  }

  try {
    // 2. URL marker appended by the wrappers (?native=ios / ?native=android)
    const param = new URLSearchParams(window.location.search).get('native');
    if (param === 'ios' || param === 'android') { persist(param); return param; }

    // 3. Android TWA launches with an android-app:// referrer
    if (document.referrer.startsWith('android-app://')) { persist('android'); return 'android'; }

    // 4. Persisted from an earlier signal this session
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ios' || stored === 'android') return stored;
  } catch { /* storage / URL access blocked — treat as web */ }

  return null;
}

function persist(platform: NativePlatform): void {
  try { window.localStorage.setItem(STORAGE_KEY, platform); } catch { /* ignore */ }
}

/** Returns 'ios' | 'android' | null. SSR-safe (null until mounted). */
export function useNativePlatform(): NativePlatform | null {
  const [platform, setPlatform] = useState<NativePlatform | null>(null);
  useEffect(() => { setPlatform(detectNativePlatform()); }, []);
  return platform;
}

/** True when running inside the wrapped iOS or Android app. */
export function useIsNative(): boolean {
  return useNativePlatform() !== null;
}

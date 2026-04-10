'use client';

/**
 * LanguageContext — provides the active locale and a toggle function.
 * Persists the user's preference in localStorage under 'gascap_locale'.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { type Locale, type Translations, getTranslations } from '@/lib/translations';

const STORAGE_KEY = 'gascap_locale';

interface LanguageContextValue {
  locale:  Locale;
  t:       Translations;
  toggle:  () => void;
  setLocale: (l: Locale) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  locale:    'en',
  t:         getTranslations('en'),
  toggle:    () => {},
  setLocale: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  // Hydrate locale on mount, honoring (in priority order):
  //   1. `?lang=en|es` in the URL — set by /q/[code] on QR scans and by
  //      /verify-email?lang=… on email-verification click-throughs. This
  //      wins so a Spanish QR always lands in Spanish even if the browser
  //      has a stale English value from a prior visitor on a shared device.
  //   2. `gascap_locale` in localStorage — the user's previous manual choice.
  //
  // When #1 hits we also persist it to localStorage so return visits stay
  // in the same language without needing the query param again.
  useEffect(() => {
    try {
      // 1. URL param wins
      const urlLang = new URLSearchParams(window.location.search).get('lang');
      if (urlLang === 'en' || urlLang === 'es') {
        setLocaleState(urlLang);
        localStorage.setItem(STORAGE_KEY, urlLang);
        return;
      }
      // 2. Fall back to saved preference
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (saved === 'en' || saved === 'es') setLocaleState(saved);
    } catch { /* localStorage / window unavailable in SSR */ }
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  }

  function toggle() {
    setLocale(locale === 'en' ? 'es' : 'en');
  }

  const t = getTranslations(locale);

  return (
    <LanguageContext.Provider value={{ locale, t, toggle, setLocale }}>
      {children}
    </LanguageContext.Provider>
  );
}

/** Drop-in hook: const { t, locale, toggle } = useTranslation(); */
export function useTranslation() {
  return useContext(LanguageContext);
}

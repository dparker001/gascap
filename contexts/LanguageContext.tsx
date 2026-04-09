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

  // Hydrate from localStorage on mount (client only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (saved === 'en' || saved === 'es') setLocaleState(saved);
    } catch { /* localStorage unavailable in SSR */ }
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

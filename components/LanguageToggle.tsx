'use client';

/**
 * LanguageToggle — the 🌐 EN/ES switcher. Flips the locale (persisted to
 * localStorage by LanguageContext) so a Spanish speaker can switch instantly.
 * Styled for dark/navy backgrounds (web Header, BrandBar, native title bar).
 */

import { useTranslation } from '@/contexts/LanguageContext';

export default function LanguageToggle({ className = '' }: { className?: string }) {
  const { locale, toggle } = useTranslation();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={locale === 'en' ? 'Switch to Spanish' : 'Cambiar a inglés'}
      className={`flex items-center gap-1 bg-white/10 hover:bg-white/20 active:bg-white/25
                  transition-colors rounded-xl px-2.5 py-1.5 ${className}`}
    >
      <span className="text-sm" aria-hidden="true">🌐</span>
      <span className="text-[10px] font-black text-white/80">{locale === 'en' ? 'ES' : 'EN'}</span>
    </button>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useTranslation } from '@/contexts/LanguageContext';

/** Sits directly under BrandBar on every Rental Return Assistant page — an
 * obvious way back to the main calculator, since this feature now fully
 * takes over from the gas calculator's old inline Rental Car Return Mode.
 *
 * Deliberately NOT a plain <Link> — the gas calculator redirects straight
 * back here whenever 'gc_rental_mode_active' is true (see TargetFillForm's
 * redirect effect), so navigating to "/" while that flag is still set from
 * this session would just bounce right back. Clear it first. */
export default function BackToCalculatorBar() {
  const { t } = useTranslation();
  const router = useRouter();

  function handleClick() {
    try { localStorage.setItem('gc_rental_mode_active', 'false'); } catch { /* ignore */ }
    router.push('/');
  }

  return (
    <div className="pt-16 px-4 max-w-lg mx-auto">
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1 text-xs font-bold text-teal-600 hover:text-teal-800 py-2"
      >
        <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M10 6H2M5 2 1 6l4 4" />
        </svg>
        {t.rentalReturn.backToCalculator}
      </button>
    </div>
  );
}

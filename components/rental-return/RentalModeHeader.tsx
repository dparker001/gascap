'use client';

/**
 * Mode header for every Rental Return Assistant page. Fills the dead space
 * under the fixed BrandBar with an explicit "you are in Rental Car Mode"
 * marker, and carries the way back to the calculator.
 *
 * Blue, matching the calculator's Rental Car Mode toggle — the two surfaces
 * should read as the same mode.
 */

import { useRouter } from 'next/navigation';
import { useTranslation } from '@/contexts/LanguageContext';

export default function RentalModeHeader({ subtitle }: { subtitle?: string }) {
  const { t } = useTranslation();
  const router = useRouter();

  function backToCalculator() {
    // The calculator redirects straight back here while this flag is set,
    // so clear it before navigating or the trip is a no-op.
    try { localStorage.setItem('gc_rental_mode_active', 'false'); } catch { /* ignore */ }
    router.push('/');
  }

  return (
    <div className="pt-16 px-4 max-w-lg mx-auto">
      <div className="flex items-center gap-2.5 bg-blue-50 border-2 border-blue-400 rounded-2xl px-4 py-3">
        <span className="text-xl flex-shrink-0" aria-hidden="true">🚗</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-blue-800 leading-none">{t.rentalReturn.modeHeaderTitle}</p>
          <p className="text-[10px] text-blue-600 mt-0.5 leading-snug">
            {subtitle ?? t.rentalReturn.modeHeaderSubtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={backToCalculator}
          className="flex-shrink-0 text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-white border border-blue-200 rounded-lg px-2 py-1.5 transition-colors"
        >
          {t.rentalReturn.exitToCalculator}
        </button>
      </div>
    </div>
  );
}

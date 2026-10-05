'use client';

/**
 * The two ways to add a rental. A future reservation needs no vehicle or fuel
 * information — the car is added at pickup — so it must never be hidden behind
 * the full vehicle wizard.
 */
import { useTranslation } from '@/contexts/LanguageContext';

export function BackToMyRentals({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="max-w-lg mx-auto px-4 pt-2">
      <button
        type="button"
        onClick={onBack}
        aria-label={t.rentalReturn.addRentalBack}
        className="inline-flex items-center gap-1 py-2 text-xs font-bold text-blue-600 hover:text-blue-800"
      >
        <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M10 6H2M5 2 1 6l4 4" />
        </svg>
        {t.rentalReturn.addRentalBack}
      </button>
    </div>
  );
}

export default function AddRentalChooser({ onReservation, onVehicle, onBack }: {
  onReservation: () => void;
  onVehicle:     () => void;
  onBack:        () => void;
}) {
  const { t } = useTranslation();
  const r = t.rentalReturn;
  const card = 'w-full text-left bg-white rounded-2xl border-2 border-slate-200 hover:border-blue-400 focus-visible:border-blue-500 focus-visible:outline-none px-4 py-4 shadow-sm transition-colors';
  return (
    <>
      <BackToMyRentals onBack={onBack} />
      <section aria-labelledby="add-rental-title" className="max-w-lg mx-auto px-4 pb-8 pt-2 space-y-3">
        <h1 id="add-rental-title" className="text-lg font-black text-navy-700 text-center">{r.addRentalChooseTitle}</h1>

        <button type="button" onClick={onReservation} aria-describedby="add-rental-reservation-desc" data-testid="add-rental-reservation" className={card}>
          <span className="flex items-start gap-3">
            <span className="text-2xl leading-none" aria-hidden="true">🗓</span>
            <span className="flex-1">
              <span className="block text-sm font-black text-slate-800">{r.addRentalReservationTitle}</span>
              <span id="add-rental-reservation-desc" className="block text-xs text-slate-500 leading-snug mt-1">{r.addRentalReservationBody}</span>
            </span>
          </span>
        </button>

        <button type="button" onClick={onVehicle} aria-describedby="add-rental-vehicle-desc" data-testid="add-rental-vehicle" className={card}>
          <span className="flex items-start gap-3">
            <span className="text-2xl leading-none" aria-hidden="true">🚗</span>
            <span className="flex-1">
              <span className="block text-sm font-black text-slate-800">{r.addRentalVehicleTitle}</span>
              <span id="add-rental-vehicle-desc" className="block text-xs text-slate-500 leading-snug mt-1">{r.addRentalVehicleBody}</span>
            </span>
          </span>
        </button>
      </section>
    </>
  );
}

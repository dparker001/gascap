'use client';

/** Rental History — completed sessions, section 23. */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useTranslation } from '@/contexts/LanguageContext';
import BrandBar from '@/components/BrandBar';
import BackToCalculatorBar from '@/components/rental-return/BackToCalculatorBar';
import { formatGallons } from '@/lib/rentalCalculations';
import type { RentalSession } from '@/lib/rentalSessions';
import type { FuelDataSource } from '@/lib/rentalProvider';

export default function RentalHistoryPage() {
  const { data: authSession, status } = useSession();
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<RentalSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== 'authenticated') { setLoading(false); return; }
    fetch('/api/rental-sessions?status=completed')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.sessions) setSessions(d.sessions); })
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div className="min-h-screen bg-[#eef1f7]">
      <BrandBar />
      <BackToCalculatorBar />
      <div className="px-4 max-w-lg mx-auto pb-8 space-y-3">
        <h1 className="text-lg font-black text-navy-700 text-center mb-2">{t.rentalReturn.historyTitle}</h1>

        {status === 'loading' || loading ? (
          <div className="h-24 bg-white rounded-2xl animate-pulse" />
        ) : !authSession ? (
          <p className="text-sm text-slate-500 text-center">{t.rentalReturn.signInRequired}</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-10">{t.rentalReturn.noHistory}</p>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-800">{s.rentalCompany}</p>
                <p className="text-[11px] text-slate-400">{s.completedAt ? new Date(s.completedAt).toLocaleDateString() : ''}</p>
              </div>
              <p className="text-xs text-slate-500">{[s.vehicleYear, s.vehicleMake, s.vehicleModel].filter(Boolean).join(' ')}</p>
              <div className="flex items-center gap-3 text-[11px] text-slate-500 pt-1">
                <span>{t.rentalReturn.historyPickup}: {formatGallons(s.pickupFuelGallons, s.pickupFuelSource as FuelDataSource)}</span>
                <span>{t.rentalReturn.historyFinal}: {formatGallons(s.currentFuelGallons, s.currentFuelSource as FuelDataSource)}</span>
              </div>
              {s.fuelFeeCharged != null && (
                <p className={`text-[11px] font-bold ${s.fuelFeeCharged ? 'text-red-500' : 'text-emerald-600'}`}>
                  {s.fuelFeeCharged ? t.rentalReturn.historyFeeCharged(s.fuelFeeAmount) : t.rentalReturn.historyNoFee}
                </p>
              )}
            </div>
          ))
        )}

        <Link href="/rental-return" className="block text-center text-xs font-bold text-teal-600 hover:text-teal-800 pt-2">
          ← {t.rentalReturn.backToRentals}
        </Link>
      </div>
    </div>
  );
}

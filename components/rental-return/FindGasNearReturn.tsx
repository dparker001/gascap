'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import type { NearbyStation } from '@/lib/nearbyGas';
import { classifyNearbyResponse, type NearbyResponseBody } from '@/lib/nearbyResponse';
import { estimatedFuelCost, estimatedRentalCompanyCharge, estimatedSavings, rankStations } from '@/lib/rentalCalculations';

interface Props {
  /** Station search is scoped to this rental (see app/gas/rental-nearby). */
  rentalSessionId:       string;
  returnLat?:            number | null;
  returnLng?:            number | null;
  gallonsNeeded:         number;
  rentalRatePerGallon?:  number | null;
}

// Uses the rental-scoped /gas/rental-nearby (same station search and data as
// Find Gas, via lib/nearbyGas) with rental-specific cost math layered on top.
// That route keeps working for an ACTIVE rental after Pro lapses — the
// generic /gas/nearby is Pro-gated, which stranded lapsed renters.
export default function FindGasNearReturn({ rentalSessionId, returnLat, returnLng, gallonsNeeded: needed, rentalRatePerGallon }: Props) {
  const { t } = useTranslation();
  const [stations, setStations] = useState<NearbyStation[]>([]);
  const [status, setStatus]     = useState<'idle' | 'loading' | 'done' | 'error' | 'no_location' | 'pro_required' | 'disabled'>('idle');

  useEffect(() => {
    if (returnLat == null || returnLng == null) { setStatus('no_location'); return; }
    setStatus('loading');
    fetch(`/gas/rental-nearby?rentalId=${encodeURIComponent(rentalSessionId)}`, { cache: 'no-store' })
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) as (NearbyResponseBody & { stations?: NearbyStation[] }) | null }))
      .then(({ ok, body }) => {
        // A Pro refusal / live prices off / server error is NOT "no stations
        // near your return" — say which one it is.
        const kind = classifyNearbyResponse(ok, body);
        if (kind !== 'ok') { setStatus(kind); return; }
        setStations(body?.stations ?? []);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, [rentalSessionId, returnLat, returnLng]);

  if (status === 'no_location') {
    return (
      <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-center">
        {t.rentalReturn.noReturnLocation}
      </p>
    );
  }
  if (status === 'loading') {
    return <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />;
  }
  if (status === 'error') {
    return <p className="text-xs text-red-500 text-center">{t.rentalReturn.findGasError}</p>;
  }
  if (status === 'pro_required') {
    return (
      <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-center">
        {t.rentalReturn.findGasProRequired}
      </p>
    );
  }
  if (status === 'disabled') {
    return <p className="text-xs text-slate-400 text-center">{t.rentalReturn.findGasUnavailable}</p>;
  }

  const withPrice = stations.filter((s) => s.prices.length > 0);
  const ranked = rankStations(
    withPrice.map((s) => ({
      station: s,
      pricePerGallon: s.prices.find((p) => p.type === 'REGULAR')?.price ?? s.prices[0].price,
      distanceFromReturnMi: s.distanceMi,
    })),
  ).slice(0, 5);

  if (ranked.length === 0) {
    return <p className="text-xs text-slate-400 text-center">{t.rentalReturn.noStationsFound}</p>;
  }

  return (
    <div className="space-y-2">
      {ranked.map(({ station, pricePerGallon }) => {
        const cost   = estimatedFuelCost(needed, pricePerGallon);
        const charge = estimatedRentalCompanyCharge(needed, rentalRatePerGallon);
        const savings = estimatedSavings(charge, cost);
        return (
          <div key={station.placeId} className="bg-white rounded-xl border border-slate-200 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{station.name}</p>
                <p className="text-[11px] text-slate-400">{t.rentalReturn.miFromReturn(station.distanceMi)}</p>
              </div>
              <p className="text-sm font-black text-slate-800 flex-shrink-0">${pricePerGallon.toFixed(2)}</p>
            </div>
            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-100">
              <span className="text-[11px] text-slate-500">{t.rentalReturn.estCostHere(cost)}</span>
              {savings != null && (
                <span className={`text-[11px] font-bold ${savings >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {savings >= 0 ? t.rentalReturn.saveVsRental(savings) : t.rentalReturn.costMoreVsRental(Math.abs(savings))}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import {
  gallonsNeeded, estimatedRentalCompanyCharge,
  returnReadyStatus, formatGallons, fuelSourceLabel,
} from '@/lib/rentalCalculations';
import { gallonsFromGaugeFraction, gallonsFromPercent } from '@/lib/rentalProvider';
import { trackRentalGasNearReturnViewed, trackRentalReturnReadyViewed } from '@/lib/gtag';
import type { FuelDataSource } from '@/lib/rentalProvider';
import type { RentalSession } from '@/lib/rentalSessions';
import RefuelLogModal from './RefuelLogModal';
import CompleteRentalModal from './CompleteRentalModal';
import FindGasNearReturn from './FindGasNearReturn';

const GAUGE_OPTIONS = ['Full', '7/8', '3/4', '5/8', '1/2', '3/8', '1/4', '1/8', 'Empty'];

function returnCountdown(returnDateTime: string | null): string | null {
  if (!returnDateTime) return null;
  const diffMs = new Date(returnDateTime).getTime() - Date.now();
  if (diffMs <= 0) return null;
  const hours = Math.floor(diffMs / 3_600_000);
  const mins  = Math.floor((diffMs % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export default function RentalDashboard({ sessionId, onCompleted }: { sessionId: string; onCompleted: () => void }) {
  const { t } = useTranslation();
  const [session, setSession] = useState<RentalSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUpdateFuel, setShowUpdateFuel] = useState(false);
  const [showRefuel, setShowRefuel] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [showFindGas, setShowFindGas] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/rental-sessions/${sessionId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.session) setSession(d.session); })
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (session) trackRentalReturnReadyViewed(returnReadyStatus(session.currentFuelGallons, session.requiredReturnFuelGallons));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.currentFuelGallons, session?.requiredReturnFuelGallons]);

  if (loading || !session) {
    return <div className="max-w-lg mx-auto px-4 py-10"><div className="h-40 bg-slate-100 rounded-2xl animate-pulse" /></div>;
  }

  const needed   = gallonsNeeded(session.requiredReturnFuelGallons ?? 0, session.currentFuelGallons ?? 0);
  const status   = returnReadyStatus(session.currentFuelGallons, session.requiredReturnFuelGallons);
  const rentalCharge = estimatedRentalCompanyCharge(needed, session.rentalFuelChargePerGallon);
  const countdown = returnCountdown(session.returnDateTime);

  const statusConfig = {
    needs_fuel:   { label: t.rentalReturn.statusNeedsFuel,   color: 'bg-red-50 border-red-200 text-red-700' },
    nearly_ready: { label: t.rentalReturn.statusNearlyReady, color: 'bg-amber-50 border-amber-200 text-amber-700' },
    return_ready: { label: t.rentalReturn.statusReturnReady, color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  }[status];

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black text-slate-900">{session.rentalCompany}</p>
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${statusConfig.color}`}>
            {statusConfig.label}
          </span>
        </div>
        <p className="text-xs text-slate-500">
          {[session.vehicleYear, session.vehicleMake, session.vehicleModel].filter(Boolean).join(' ')}
        </p>
        {countdown && (
          <p className="text-xs font-bold text-blue-600 mt-1">{t.rentalReturn.returnIn(countdown)}</p>
        )}
        {session.returnLocation && <p className="text-[11px] text-slate-400">{session.returnLocation}</p>}
      </div>

      {/* Fuel numbers */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-center">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.target}</p>
            <p className="text-lg font-black text-slate-800">{formatGallons(session.requiredReturnFuelGallons, 'MANUAL_GALLONS')}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.currentEstimated}</p>
            <p className="text-lg font-black text-slate-800">{formatGallons(session.currentFuelGallons, session.currentFuelSource as FuelDataSource)}</p>
          </div>
        </div>
        {session.currentFuelSource && (
          <p className="text-[10px] text-slate-400 text-center">{fuelSourceLabel(session.currentFuelSource as FuelDataSource)}</p>
        )}

        {needed > 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-center">
            <p className="text-sm font-black text-amber-800">{t.rentalReturn.addApprox(needed)}</p>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-center">
            <p className="text-sm font-black text-emerald-800">{t.rentalReturn.noFuelNeeded}</p>
          </div>
        )}

        <button onClick={() => setShowUpdateFuel((v) => !v)} className="w-full text-xs font-bold text-teal-600 hover:text-teal-800">
          {t.rentalReturn.updateCurrentFuel}
        </button>
        {showUpdateFuel && (
          <UpdateFuelInline
            tankCapacity={session.fuelTankCapacityGallons}
            onSaved={(gallons, source) => {
              fetch(`/api/rental-sessions/${sessionId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentFuelGallons: gallons, currentFuelSource: source }),
              }).then(load);
              setShowUpdateFuel(false);
            }}
          />
        )}
      </div>

      {/* Cost comparison — only if rate is known */}
      {needed > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{t.rentalReturn.costComparison}</p>
          {session.rentalFuelChargePerGallon != null && rentalCharge != null && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">{t.rentalReturn.rentalCompanyEstimate}</span>
                <span className="font-black text-red-600">~${rentalCharge.toFixed(2)}</span>
              </div>
            </>
          )}
          <p className="text-[10px] text-slate-400">{t.rentalReturn.priceDisclaimer}</p>
          <button onClick={() => { setShowFindGas((v) => !v); trackRentalGasNearReturnViewed(); }} className="w-full py-2.5 rounded-xl bg-[#005F4A] text-white text-sm font-bold mt-1">
            {t.rentalReturn.findGasNearReturn}
          </button>
        </div>
      )}

      {showFindGas && (
        <FindGasNearReturn
          returnLat={session.returnLatitude} returnLng={session.returnLongitude}
          gallonsNeeded={needed} rentalRatePerGallon={session.rentalFuelChargePerGallon}
        />
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button onClick={() => setShowRefuel(true)} className="flex-1 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 text-sm font-bold">
          ⛽ {t.rentalReturn.iJustRefueled}
        </button>
        <button onClick={() => setShowComplete(true)} className="flex-1 py-3 rounded-2xl bg-[#005F4A] text-white text-sm font-bold">
          {t.rentalReturn.completeRental}
        </button>
      </div>

      {session.refuelLogs.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">{t.rentalReturn.refuelLog}</p>
          <div className="space-y-2">
            {session.refuelLogs.map((r) => (
              <div key={r.id} className="flex justify-between text-xs text-slate-600">
                <span>{r.gallons} gal{r.stationName ? ` · ${r.stationName}` : ''}</span>
                {r.totalPaid != null && <span className="font-bold">${r.totalPaid.toFixed(2)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-slate-400 text-center leading-relaxed px-2">{t.rentalReturn.disclaimer}</p>

      {showRefuel && (
        <RefuelLogModal
          onClose={() => setShowRefuel(false)}
          onSaved={() => { setShowRefuel(false); load(); }}
          sessionId={sessionId}
        />
      )}
      {showComplete && (
        <CompleteRentalModal
          onClose={() => setShowComplete(false)}
          onCompleted={() => { setShowComplete(false); onCompleted(); }}
          sessionId={sessionId}
        />
      )}
    </div>
  );
}

function UpdateFuelInline({ tankCapacity, onSaved }: { tankCapacity: number | null; onSaved: (gallons: number, source: FuelDataSource) => void }) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<'gauge' | 'percent' | 'gallons'>('gauge');
  const [gauge, setGauge] = useState('3/4');
  const [percent, setPercent] = useState('');
  const [gallons, setGallons] = useState('');

  function resolve(): { gallons: number; source: FuelDataSource } | null {
    if (method === 'gauge') {
      const g = gallonsFromGaugeFraction(gauge, tankCapacity ?? 0);
      return g != null ? { gallons: g, source: 'MANUAL_GAUGE' } : null;
    }
    if (method === 'percent') {
      const g = gallonsFromPercent(Number(percent), tankCapacity ?? 0);
      return g != null ? { gallons: g, source: 'MANUAL_PERCENT' } : null;
    }
    const g = Number(gallons);
    return g > 0 ? { gallons: g, source: 'MANUAL_GALLONS' } : null;
  }

  const resolved = resolve();

  return (
    <div className="space-y-2 bg-slate-50 rounded-xl p-3">
      <div className="flex gap-1.5">
        {(['gauge', 'percent', 'gallons'] as const).map((m) => (
          <button key={m} onClick={() => setMethod(m)}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold ${method === m ? 'bg-[#005F4A] text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>
            {m === 'gauge' ? t.rentalReturn.methodGauge : m === 'percent' ? t.rentalReturn.methodPercent : t.rentalReturn.methodGallons}
          </button>
        ))}
      </div>
      {method === 'gauge' && (
        <div className="grid grid-cols-3 gap-1.5">
          {GAUGE_OPTIONS.map((g) => (
            <button key={g} onClick={() => setGauge(g)}
              className={`py-1.5 rounded-lg text-xs font-bold ${gauge === g ? 'bg-[#005F4A] text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
              {g}
            </button>
          ))}
        </div>
      )}
      {method === 'percent' && (
        <input type="number" inputMode="decimal" min="0" max="100" placeholder="80" value={percent} onChange={(e) => setPercent(e.target.value)} className="input-field text-sm" />
      )}
      {method === 'gallons' && (
        <input type="number" inputMode="decimal" min="0" step="0.1" placeholder="12.6" value={gallons} onChange={(e) => setGallons(e.target.value)} className="input-field text-sm" />
      )}
      <button
        disabled={!resolved}
        onClick={() => resolved && onSaved(resolved.gallons, resolved.source)}
        className="w-full py-2 rounded-lg bg-[#005F4A] text-white text-xs font-bold disabled:opacity-40"
      >
        {t.rentalReturn.save}
      </button>
    </div>
  );
}

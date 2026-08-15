'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/contexts/LanguageContext';
import {
  gallonsNeeded, estimatedRentalCompanyCharge,
  returnReadyStatus, formatGallons, fuelSourceLabel, refuelTotals,
} from '@/lib/rentalCalculations';
import { gallonsFromGaugeFraction, gallonsFromPercent } from '@/lib/rentalProvider';
import { trackRentalGasNearReturnViewed, trackRentalReturnReadyViewed } from '@/lib/gtag';
import type { FuelDataSource } from '@/lib/rentalProvider';
import type { RentalSession } from '@/lib/rentalSessions';
import RefuelLogModal from './RefuelLogModal';
import CompleteRentalModal from './CompleteRentalModal';
import FindGasNearReturn from './FindGasNearReturn';
import EditRentalModal from './EditRentalModal';
import VehicleBodyIcon from './VehicleBodyIcon';
import { inferBodyType } from '@/lib/vehicleBodyType';

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
  const [showEdit, setShowEdit] = useState(false);

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

  // `chip` is for the tinted hero (needs to read against a dark gradient);
  // plain white/tinted backgrounds elsewhere use the same palette family.
  const statusConfig = {
    needs_fuel:   { label: t.rentalReturn.statusNeedsFuel,   chip: 'bg-red-400/90 text-white' },
    nearly_ready: { label: t.rentalReturn.statusNearlyReady, chip: 'bg-amber-400 text-amber-950' },
    return_ready: { label: t.rentalReturn.statusReturnReady, chip: 'bg-white text-emerald-700' },
  }[status];

  const bodyType = inferBodyType({
    model:       session.vehicleModel,
    tankGallons: session.fuelTankCapacityGallons,
  });

  const tankCapacity = session.fuelTankCapacityGallons ?? 0;
  const currentPct = tankCapacity > 0
    ? Math.min(100, Math.max(0, ((session.currentFuelGallons ?? 0) / tankCapacity) * 100))
    : 0;
  const targetPct = tankCapacity > 0 && session.requiredReturnFuelGallons != null
    ? Math.min(100, Math.max(0, (session.requiredReturnFuelGallons / tankCapacity) * 100))
    : 0;

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
      <Link href="/rental-return" className="inline-flex items-center gap-1 text-xs font-bold text-teal-600 hover:text-teal-800">
        <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M10 6H2M5 2 1 6l4 4" />
        </svg>
        {t.rentalReturn.myRentals}
      </Link>

      {/* Hero — vehicle identity, agreement number, countdown, status */}
      <div className="relative overflow-hidden rounded-2xl shadow-sm bg-gradient-to-br from-[#004638] via-[#005F4A] to-[#1EB68F] p-4 text-white">
        {/* Oversized watermark silhouette — decorative depth, not a control */}
        <VehicleBodyIcon
          bodyType={bodyType}
          className="absolute -right-4 -bottom-5 w-36 h-36 text-white/10 pointer-events-none"
        />

        <div className="relative flex items-start gap-3">
          <div className="flex-shrink-0 w-11 h-11 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
            <VehicleBodyIcon bodyType={bodyType} className="w-7 h-7 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-black leading-tight truncate">{session.rentalCompany}</p>
            <p className="text-[11px] text-white/70 truncate">
              {[session.vehicleYear, session.vehicleMake, session.vehicleModel].filter(Boolean).join(' ') || t.rentalReturn.vehicleUnknown}
            </p>
            {session.rentalAgreementNumber && (
              <p className="text-[10px] text-white/60 font-mono mt-1 truncate">
                {t.rentalReturn.agreementNumberShort} {session.rentalAgreementNumber}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowEdit(true)}
            className="flex-shrink-0 text-[10px] font-bold text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg px-2 py-1 transition-colors"
          >
            {t.rentalReturn.edit}
          </button>
        </div>

        <div className="relative flex items-center gap-2 mt-3 flex-wrap">
          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${statusConfig.chip}`}>
            {statusConfig.label}
          </span>
          {countdown && (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/15 text-white">
              ⏱ {t.rentalReturn.returnIn(countdown)}
            </span>
          )}
          {session.returnLocation && (
            <span className="text-[10px] text-white/60 truncate max-w-full">📍 {session.returnLocation}</span>
          )}
        </div>
      </div>

      {/* Fuel level — visual gauge + the one number that matters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
        {/* Tank bar: filled = current fuel, marker = required return level */}
        {tankCapacity > 0 && (
          <div>
            <div className="relative h-7 rounded-xl bg-slate-100 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-xl transition-all duration-500"
                style={{
                  width: `${currentPct}%`,
                  background: needed > 0
                    ? 'linear-gradient(90deg,#FBBF24,#FA7109)'
                    : 'linear-gradient(90deg,#1EB68F,#005F4A)',
                }}
              />
              {/* Required-return marker */}
              {targetPct > 0 && targetPct <= 100 && (
                <div className="absolute inset-y-0 w-0.5 bg-slate-700" style={{ left: `${targetPct}%` }}>
                  <div className="absolute -top-0.5 -left-[3px] w-2 h-2 rounded-full bg-slate-700" />
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-between px-2.5 text-[10px] font-black">
                <span className={currentPct > 12 ? 'text-white' : 'text-slate-500'}>E</span>
                <span className={currentPct > 92 ? 'text-white' : 'text-slate-400'}>F</span>
              </div>
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>{t.rentalReturn.tankSizeLabel(tankCapacity)}</span>
              <span>▲ {t.rentalReturn.targetMarker}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="bg-slate-50 rounded-xl py-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.currentEstimated}</p>
            <p className="text-lg font-black text-slate-800">{formatGallons(session.currentFuelGallons, session.currentFuelSource as FuelDataSource)}</p>
          </div>
          <div className="bg-slate-50 rounded-xl py-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.target}</p>
            <p className="text-lg font-black text-slate-800">{formatGallons(session.requiredReturnFuelGallons, 'MANUAL_GALLONS')}</p>
          </div>
        </div>
        {session.currentFuelSource && (
          <p className="text-[10px] text-slate-400 text-center">{fuelSourceLabel(session.currentFuelSource as FuelDataSource)}</p>
        )}

        {needed > 0 ? (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl px-3 py-3 text-center">
            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">{t.rentalReturn.addFuelEyebrow}</p>
            <p className="text-2xl font-black text-amber-800 leading-tight">{needed} <span className="text-base">gal</span></p>
            <p className="text-[11px] text-amber-600">{t.rentalReturn.beforeReturning}</p>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-3 text-center">
            <p className="text-lg font-black text-emerald-800">✓ {t.rentalReturn.noFuelNeeded}</p>
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

      {session.refuelLogs.length > 0 && (() => {
        const totals = refuelTotals(session.refuelLogs);
        return (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">{t.rentalReturn.refuelLog}</p>
            <div className="space-y-2">
              {session.refuelLogs.map((r) => (
                <div key={r.id} className="flex justify-between text-xs text-slate-600">
                  <span>
                    {r.gallons} gal{r.stationName ? ` · ${r.stationName}` : ''}
                    <span className="text-slate-400 ml-1">· {new Date(r.timestamp).toLocaleDateString()}</span>
                  </span>
                  {r.totalPaid != null && <span className="font-bold">${r.totalPaid.toFixed(2)}</span>}
                </div>
              ))}
            </div>
            {/* Running total — a long rental can involve several refuels, and
                "what have I spent on fuel so far?" is otherwise unanswerable
                without adding the rows up by hand. */}
            <div className="flex justify-between items-center text-xs font-black text-slate-800 mt-2.5 pt-2.5 border-t border-slate-100">
              <span>{t.rentalReturn.refuelTotalLabel(totals.count, totals.totalGallons)}</span>
              {totals.totalPaid > 0 && <span>${totals.totalPaid.toFixed(2)}</span>}
            </div>
          </div>
        );
      })()}

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
          refuelLogs={session.refuelLogs}
          rentalFuelChargePerGallon={session.rentalFuelChargePerGallon}
        />
      )}
      {showEdit && (
        <EditRentalModal
          session={session}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
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

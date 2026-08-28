'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/contexts/LanguageContext';
import {
  gallonsNeeded, estimatedRentalCompanyCharge, estimatedFuelCost, estimatedSavings,
  returnReadyStatus, formatGallons, fuelSourceLabel, refuelTotals,
  shouldTrackFuelNeededCalculated, roundGallons, tripFillEstimate,
  resolveRentalLifecycle, RENTAL_LIFECYCLE_SECTION_ORDER,
} from '@/lib/rentalCalculations';
import type { RentalLifecycle } from '@/lib/rentalCalculations';
import { trackRentalGasNearReturnViewed, trackRentalReturnReadyViewed } from '@/lib/gtag';
import { trackClientEvent } from '@/lib/clientAnalytics';
import type { FuelDataSource } from '@/lib/rentalProvider';
import type { RentalSession } from '@/lib/rentalSessions';
import type { Fillup } from '@/lib/fillups';
import RefuelLogModal from './RefuelLogModal';
import CompleteRentalModal from './CompleteRentalModal';
import FindGasNearReturn from './FindGasNearReturn';
import EditRentalModal from './EditRentalModal';
import VehicleBodyIcon from './VehicleBodyIcon';
import RentalVehicleAvatar from './RentalVehicleAvatar';
import { inferBodyType } from '@/lib/vehicleBodyType';
import FuelLevelInput from './FuelLevelInput';
import { resolveRentalGaugeStyle, isGaugeStyle, type GaugeStyle } from '@/lib/gaugeStyles';

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
  const [fillups, setFillups] = useState<Fillup[]>([]);
  const [linkedVehicleGaugeStyle, setLinkedVehicleGaugeStyle] = useState<string | null>(null);
  const [userGlobalGaugeStyle, setUserGlobalGaugeStyle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUpdateFuel, setShowUpdateFuel] = useState(false);
  const [showRefuel, setShowRefuel] = useState(false);
  const [refuelDefaultType, setRefuelDefaultType] = useState<'trip' | 'final_return'>('trip');
  const [showComplete, setShowComplete] = useState(false);
  const [showFindGas, setShowFindGas] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showPickupFuel, setShowPickupFuel] = useState(false);
  const [pendingFuel, setPendingFuel] = useState<{ gallons: number; source: FuelDataSource } | null>(null);
  const [calcPricePerGal, setCalcPricePerGal] = useState('');
  const calculatedOnceRef = useRef(false);
  const nearReturnTrackedRef = useRef(false);
  const [editingFillupId, setEditingFillupId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ gallonsPumped: string; pricePerGallon: string; totalCost: string }>({ gallonsPumped: '', pricePerGallon: '', totalCost: '' });

  // Phase 6A — Trip Fill-Up calculator: "how much fuel do I want to add
  // right now," independent of the return-target Calculate Fill above.
  // Current/desired levels are each resolved via the same FuelLevelInput
  // gauge/percent/gallons convention used everywhere else in this dashboard.
  // Phase 6A.2 — single enum drives which ONE major workflow is expanded at
  // a time (mobile-first: opening one collapses the other automatically,
  // since they share this one piece of state rather than two independent
  // booleans that could both be true simultaneously).
  const [activeWorkflow, setActiveWorkflow] = useState<'none' | 'add_fuel' | 'prepare_return' | 'find_gas'>('none');
  const workflowAutoOpenedRef = useRef(false);
  const [showFuelHistory, setShowFuelHistory] = useState(false);
  const [showRentalDetails, setShowRentalDetails] = useState(false);
  const prepareReturnOpenedRef = useRef(false);
  // 2026-08-28 correction — there is deliberately NO independent editable
  // current-fuel state for this calculator. Current level always reads the
  // authoritative session.currentFuelGallons directly; a local-only calculator current
  // level could promise a gallons-to-add figure computed from a number
  // that createRentalFillup()'s atomic currentFuelGallons bump (in
  // lib/rentalFillups.ts) never actually used, producing a real tank state
  // the calculator never predicted. Desired level remains independently
  // editable — that's the one genuinely arbitrary, user-chosen input here.
  const [tripDesiredFuel, setTripDesiredFuel] = useState<{ gallons: number; source: FuelDataSource } | null>(null);
  const [tripPricePerGal, setTripPricePerGal] = useState('');
  const tripCalcOpenedRef = useRef(false);
  const tripCalcTrackedRef = useRef(false);
  // Set immediately before opening RefuelLogModal so the modal always shows
  // the suggestion from whichever calculator/action actually triggered it
  // (return-target Calculate Fill, the Trip Fill-Up calculator, or the bare
  // "I Just Refueled" button, which has no suggestion at all).
  const [refuelSuggestion, setRefuelSuggestion] = useState<{ gallons?: number; price?: number }>({});


  const load = useCallback(() => {
    fetch(`/api/rental-sessions/${sessionId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.session) { setSession(d.session); setFillups(d.fillups ?? []); setLinkedVehicleGaugeStyle(d.linkedVehicleGaugeStyle ?? null); setUserGlobalGaugeStyle(d.userGlobalGaugeStyle ?? null); } })
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);
  /** Persist a resolved fuel level as either the pickup baseline or the
   *  current level. Setting pickup also moves the return target when the
   *  policy is same-as-pickup — handled server-side in updateRentalSession. */
  const savePickupOrCurrent = useCallback((which: 'pickup' | 'current') => {
    if (!pendingFuel) return;
    const body = which === 'pickup'
      ? { pickupFuelGallons: pendingFuel.gallons, pickupFuelSource: pendingFuel.source,
          currentFuelGallons: pendingFuel.gallons, currentFuelSource: pendingFuel.source }
      : { currentFuelGallons: pendingFuel.gallons, currentFuelSource: pendingFuel.source };
    fetch(`/api/rental-sessions/${sessionId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(load).catch(() => {});
    setPendingFuel(null);
    setShowPickupFuel(false);
    setShowUpdateFuel(false);
  }, [pendingFuel, sessionId, load]);

  // Phase 4B — resolution precedence: session override, then the linked
  // Vehicle's style, then the user's global default, then the GasCap
  // default. Presentation only — never touches currentFuelGallons or any
  // other fuel value.
  const resolvedGaugeStyle = resolveRentalGaugeStyle(session?.fuelGaugeStyle, linkedVehicleGaugeStyle, userGlobalGaugeStyle);
  const explicitGaugeStyle: GaugeStyle | null = isGaugeStyle(session?.fuelGaugeStyle) ? session!.fuelGaugeStyle : null;

  const handleGaugeStyleChange = useCallback((newStyle: GaugeStyle | null) => {
    fetch(`/api/rental-sessions/${sessionId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fuelGaugeStyle: newStyle }),
    }).then((res) => {
      if (res.ok) {
        trackClientEvent('fuel_gauge_style_selected', { style: newStyle ?? 'inherit', context: 'rental' });
        load();
      }
    }).catch(() => {});
  }, [sessionId, load]);

  useEffect(() => {
    if (session) trackRentalReturnReadyViewed(returnReadyStatus(session.currentFuelGallons, session.requiredReturnFuelGallons));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.currentFuelGallons, session?.requiredReturnFuelGallons]);

  // Growth Sprint 1, P0C-2A — first-party rental_fuel_needed_calculated,
  // effect-based (not inline beside the render-time gallonsNeeded() call
  // below) so this never fires as a render side effect, never refires on
  // an unrelated rerender, and never records a "calculation" when the
  // inputs were merely coerced to 0 by the render's `?? 0` fallback. Fires
  // only once GasCap actually has a genuine, meaningful fuel-needed
  // calculation to report: a non-upcoming rental with both a real current
  // reading and a real return requirement on record.
  useEffect(() => {
    if (!shouldTrackFuelNeededCalculated(session)) return;
    trackClientEvent('rental_fuel_needed_calculated');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.currentFuelGallons, session?.requiredReturnFuelGallons, session?.pickupDateTime]);

  // Phase 6A.1 — rental_near_return_viewed, fired once when the dashboard
  // actually TRANSITIONS INTO the Near Return lifecycle state, not on
  // every rerender while it stays there. Computed independently here
  // (rather than reading the `lifecycle` const below, which doesn't exist
  // yet at this point in the component — it's derived after the loading
  // guard) so this hook can run unconditionally before that guard, per the
  // Rules of Hooks.
  useEffect(() => {
    if (!session) return;
    const lc = resolveRentalLifecycle({
      status: session.status, pickupDateTime: session.pickupDateTime, returnDateTime: session.returnDateTime,
    });
    if (lc === 'near_return' && !nearReturnTrackedRef.current) {
      nearReturnTrackedRef.current = true;
      trackClientEvent('rental_near_return_viewed');
    }
    // Phase 6A.2 — auto-open Prepare for Return the first time this
    // dashboard is viewed in Near Return, so the primary workflow is
    // already expanded rather than making the renter tap to reveal it.
    // Guarded so it only ever auto-opens ONCE — if the renter deliberately
    // closes it or opens Add Fuel instead, this must never re-force it
    // back open on a later rerender.
    if (lc === 'near_return' && !workflowAutoOpenedRef.current) {
      workflowAutoOpenedRef.current = true;
      setActiveWorkflow('prepare_return');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status, session?.pickupDateTime, session?.returnDateTime]);

  if (loading || !session) {
    return <div className="max-w-lg mx-auto px-4 py-10"><div className="h-40 bg-slate-100 rounded-2xl animate-pulse" /></div>;
  }

  const needed   = gallonsNeeded(session.requiredReturnFuelGallons ?? 0, session.currentFuelGallons ?? 0);
  const status   = returnReadyStatus(session.currentFuelGallons, session.requiredReturnFuelGallons);
  const rentalCharge = estimatedRentalCompanyCharge(needed, session.rentalFuelChargePerGallon);
  // Phase 6A.1 — "Prepare for Return" savings figure. Only ever shown when
  // BOTH a real rental-company rate and a real entered local price exist —
  // never invents a gas price, same rule as everywhere else in this file.
  const selfRefuelCostAtEnteredPrice = Number(calcPricePerGal) > 0 ? estimatedFuelCost(needed, Number(calcPricePerGal)) : 0;
  const estimatedSavingsAmount = rentalCharge != null && Number(calcPricePerGal) > 0
    ? estimatedSavings(rentalCharge, selfRefuelCostAtEnteredPrice)
    : null;
  const countdown = returnCountdown(session.returnDateTime);

  // `chip` is for the tinted hero (needs to read against a dark gradient);
  // plain white/tinted backgrounds elsewhere use the same palette family.
  const statusConfig = {
    needs_fuel:   { label: t.rentalReturn.statusNeedsFuel,   chip: 'bg-red-400/90 text-white' },
    nearly_ready: { label: t.rentalReturn.statusNearlyReady, chip: 'bg-amber-400 text-amber-950' },
    return_ready: { label: t.rentalReturn.statusReturnReady, chip: 'bg-white text-emerald-700' },
  }[status];

  // Phase 6A.1 — single source of truth for the four presentation
  // lifecycle states (upcoming/active/near_return/completed). `isUpcoming`
  // stays as its own derived boolean since every pre-existing gate below
  // already reads it by that name — deriving it FROM lifecycle (rather
  // than calling isUpcomingRental separately) guarantees they can never
  // disagree with each other.
  const lifecycle = resolveRentalLifecycle({
    status: session.status,
    pickupDateTime: session.pickupDateTime,
    returnDateTime: session.returnDateTime,
  });
  const isUpcoming = lifecycle === 'upcoming';
  const isNearReturn = lifecycle === 'near_return';
  const isCompleted = lifecycle === 'completed';
  const isCancelled = lifecycle === 'cancelled';

  // Phase 6A.1 — a completed OR cancelled session is historical/read-only:
  // no Update Current Fuel, no Trip Fill-Up, no Calculate Fill, no new
  // logging, no return-completion actions. This is a SEPARATE, simpler
  // render path rather than threading isCompleted/isCancelled through
  // every section below — this view shows fixed historical facts, not any
  // of the live/interactive calculators. Fuel History is the one section
  // reused as-is (read-only rows, no edit/delete controls) since that data
  // remains genuinely useful either way.
  //
  // 2026-08-28 correction — cancelled and completed are DISTINCT
  // lifecycle states (resolveRentalLifecycle never collapses them), and
  // this view must never say "Your Rental Is Complete" for one that was
  // cancelled — that would imply a successful return that never happened.
  // Only the heading text/color differ by state; every other section
  // (summary facts, Fuel History) is identical and equally valid for both.
  if (isCompleted || isCancelled) {
    const totalGallons = fillups.length > 0 ? roundGallons(fillups.reduce((s, f) => s + f.gallonsPumped, 0)) : null;
    const totalCost = fillups.some((f) => f.totalCost > 0) ? fillups.reduce((s, f) => s + f.totalCost, 0) : null;
    return (
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <Link href="/rental-return" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800">
          <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M10 6H2M5 2 1 6l4 4" />
          </svg>
          {t.rentalReturn.myRentals}
        </Link>

        <div className={`rounded-2xl shadow-sm p-4 text-white bg-gradient-to-br ${isCancelled ? 'from-red-800 via-red-700 to-red-600' : 'from-slate-700 via-slate-600 to-slate-500'}`}>
          <p className="text-[10px] font-black uppercase tracking-wide text-white/70">
            {isCancelled ? t.rentalReturn.rentalCancelledTitle : t.rentalReturn.rentalCompleteTitle}
          </p>
          <p className="text-base font-black leading-tight mt-0.5">{session.rentalCompany}</p>
          <p className="text-[11px] text-white/70">
            {[session.vehicleYear, session.vehicleMake, session.vehicleModel].filter(Boolean).join(' ') || t.rentalReturn.vehicleUnknown}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{t.rentalReturn.rentalSummaryTitle}</p>
          {session.pickupDateTime && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">{t.rentalReturn.completedPickupLabel}</span>
              <span className="font-bold text-slate-800">{new Date(session.pickupDateTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            </div>
          )}
          {session.returnDateTime && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">{t.rentalReturn.completedReturnLabel}</span>
              <span className="font-bold text-slate-800">{new Date(session.returnDateTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            </div>
          )}
          {session.returnLocation && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">{t.rentalReturn.returnLocationLabel}</span>
              <span className="font-bold text-slate-800 text-right truncate max-w-[60%]">📍 {session.returnLocation}</span>
            </div>
          )}
          {session.rentalAgreementNumber && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">{t.rentalReturn.agreementNumberShort}</span>
              <span className="font-mono font-bold text-slate-800">{session.rentalAgreementNumber}</span>
            </div>
          )}
          {session.rentalConfirmationNumber && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">{t.rentalReturn.confirmationNumberShort}</span>
              <span className="font-mono font-bold text-slate-800">{session.rentalConfirmationNumber}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">{t.rentalReturn.finalFuelLevelLabel}</span>
            <span className="font-bold text-slate-800">{formatGallons(session.currentFuelGallons, session.currentFuelSource as FuelDataSource)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">{t.rentalReturn.requiredReturnLevelLabel}</span>
            <span className="font-bold text-slate-800">{formatGallons(session.requiredReturnFuelGallons, 'MANUAL_GALLONS')}</span>
          </div>
        </div>

        {fillups.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">{t.rentalReturn.refuelLog}</p>
            <div className="space-y-2">
              {fillups.map((f) => (
                <div key={f.id} className="text-xs text-slate-600 border-b border-slate-50 last:border-0 pb-2 last:pb-0">
                  <div className="flex justify-between items-center">
                    <span>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-black mr-1 ${f.fillupType === 'final_return' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                        {f.fillupType === 'final_return' ? t.rentalReturn.finalReturnFillUp : t.rentalReturn.tripFillUp}
                      </span>
                      {f.gallonsPumped} gal{f.pricePerGallon > 0 ? ` · $${f.pricePerGallon.toFixed(2)}/gal` : ''}{f.stationName ? ` · ${f.stationName}` : ''}
                      <span className="text-slate-400 ml-1">· {new Date(f.filledAt ?? f.createdAt).toLocaleDateString()}</span>
                      {f.receiptThumb && <span className="ml-1" title={t.rentalReturn.receiptAttached} aria-label={t.rentalReturn.receiptAttached}>📷</span>}
                    </span>
                    {f.totalCost > 0 && <span className="font-bold">${f.totalCost.toFixed(2)}</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1">
              {totalGallons != null && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">{t.rentalReturn.fuelHistoryTotalGallons}</span>
                  <span className="font-black text-slate-800">{totalGallons} gal</span>
                </div>
              )}
              {totalCost != null && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">{t.rentalReturn.fuelHistoryTotalCost}</span>
                  <span className="font-black text-slate-800">${totalCost.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Is there a fuel figure at all? Pickup level is optional at setup, so a
  // rental of any age can have none.
  const hasFuelReading = session.currentFuelGallons != null || session.pickupFuelGallons != null;

  // Whether to render live fuel state: the gauge, the current/target figures,
  // and the needs-fuel / ✓ verdict.
  //
  // Two separate ways this went wrong. With no reading at all,
  // gallonsNeeded(null ?? 0, null ?? 0) is 0, so a green "✓ No fuel needed"
  // appeared over a gauge drawn at 0% — reading as an empty tank AND a clean
  // bill of health simultaneously, both invented.
  //
  // And an UPCOMING rental has no live state even when a pickup level was
  // recorded ahead of time (an agreement can promise "full at pickup"): until
  // the car is collected there is no current level to compare against, so a
  // "you're at or above the required return level" verdict describes a car
  // nobody is holding. Being told you're clear to return a vehicle you
  // haven't picked up is nonsense at best and a fuel charge at worst.
  const showLiveFuel = hasFuelReading && !isUpcoming;

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

  // Phase 6A.1 — section PLACEMENT per lifecycle, applied as CSS `order`
  // below (flex flex-col) rather than duplicating any section's JSX.
  const sectionOrder = RENTAL_LIFECYCLE_SECTION_ORDER[lifecycle as Exclude<RentalLifecycle, 'completed' | 'cancelled'>];

  return (
    <div className="max-w-lg mx-auto px-4 py-6 flex flex-col gap-4">
      <Link href="/rental-return" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800">
        <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M10 6H2M5 2 1 6l4 4" />
        </svg>
        {t.rentalReturn.myRentals}
      </Link>

      {/* Hero — vehicle identity, agreement number, countdown, status.
          Deliberately BLUE, not brand green: blue is the app's established
          "you are in Rental Car Mode" signal (the calculator's rental toggle
          uses blue-400/blue-500/blue-800), so matching it here keeps the two
          surfaces reading as one mode. Brand green stays reserved for
          primary actions, consistent with the rest of the app. */}
      <div className="relative overflow-hidden rounded-2xl shadow-sm bg-gradient-to-br from-blue-800 via-blue-600 to-blue-500 p-4 text-white">
        {/* Oversized watermark silhouette — decorative depth, not a control */}
        <VehicleBodyIcon
          bodyType={bodyType}
          className="absolute -right-4 -bottom-5 w-36 h-36 text-white/10 pointer-events-none"
        />

        <div className="relative flex items-start gap-3">
          <RentalVehicleAvatar make={session.vehicleMake} bodyType={bodyType} />

          <div className="flex-1 min-w-0">
            <p className="text-sm font-black leading-tight truncate">{session.rentalCompany}</p>
            <p className="text-[11px] text-white/70 truncate">
              {[session.vehicleYear, session.vehicleMake, session.vehicleModel].filter(Boolean).join(' ') || t.rentalReturn.vehicleUnknown}
            </p>
            {/* Phase 6A.2 — agreement/confirmation numbers moved to the
                collapsed Rental Details section below; they shouldn't
                visually compete with primary rental identity in the hero. */}
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
          {/* returnReadyStatus(null, null) is 'needs_fuel', so an active rental
              with nothing recorded claimed "Needs Fuel" — a guess dressed as a
              reading. Less dangerous than the ✓ below, but still a status with
              no data behind it. Say what's true instead. */}
          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${
            isUpcoming ? 'bg-white/90 text-slate-700'
            : !showLiveFuel ? 'bg-white/25 text-white'
            : statusConfig.chip
          }`}>
            {isUpcoming ? t.rentalReturn.statusUpcoming
             : !showLiveFuel ? t.rentalReturn.statusFuelNotSet
             : statusConfig.label}
          </span>
          {isUpcoming && session.pickupDateTime && (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/15 text-white">
              🗓 {t.rentalReturn.picksUp(new Date(session.pickupDateTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}
            </span>
          )}
          {!isUpcoming && countdown && (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/15 text-white">
              ⏱ {t.rentalReturn.returnIn(countdown)}
            </span>
          )}
          {session.returnLocation && (
            <span className="text-[10px] text-white/60 truncate max-w-full">📍 {session.returnLocation}</span>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          CURRENT FUEL — Phase 6A.2 redesign. The renter's canonical
          current-state surface: gauge, gallons, tank size, and the return
          requirement shown subordinately (not as a competing calculator).
          "Calculate Fill" as a generic user-facing concept no longer
          exists — its two jobs are the Fuel Actions workflows below.
          ══════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3" style={{ order: sectionOrder.fuelLevel }}>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{t.rentalReturn.currentFuelSectionTitle}</p>
        {/* Tank bar: filled = current fuel, marker = required return level */}
        {tankCapacity > 0 && showLiveFuel && (
          <div>
            <div className="relative h-7 rounded-xl bg-slate-100 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-xl transition-all duration-500"
                style={{
                  width: `${currentPct}%`,
                  // Amber stays for "needs fuel" — that's a warning, and it
                  // has to stay distinct from the mode color to be readable
                  // at a glance. The satisfied state uses the rental blue
                  // rather than brand green so the gauge belongs to this
                  // mode; the ✓ and status chip already carry "you're good".
                  background: needed > 0
                    ? 'linear-gradient(90deg,#FBBF24,#FA7109)'
                    : 'linear-gradient(90deg,#3b82f6,#1e40af)',
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

        {showLiveFuel && (
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
        )}
        {session.currentFuelSource && (
          <p className="text-[10px] text-slate-400 text-center">{fuelSourceLabel(session.currentFuelSource as FuelDataSource)}</p>
        )}

        {!showLiveFuel ? (
          /* No invented numbers: no gauge, no "✓", no gallons figure. Just
             what we actually know and the one action that resolves it. */
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-3 text-center">
            <p className="text-sm font-black text-blue-800">
              {isUpcoming && hasFuelReading
                ? t.rentalReturn.fuelPendingPickupTitle
                : t.rentalReturn.fuelUnknownTitle}
            </p>
            <p className="text-[11px] text-blue-600 leading-snug mt-0.5">
              {isUpcoming && hasFuelReading
                ? t.rentalReturn.fuelPendingPickupHint(formatGallons(session.pickupFuelGallons, session.pickupFuelSource as FuelDataSource))
                : isUpcoming
                  ? t.rentalReturn.fuelUnknownUpcomingHint
                  : t.rentalReturn.fuelUnknownHint}
            </p>
          </div>
        ) : needed > 0 ? (
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

        {/* Return requirement — subordinate to current fuel, not a
            competing calculator. Policy name reuses the same labels the
            setup/edit flow already uses. */}
        {showLiveFuel && session.requiredReturnFuelGallons != null && (
          <p className="text-[11px] text-slate-500 text-center">
            {t.rentalReturn.returnRequirementLabel}: {
              { same_as_pickup: t.rentalReturn.returnSameAsPickup, full: t.rentalReturn.returnFull, exact: t.rentalReturn.returnExact }[session.requiredReturnPolicyType ?? 'same_as_pickup']
            } · {formatGallons(session.requiredReturnFuelGallons, 'MANUAL_GALLONS')}
          </p>
        )}

        {showLiveFuel && (
        <button onClick={() => setShowUpdateFuel((v) => !v)} className="w-full text-xs font-bold text-blue-600 hover:text-blue-800">
          {t.rentalReturn.updateCurrentFuel}
        </button>
        )}
        {showUpdateFuel && (
          <div className="bg-slate-50 rounded-xl p-3 space-y-2">
            <FuelLevelInput
              tankCapacity={tankCapacity}
              onResolved={setPendingFuel}
              compact
              gaugeStyle={resolvedGaugeStyle}
              explicitGaugeStyle={explicitGaugeStyle}
              onChangeGaugeStyle={handleGaugeStyleChange}
            />
            <button
              type="button"
              disabled={!pendingFuel}
              onClick={() => savePickupOrCurrent('current')}
              className="w-full py-2 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40"
            >
              {t.rentalReturn.save}
            </button>
          </div>
        )}
      </div>

      {/* Pickup fuel — the number the whole return target is derived from
          under the default same-as-pickup policy. A rental entered ahead of
          time can't know it yet, so it has to be settable (and correctable)
          here rather than only at setup. */}
      {(session.pickupFuelGallons == null || showPickupFuel) && (
        <div className="bg-white rounded-2xl border-2 border-blue-200 shadow-sm p-4 space-y-2" style={{ order: sectionOrder.pickupFuel }}>
          <p className="text-xs font-black text-blue-800">⛽ {t.rentalReturn.setPickupFuelTitle}</p>
          <p className="text-[11px] text-slate-500 leading-snug">{t.rentalReturn.setPickupFuelHint}</p>
          <FuelLevelInput
            tankCapacity={tankCapacity}
            onResolved={setPendingFuel}
            compact
            gaugeStyle={resolvedGaugeStyle}
            explicitGaugeStyle={explicitGaugeStyle}
            onChangeGaugeStyle={handleGaugeStyleChange}
          />
          <div className="flex gap-2">
            {session.pickupFuelGallons != null && (
              <button type="button" onClick={() => { setShowPickupFuel(false); setPendingFuel(null); }}
                className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold">
                {t.rentalReturn.cancel}
              </button>
            )}
            <button
              type="button"
              disabled={!pendingFuel}
              onClick={() => savePickupOrCurrent('pickup')}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40"
            >
              {t.rentalReturn.save}
            </button>
          </div>
        </div>
      )}
      {session.pickupFuelGallons != null && !showPickupFuel && (
        <button type="button" onClick={() => setShowPickupFuel(true)}
          style={{ order: sectionOrder.pickupFuel }}
          className="w-full text-[11px] font-bold text-slate-400 hover:text-slate-600">
          {t.rentalReturn.correctPickupFuel(formatGallons(session.pickupFuelGallons, session.pickupFuelSource as FuelDataSource))}
        </button>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          FUEL ACTIONS — Phase 6A.2. Replaces the old generic "Calculate
          Fill" card (which forced a Trip vs Final Return choice inside one
          ambiguous surface) with two clearly named workflows. Only ONE of
          Add Fuel During Rental / Prepare for Return is ever expanded at a
          time (activeWorkflow is a single enum), so opening one collapses
          the other automatically — no risk of multiple simultaneous
          calculators cluttering the screen. Hidden entirely before pickup:
          a renter without the car yet has nothing to add fuel to or
          prepare a return for. ══════════════════════════════════════════ */}
      {!isUpcoming && (
        <div className="space-y-2" style={{ order: sectionOrder.calculateFill }}>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide px-1">{t.rentalReturn.fuelActionsTitle}</p>

          {/* Near Return: Prepare for Return reads as the primary, larger
              action; Add Fuel stays available but visually secondary. This
              is the SAME two buttons in both lifecycle states — only the
              relative styling swaps, never a duplicated implementation. */}
          <button
            type="button"
            onClick={() => setActiveWorkflow((w) => (w === 'prepare_return' ? 'none' : 'prepare_return'))}
            className={`w-full text-left rounded-2xl border p-4 transition-colors ${
              activeWorkflow === 'prepare_return' ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-800'
            } ${isNearReturn ? 'order-1' : 'order-2'}`}
          >
            <p className={`font-black ${isNearReturn ? 'text-base' : 'text-sm'}`}>🚗 {t.rentalReturn.prepareForReturnTitle}</p>
            <p className={`text-[11px] mt-0.5 ${activeWorkflow === 'prepare_return' ? 'text-blue-100' : 'text-slate-500'}`}>{t.rentalReturn.prepareReturnActionSubtitle}</p>
          </button>

          <button
            type="button"
            onClick={() => {
              const next = activeWorkflow === 'add_fuel' ? 'none' : 'add_fuel';
              setActiveWorkflow(next);
              if (next === 'add_fuel' && !tripCalcOpenedRef.current) {
                tripCalcOpenedRef.current = true;
                trackClientEvent('rental_trip_fill_calculator_opened');
              }
            }}
            className={`w-full text-left rounded-2xl border p-4 transition-colors ${
              activeWorkflow === 'add_fuel' ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'
            } ${isNearReturn ? 'order-2' : 'order-1'}`}
          >
            <p className={`font-black ${isNearReturn ? 'text-sm' : 'text-base'} text-amber-800`}>⛽ {t.rentalReturn.tripCalcTitle}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t.rentalReturn.addFuelActionSubtitle}</p>
          </button>

          <button
            type="button"
            onClick={() => setActiveWorkflow((w) => (w === 'find_gas' ? 'none' : 'find_gas'))}
            className={`w-full text-left rounded-2xl border p-3 order-3 ${activeWorkflow === 'find_gas' ? 'bg-blue-50 border-blue-300' : 'bg-white border-slate-200'}`}
          >
            <p className="text-sm font-bold text-slate-700">📍 {t.rentalReturn.findGasNearReturn}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t.rentalReturn.findGasActionSubtitle}</p>
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          ADD FUEL DURING RENTAL — Phase 6A (renamed/repositioned in
          6A.2). "How much fuel do I want to add right now," unrelated to
          the return target. Current level is ALWAYS the authoritative
          session.currentFuelGallons — never a local-only editable state,
          so this estimate can never disagree with what
          createRentalFillup()'s atomic bump (lib/rentalFillups.ts) later
          actually applies. Desired level is the one genuinely arbitrary,
          user-chosen input. ═══════════════════════════════════════════ */}
      {!isUpcoming && tankCapacity > 0 && activeWorkflow === 'add_fuel' && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4 space-y-2" style={{ order: sectionOrder.tripCalc }}>
          <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">⛽ {t.rentalReturn.tripCalcTitle}</p>
          {(() => {
            // Authoritative current level — never a local-only calculator
            // value. session.currentFuelGallons is exactly what
            // createRentalFillup() atomically adds the actual logged
            // gallons to server-side (lib/rentalFillups.ts), so the
            // calculator's estimate and the eventual real tank state can
            // never disagree about where "current" started from.
            const currentGallons = session.currentFuelGallons;
            const hasCurrentFuel = currentGallons != null;
            const tripDesiredGallonsRaw = tripDesiredFuel?.gallons ?? null;
            const tripPrice = Number(tripPricePerGal);
            const estimate = hasCurrentFuel && tripDesiredGallonsRaw != null
              ? tripFillEstimate(currentGallons, tripDesiredGallonsRaw, tankCapacity, tripPrice > 0 ? tripPrice : undefined)
              : null;
            const tripGallonsToAdd = estimate?.gallonsToAdd ?? null;
            const tripEstCost = estimate?.estimatedCost ?? null;
            const tripDesiredTooLow = hasCurrentFuel && tripDesiredGallonsRaw != null && estimate != null && estimate.gallonsToAdd <= 0;

            // No current reading at all — never calculate from a fabricated
            // 0. Same "unknown renders as unknown" rule as the rest of this
            // dashboard (see the showLiveFuel comment above). Points at the
            // EXISTING current-fuel update flow (showUpdateFuel, already
            // rendered in the Current Fuel card above) rather than a second
            // fuel-entry control.
            if (!hasCurrentFuel) {
              return (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-3 text-center space-y-2">
                  <p className="text-[11px] text-blue-700 leading-snug">{t.rentalReturn.tripCalcSetCurrentFuelFirst}</p>
                  <button type="button" onClick={() => setShowUpdateFuel(true)} className="text-xs font-bold text-blue-600 hover:text-blue-800">
                    {t.rentalReturn.updateCurrentFuel}
                  </button>
                </div>
              );
            }

            return (
              <>
                <p className="text-[11px] text-slate-500 leading-snug">{t.rentalReturn.tripCalcHint}</p>

                <div className="bg-slate-50 rounded-xl py-2 px-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.currentEstimated}</p>
                    <p className="text-base font-black text-slate-800">{formatGallons(currentGallons, session.currentFuelSource as FuelDataSource)}</p>
                  </div>
                  <button type="button" onClick={() => setShowUpdateFuel(true)} className="text-[11px] font-bold text-blue-600 hover:text-blue-800">
                    {t.rentalReturn.updateCurrentFuel}
                  </button>
                </div>

                <div>
                  <label className="field-label">{t.rentalReturn.tripCalcDesiredLevel}</label>
                  <FuelLevelInput
                    tankCapacity={tankCapacity}
                    onResolved={setTripDesiredFuel}
                    compact
                    gaugeStyle={resolvedGaugeStyle}
                  />
                </div>

                {tripDesiredTooLow ? (
                  <p className="text-[11px] text-amber-600 text-center">{t.rentalReturn.tripCalcDesiredTooLow}</p>
                ) : tripGallonsToAdd != null && tripGallonsToAdd > 0 && (
                  <>
                    <div className="bg-slate-50 rounded-xl py-2 flex flex-col justify-center">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide text-center">{t.rentalReturn.pricePerGallon}</label>
                      <input
                        type="number" inputMode="decimal" min="0" step="0.01" placeholder="3.19"
                        value={tripPricePerGal}
                        onChange={(e) => setTripPricePerGal(e.target.value)}
                        onBlur={() => {
                          if (!tripCalcTrackedRef.current && Number(tripPricePerGal) > 0) {
                            tripCalcTrackedRef.current = true;
                            trackClientEvent('rental_trip_fill_calculated');
                          }
                        }}
                        className="w-full text-center text-sm font-bold bg-transparent border-b border-slate-300 focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div className="bg-slate-50 rounded-xl py-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.tripCalcGallonsToAdd}</p>
                        <p className="text-lg font-black text-slate-800">{tripGallonsToAdd} gal</p>
                      </div>
                      <div className="bg-slate-50 rounded-xl py-2 flex items-center justify-center">
                        {tripEstCost != null && <p className="text-sm font-bold text-slate-700">{t.rentalReturn.tripCalcEstCost(tripEstCost)}</p>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        trackClientEvent('rental_trip_fill_log_started');
                        setRefuelDefaultType('trip');
                        setRefuelSuggestion({ gallons: tripGallonsToAdd, price: tripPrice > 0 ? tripPrice : undefined });
                        setShowRefuel(true);
                      }}
                      className="w-full py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm font-bold"
                    >
                      {t.rentalReturn.tripCalcLogCta}
                    </button>
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          PREPARE FOR RETURN — Phase 6A.2. Owns EVERY return-specific
          calculation: current/required fuel, gallons needed, station
          price entry, estimated self-refuel cost, rental-company charge,
          savings, Find Gas Near Return, and the Final Return Fill-Up log
          action. No Trip Fill-Up CTA lives in here — that job belongs
          entirely to Add Fuel During Rental above. Reuses the existing
          gallonsNeeded()/estimatedFuelCost()/estimatedSavings() primitives
          unchanged — this is a presentation consolidation, not new fuel
          math. ══════════════════════════════════════════════════════ */}
      {!isUpcoming && activeWorkflow === 'prepare_return' && (
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-4 space-y-2" style={{ order: sectionOrder.returnPrep }}>
          <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">🚗 {t.rentalReturn.prepareForReturnTitle}</p>
          <p className="text-[11px] text-slate-500 leading-snug">{t.rentalReturn.prepareForReturnHint}</p>

          {!hasFuelReading ? (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-3 text-center space-y-2">
              <p className="text-[11px] text-blue-700 leading-snug">{t.rentalReturn.calculateFillNeedsFuelPrompt}</p>
              <button type="button" onClick={() => setShowUpdateFuel(true)} className="text-xs font-bold text-blue-600 hover:text-blue-800">
                {t.rentalReturn.updateCurrentFuel}
              </button>
            </div>
          ) : needed <= 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-3 text-center">
              <p className="text-[11px] text-emerald-700 leading-snug">{t.rentalReturn.calculateFillAtOrAboveTarget}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-slate-50 rounded-xl py-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.addFuelEyebrow}</p>
                  <p className="text-lg font-black text-slate-800">{needed} gal</p>
                </div>
                <div className="bg-slate-50 rounded-xl py-2 flex flex-col justify-center">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.pricePerGallon}</label>
                  <input
                    type="number" inputMode="decimal" min="0" step="0.01" placeholder="3.19"
                    value={calcPricePerGal}
                    onChange={(e) => setCalcPricePerGal(e.target.value)}
                    onBlur={() => {
                      if (!calculatedOnceRef.current && Number(calcPricePerGal) > 0) {
                        calculatedOnceRef.current = true;
                        trackClientEvent('rental_fill_calculated');
                      }
                    }}
                    className="w-full text-center text-sm font-bold bg-transparent border-b border-slate-300 focus:outline-none"
                  />
                </div>
              </div>
              {Number(calcPricePerGal) > 0 && (
                <p className="text-center text-sm text-slate-600">
                  {t.rentalReturn.estCostHere(estimatedFuelCost(needed, Number(calcPricePerGal)))}
                </p>
              )}

              {session.rentalFuelChargePerGallon != null && rentalCharge != null && (
                <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">{t.rentalReturn.rentalCompanyEstimate}</span>
                    <span className="font-black text-red-600">~${rentalCharge.toFixed(2)}</span>
                  </div>
                  {estimatedSavingsAmount != null && (
                    <p className={`text-sm font-black text-center ${estimatedSavingsAmount >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {estimatedSavingsAmount >= 0 ? t.rentalReturn.saveVsRental(estimatedSavingsAmount) : t.rentalReturn.costMoreVsRental(Math.abs(estimatedSavingsAmount))}
                    </p>
                  )}
                </div>
              )}
              <p className="text-[10px] text-slate-400">{t.rentalReturn.priceDisclaimer}</p>

              <button
                onClick={() => {
                  if (isNearReturn) trackClientEvent('rental_prepare_return_cta_used');
                  setShowFindGas((v) => !v);
                  trackRentalGasNearReturnViewed();
                }}
                className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold"
              >
                📍 {t.rentalReturn.findGasNearReturn}
              </button>

              <button
                onClick={() => {
                  if (isNearReturn) trackClientEvent('rental_prepare_return_cta_used');
                  setRefuelDefaultType('final_return');
                  setRefuelSuggestion({ gallons: needed > 0 ? needed : undefined, price: Number(calcPricePerGal) > 0 ? Number(calcPricePerGal) : undefined });
                  setShowRefuel(true);
                }}
                className="w-full py-2.5 rounded-xl bg-blue-50 border border-blue-300 text-blue-700 text-sm font-bold"
              >
                {t.rentalReturn.logFinalFillUpCta}
              </button>
            </>
          )}
        </div>
      )}

      {/* Phase 6A.3 — Find Gas is its own top-level Fuel Actions job,
          separate from Prepare for Return: tapping it must not force the
          full return calculator (gallons needed / rental-company charge /
          savings) to expand first. Reuses the SAME FindGasNearReturn
          component/data-flow as the Prepare for Return CTA below — never a
          second gas-search implementation — just two different triggers
          for one shared render. `showFindGas` is the return-context
          reveal (stays nested under Prepare for Return, which never
          closes, so "back" is implicit); `activeWorkflow === 'find_gas'`
          is the lightweight standalone entry, with its own explicit back
          action since no other panel is showing around it. */}
      {(showFindGas || activeWorkflow === 'find_gas') && (
        <div style={{ order: sectionOrder.findGas }} className="space-y-2">
          {activeWorkflow === 'find_gas' && (
            <button type="button" onClick={() => setActiveWorkflow('none')} className="text-xs font-bold text-blue-600 hover:text-blue-800">
              ← {t.rentalReturn.back}
            </button>
          )}
          <FindGasNearReturn
            returnLat={session.returnLatitude} returnLng={session.returnLongitude}
            gallonsNeeded={needed} rentalRatePerGallon={session.rentalFuelChargePerGallon}
          />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          FUEL HISTORY — Phase 6A.2. Secondary on the dashboard: a
          collapsed one-line summary by default, expandable to the full
          canonical Fillup list (same edit/delete behavior as before —
          reused, not duplicated). Falls back to the legacy
          session.refuelLogs display for a pre-cutover session that only
          has old entries. ══════════════════════════════════════════ */}
      {fillups.length > 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4" style={{ order: sectionOrder.fuelLog }}>
          <button type="button" onClick={() => setShowFuelHistory((v) => !v)} className="w-full flex items-center justify-between">
            <div className="text-left">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{t.rentalReturn.refuelLog}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t.rentalReturn.fuelHistorySummaryLine(fillups.length, roundGallons(fillups.reduce((s, f) => s + f.gallonsPumped, 0)), fillups.reduce((s, f) => s + f.totalCost, 0))}
              </p>
            </div>
            <span className="text-[11px] font-bold text-blue-600 flex-shrink-0 ml-2">{showFuelHistory ? t.rentalReturn.hideHistoryLabel : t.rentalReturn.viewHistoryLabel}</span>
          </button>

          {showFuelHistory && (
          <>
          <div className="space-y-2 mt-3">
            {fillups.map((f) => (
              <div key={f.id} className="text-xs text-slate-600 border-b border-slate-50 last:border-0 pb-2 last:pb-0">
                {editingFillupId === f.id ? (
                  <div className="space-y-1.5 py-1">
                    <div className="grid grid-cols-3 gap-1.5">
                      <input type="number" step="0.01" value={editDraft.gallonsPumped}
                        onChange={(e) => setEditDraft((d) => ({ ...d, gallonsPumped: e.target.value }))}
                        className="input-field text-xs" placeholder="gal" />
                      <input type="number" step="0.01" value={editDraft.pricePerGallon}
                        onChange={(e) => setEditDraft((d) => ({ ...d, pricePerGallon: e.target.value }))}
                        className="input-field text-xs" placeholder="$/gal" />
                      <input type="number" step="0.01" value={editDraft.totalCost}
                        onChange={(e) => setEditDraft((d) => ({ ...d, totalCost: e.target.value }))}
                        className="input-field text-xs" placeholder="$ paid" />
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={async () => {
                          await fetch(`/api/rental-sessions/${sessionId}/fillups/${f.id}`, {
                            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              gallonsPumped: editDraft.gallonsPumped ? Number(editDraft.gallonsPumped) : undefined,
                              pricePerGallon: editDraft.pricePerGallon ? Number(editDraft.pricePerGallon) : undefined,
                              totalCost: editDraft.totalCost.trim() === '' ? null : Number(editDraft.totalCost),
                            }),
                          });
                          setEditingFillupId(null);
                          load();
                        }}
                        className="flex-1 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-bold"
                      >
                        {t.rentalReturn.save}
                      </button>
                      <button onClick={() => setEditingFillupId(null)} className="flex-1 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold">
                        {t.rentalReturn.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-center">
                    <span>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-black mr-1 ${f.fillupType === 'final_return' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                        {f.fillupType === 'final_return' ? t.rentalReturn.finalReturnFillUp : t.rentalReturn.tripFillUp}
                      </span>
                      {f.gallonsPumped} gal{f.pricePerGallon > 0 ? ` · $${f.pricePerGallon.toFixed(2)}/gal` : ''}{f.stationName ? ` · ${f.stationName}` : ''}
                      <span className="text-slate-400 ml-1">· {new Date(f.filledAt ?? f.createdAt).toLocaleDateString()}</span>
                      {f.receiptThumb && <span className="ml-1" title={t.rentalReturn.receiptAttached} aria-label={t.rentalReturn.receiptAttached}>📷</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      {f.totalCost > 0 && <span className="font-bold">${f.totalCost.toFixed(2)}</span>}
                      <button
                        onClick={() => { setEditingFillupId(f.id); setEditDraft({ gallonsPumped: String(f.gallonsPumped), pricePerGallon: String(f.pricePerGallon), totalCost: String(f.totalCost) }); }}
                        className="text-[10px] font-bold text-blue-600"
                      >
                        {t.rentalReturn.editFillUp}
                      </button>
                      <button
                        onClick={async () => { await fetch(`/api/rental-sessions/${sessionId}/fillups/${f.id}`, { method: 'DELETE' }); load(); }}
                        className="text-[10px] font-bold text-red-500"
                      >
                        {t.rentalReturn.deleteFillUp}
                      </button>
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500">{t.rentalReturn.fuelHistoryTotalGallons}</span>
              <span className="font-black text-slate-800">{roundGallons(fillups.reduce((s, f) => s + f.gallonsPumped, 0))} gal</span>
            </div>
            {fillups.some((f) => f.totalCost > 0) && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">{t.rentalReturn.fuelHistoryTotalCost}</span>
                <span className="font-black text-slate-800">${fillups.reduce((s, f) => s + f.totalCost, 0).toFixed(2)}</span>
              </div>
            )}
          </div>
          </>
          )}
        </div>
      ) : session.refuelLogs.length > 0 && (() => {
        const totals = refuelTotals(session.refuelLogs);
        return (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4" style={{ order: sectionOrder.fuelLog }}>
            <button type="button" onClick={() => setShowFuelHistory((v) => !v)} className="w-full flex items-center justify-between">
              <div className="text-left">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{t.rentalReturn.refuelLog}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{t.rentalReturn.fuelHistorySummaryLine(totals.count, totals.totalGallons, totals.totalPaid)}</p>
              </div>
              <span className="text-[11px] font-bold text-blue-600 flex-shrink-0 ml-2">{showFuelHistory ? t.rentalReturn.hideHistoryLabel : t.rentalReturn.viewHistoryLabel}</span>
            </button>
            {showFuelHistory && (
            <>
            <div className="space-y-2 mt-3">
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
            </>
            )}
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════════════
          RENTAL DETAILS — Phase 6A.2. Low-priority identity/logistics
          facts collapsed by default so the hero/card density stays low.
          Never hides critical return information — return date/time and
          return location are already visible in the hero above; this is
          purely supplementary. ══════════════════════════════════════ */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4" style={{ order: sectionOrder.actions }}>
        <button type="button" onClick={() => setShowRentalDetails((v) => !v)} className="w-full flex items-center justify-between">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{t.rentalReturn.rentalDetailsTitle}</p>
          <span className="text-slate-400">{showRentalDetails ? '▲' : '▼'}</span>
        </button>
        {showRentalDetails && (
          <div className="mt-3 space-y-1.5">
            {session.rentalAgreementNumber && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">{t.rentalReturn.agreementNumberShort}</span>
                <span className="font-mono font-bold text-slate-800">{session.rentalAgreementNumber}</span>
              </div>
            )}
            {session.rentalConfirmationNumber && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">{t.rentalReturn.confirmationNumberShort}</span>
                <span className="font-mono font-bold text-slate-800">{session.rentalConfirmationNumber}</span>
              </div>
            )}
            {session.pickupDateTime && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">{t.rentalReturn.completedPickupLabel}</span>
                <span className="font-bold text-slate-800">{new Date(session.pickupDateTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            )}
            {session.returnDateTime && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">{t.rentalReturn.completedReturnLabel}</span>
                <span className="font-bold text-slate-800">{new Date(session.returnDateTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            )}
            {session.returnLocation && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">{t.rentalReturn.returnLocationLabel}</span>
                <span className="font-bold text-slate-800 text-right truncate max-w-[60%]">📍 {session.returnLocation}</span>
              </div>
            )}
            {tankCapacity > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">{t.rentalReturn.tankSizeLabel(tankCapacity)}</span>
              </div>
            )}
            {session.rentalFuelChargePerGallon != null && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">{t.rentalReturn.pricePerGallon}</span>
                <span className="font-bold text-slate-800">${session.rentalFuelChargePerGallon.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Complete Rental remains the sole footer action (Phase 6A.2) — the
          bare "I Just Refueled" shortcut was removed as a redundant second
          entry point now that Add Fuel During Rental covers it. Hidden
          before pickup (Phase 6A.1): a rental that hasn't started can't be
          completed. */}
      {!isUpcoming && (
        <button onClick={() => setShowComplete(true)} className="w-full py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold" style={{ order: sectionOrder.actions + 1 }}>
          {t.rentalReturn.completeRental}
        </button>
      )}

      <p className="text-[10px] text-slate-400 text-center leading-relaxed px-2" style={{ order: 6 }}>{t.rentalReturn.disclaimer}</p>

      {showRefuel && (
        <RefuelLogModal
          onClose={() => setShowRefuel(false)}
          onSaved={() => { setShowRefuel(false); load(); }}
          sessionId={sessionId}
          suggestedGallons={refuelSuggestion.gallons}
          defaultFillupType={refuelDefaultType}
          suggestedPricePerGallon={refuelSuggestion.price}
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

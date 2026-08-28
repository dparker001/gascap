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

/** Absolute-ish, short "last updated" display — deliberately not a live
 *  "3 minutes ago" ticker (this is a last-known reading, never live
 *  telemetry, so a countdown-style relative clock would misrepresent it). */
function formatUpdatedAt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

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
  // Phase 6A.4 — accordion correction: the find-gas surface is no longer a top-level
  // workflow (it now renders visually INSIDE whichever accordion opened
  // it, via showFindGasTrip/showFindGasReturn below), so only the two real
  // workflows remain mutually exclusive here.
  const [activeWorkflow, setActiveWorkflow] = useState<'none' | 'add_fuel' | 'prepare_return'>('none');
  const workflowAutoOpenedRef = useRef(false);
  const [showFuelHistory, setShowFuelHistory] = useState(false);
  const [showRentalDetails, setShowRentalDetails] = useState(false);
  const prepareReturnOpenedRef = useRef(false);
  // Each accordion gets its OWN find-gas reveal, nested in its own content
  // (never a shared/top-level toggle) — both still render the SAME
  // FindGasNearReturn component, just from two different call sites.
  const [showFindGasTrip, setShowFindGasTrip] = useState(false);
  const [showFindGasReturn, setShowFindGasReturn] = useState(false);
  // Phase 6A.4 — results must not become the primary user-facing output
  // until the renter explicitly taps Calculate. The underlying estimate
  // (tripFillEstimate / gallonsNeeded+estimatedFuelCost) is still computed
  // live under the hood — these two flags gate PRESENTATION only, and
  // reset whenever an input changes so a stale result is never shown next
  // to numbers that no longer produced it.
  const [hasCalculatedTripFill, setHasCalculatedTripFill] = useState(false);
  const [hasCalculatedReturn, setHasCalculatedReturn] = useState(false);
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

  // ── Calculation-confirmation gating (2026-08-28 hardening) ───────────────
  // See lib/rentalCalculations.ts's fuel-state domain model (invariants
  // 10/11): session.currentFuelGallons is a LAST-KNOWN reading, never live
  // telemetry, so neither calculator below may feed it directly into a
  // Calculate action. A value only becomes usable once the renter has
  // explicitly confirmed it IN THIS SESSION, via a successful server
  // round-trip. Enforcement is this explicit state machine alone — no
  // separate helper function makes this decision (see the 2026-08-28
  // Correction 11 note in lib/rentalCalculations.ts for why one that used
  // to live there was removed).
  //
  // Deliberately ONE shared pair for both accordions (Add Fuel During
  // Rental and Prepare for Return) rather than two independent ones: they
  // both represent "the current fuel level, confirmed for calculation
  // purposes right now" for the SAME physical tank — letting them diverge
  // would let the dashboard show two different "confirmed current fuel"
  // numbers at once, which is exactly the kind of contradiction this
  // hardening pass exists to prevent.
  const [confirmedCurrentFuelGallons, setConfirmedCurrentFuelGallons] = useState<number | null>(null);
  const [confirmedCurrentFuelSource, setConfirmedCurrentFuelSource] = useState<FuelDataSource | null>(null);
  const [confirmedCurrentFuelUpdatedAt, setConfirmedCurrentFuelUpdatedAt] = useState<string | null>(null);
  const [confirmSaveState, setConfirmSaveState] = useState<'idle' | 'saving' | 'error' | 'conflict'>('idle');
  const [showConfirmFuelInput, setShowConfirmFuelInput] = useState(false);
  const [confirmPendingFuel, setConfirmPendingFuel] = useState<{ gallons: number; source: FuelDataSource } | null>(null);

  // Invalidate on session id change (a different rental's confirmation must
  // never leak into this one).
  useEffect(() => {
    setConfirmedCurrentFuelGallons(null);
    setConfirmedCurrentFuelSource(null);
    setConfirmedCurrentFuelUpdatedAt(null);
    setConfirmSaveState('idle');
    setShowConfirmFuelInput(false);
    setConfirmPendingFuel(null);
  }, [sessionId]);

  // 2026-08-28 correction (independent review): closing/reopening an
  // accordion does NOT change the physical fuel state, so it must NOT
  // invalidate confirmedCurrentFuelGallons — a renter who confirms fuel in
  // Add Fuel During Rental, closes it, then opens Prepare for Return (or
  // vice versa) must not be forced to re-confirm. An earlier draft cleared
  // confirmation here on every close; that over-invalidated and is
  // deliberately removed. The confirm UI's own open/close (showConfirmFuelInput)
  // is presentation-only and is reset independently wherever it's opened.

  // Invalidate whenever the server's persisted last-known fuel-STATE IDENTITY
  // — the full (currentFuelGallons, currentFuelSource, currentFuelUpdatedAt)
  // triple, not gallons alone — no longer matches what we confirmed.
  //
  // 2026-08-28 correction (independent review, Blocker 1): gallons-only
  // comparison misses a real case. A Fillup that tops off an already-full
  // tank leaves currentFuelGallons numerically unchanged (clamped to the
  // same tank capacity) while currentFuelSource becomes RECEIPT and
  // currentFuelUpdatedAt advances — a genuinely NEW physical observation
  // that a gallons-only check would have silently let ride on the old
  // confirmation. Comparing the whole triple catches same-gallons
  // re-observations, source changes, and timestamp-only server-side
  // corrections alike, with no invented fuel-consumption logic involved.
  //
  // (When the divergence IS the result of our own successful confirm write,
  // all three fields already equal what we just set locally, so this is a
  // no-op — see confirmCurrentFuel below, which sets all three together from
  // the server's response.)
  useEffect(() => {
    if (confirmedCurrentFuelGallons == null) return;
    const identityChanged =
      session?.currentFuelGallons !== confirmedCurrentFuelGallons ||
      (session?.currentFuelSource ?? null) !== confirmedCurrentFuelSource ||
      (session?.currentFuelUpdatedAt ?? null) !== confirmedCurrentFuelUpdatedAt;
    if (identityChanged) {
      setConfirmedCurrentFuelGallons(null);
      setConfirmedCurrentFuelSource(null);
      setConfirmedCurrentFuelUpdatedAt(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt]);

  // CALCULATED -> READY_TO_CALCULATE: a fresh confirmation invalidates any
  // previously-shown result, same rule already applied to desired-level/
  // price input changes above.
  useEffect(() => {
    setHasCalculatedTripFill(false);
    setHasCalculatedReturn(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedCurrentFuelGallons]);

  // RESULT invalidator — a changed required-return TARGET makes the
  // previously-shown Prepare for Return result stale (it was computed
  // against the old target), even though the underlying confirmed fuel
  // level hasn't changed at all. Deliberately does NOT touch
  // confirmedCurrentFuelGallons — the physical tank observation is still
  // valid, only the comparison target moved.
  useEffect(() => {
    setHasCalculatedReturn(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.requiredReturnFuelGallons]);

  /** Correction 2 — confirm-write correctness. PATCH, await, require
   *  response.ok, and use the SERVER-RETURNED session's fuel fields (never
   *  the locally-typed value) to set confirmed state. On failure, the
   *  pending typed value, the confirm UI, and the calculator's disabled
   *  state are all left exactly as they were — nothing is marked confirmed,
   *  nothing is silently discarded. */
  const load = useCallback(() => {
    fetch(`/api/rental-sessions/${sessionId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.session) { setSession(d.session); setFillups(d.fillups ?? []); setLinkedVehicleGaugeStyle(d.linkedVehicleGaugeStyle ?? null); setUserGlobalGaugeStyle(d.userGlobalGaugeStyle ?? null); } })
      .finally(() => setLoading(false));
  }, [sessionId]);

  // 2026-08-28 final pre-commit hardening (independent review) — React state
  // (confirmSaveState) is not a synchronous lock: two rapid taps can both
  // read 'idle' before either re-render applies 'saving', so relying on it
  // alone as the duplicate-submission guard leaves a real (if narrow)
  // window. The server's optimistic-concurrency snapshot already protects
  // data integrity either way, but a client-side double-submit would still
  // needlessly turn one of the two into an avoidable 409/reconfirm prompt.
  // confirmInFlightRef is a synchronous request lock; confirmSaveState stays
  // exactly what it was — visual/UI state only.
  const confirmInFlightRef = useRef(false);

  const confirmCurrentFuel = useCallback(async () => {
    if (!confirmPendingFuel) return;
    if (confirmInFlightRef.current) return;
    confirmInFlightRef.current = true;
    setConfirmSaveState('saving');
    try {
      const res = await fetch(`/api/rental-sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentFuelGallons: confirmPendingFuel.gallons,
          currentFuelSource: confirmPendingFuel.source,
          // TOCTOU guard (2026-08-28 independent review, Correction 9,
          // hardened 2026-08-28 Blocker 2): the server conditions its write
          // on the FULL last-known fuel-state identity we last read —
          // gallons, source, updatedAt, AND fuelTankCapacityGallons (the
          // value validation was actually performed against) — still
          // matching. Gallons alone isn't enough: a concurrent Fillup that
          // tops off an already-full tank leaves gallons unchanged while
          // source/updatedAt advance, and a concurrent tank-capacity edit
          // can invalidate a validation decision without touching gallons
          // at all. If ANY of these changed first, the server returns 409
          // rather than writing against now-stale validated state.
          expectedPriorCurrentFuelGallons: session?.currentFuelGallons ?? null,
          expectedPriorCurrentFuelSource: session?.currentFuelSource ?? null,
          expectedPriorCurrentFuelUpdatedAt: session?.currentFuelUpdatedAt ?? null,
          expectedPriorFuelTankCapacityGallons: session?.fuelTankCapacityGallons ?? null,
        }),
      });
      if (res.status === 409) {
        // Correction 9/10 — a real race lost. Reload the latest session,
        // leave fuel UNCONFIRMED (never set confirmedCurrentFuelGallons
        // here), and show customer-safe copy — never the raw status code.
        load();
        setConfirmPendingFuel(null);
        setConfirmSaveState('conflict');
        return;
      }
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
      const data = await res.json().catch(() => null);
      const updatedSession = data?.session as RentalSession | undefined;
      if (!updatedSession) throw new Error('No session in response');
      setSession(updatedSession);
      setConfirmedCurrentFuelGallons(updatedSession.currentFuelGallons);
      setConfirmedCurrentFuelSource(updatedSession.currentFuelSource as FuelDataSource | null);
      setConfirmedCurrentFuelUpdatedAt(updatedSession.currentFuelUpdatedAt);
      setConfirmSaveState('idle');
      setShowConfirmFuelInput(false);
      setConfirmPendingFuel(null);
    } catch {
      // Failure path: keep confirmPendingFuel, keep showConfirmFuelInput
      // open, do NOT mark confirmed, do NOT enable the calculator.
      setConfirmSaveState('error');
    } finally {
      // Every terminal path — success, 409 conflict, non-2xx, thrown/network
      // error — releases the lock. Nothing above this callback ever returns
      // early without going through here (the only earlier `return` is
      // before the lock is acquired).
      confirmInFlightRef.current = false;
    }
  }, [confirmPendingFuel, sessionId, session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt, session?.fuelTankCapacityGallons, load]);

  useEffect(() => { load(); }, [load]);
  /** Persist a resolved fuel level as either the pickup baseline or the
   *  current level. Setting pickup also moves the return target when the
   *  policy is same-as-pickup — handled server-side in updateRentalSession. */
  const [saveFuelError, setSaveFuelError] = useState<string | null>(null);

  /** Correction 2 — await the PATCH and require response.ok before treating
   *  the save as successful. The earlier fire-and-forget version closed the
   *  editor and cleared pendingFuel immediately, regardless of whether the
   *  write actually succeeded — a failed/slow request looked identical to a
   *  successful one. On failure, the editor stays open and the typed value
   *  is preserved so nothing the renter entered is silently lost. */
  const savePickupOrCurrent = useCallback(async (which: 'pickup' | 'current') => {
    if (!pendingFuel) return;
    const body = which === 'pickup'
      ? { pickupFuelGallons: pendingFuel.gallons, pickupFuelSource: pendingFuel.source,
          currentFuelGallons: pendingFuel.gallons, currentFuelSource: pendingFuel.source }
      : { currentFuelGallons: pendingFuel.gallons, currentFuelSource: pendingFuel.source };
    setSaveFuelError(null);
    try {
      const res = await fetch(`/api/rental-sessions/${sessionId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
      const data = await res.json().catch(() => null);
      if (!data?.session) throw new Error('No session in response');
      setSession(data.session);
      setPendingFuel(null);
      setShowPickupFuel(false);
      setShowUpdateFuel(false);
    } catch {
      setSaveFuelError(t.rentalReturn.fuelSaveFailed);
    }
  }, [pendingFuel, sessionId, t]);

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

  // 2026-08-28 correction — a "ready to return" verdict is only meaningful
  // once the renter has explicitly CONFIRMED the current fuel level for
  // this calculation, not merely because a last-known value happens to be
  // on file (invariant 10, lib/rentalCalculations.ts). Gated on
  // confirmedCurrentFuelGallons rather than session.currentFuelGallons.
  useEffect(() => {
    if (session && confirmedCurrentFuelGallons != null) {
      trackRentalReturnReadyViewed(returnReadyStatus(confirmedCurrentFuelGallons, session.requiredReturnFuelGallons));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedCurrentFuelGallons, session?.requiredReturnFuelGallons]);

  // Growth Sprint 1, P0C-2A — first-party rental_fuel_needed_calculated,
  // effect-based (not inline beside the render-time gallonsNeeded() call
  // below) so this never fires as a render side effect, never refires on
  // an unrelated rerender, and never records a "calculation" when the
  // inputs were merely coerced to 0 by the render's `?? 0` fallback. Fires
  // only once GasCap actually has a genuine, meaningful fuel-needed
  // calculation to report: a non-upcoming rental with both a real
  // CONFIRMED current reading (2026-08-28 correction — a last-known value
  // alone is not "genuine," see invariant 10) and a real return requirement
  // on record.
  useEffect(() => {
    if (!session || confirmedCurrentFuelGallons == null) return;
    if (!shouldTrackFuelNeededCalculated({ ...session, currentFuelGallons: confirmedCurrentFuelGallons })) return;
    trackClientEvent('rental_fuel_needed_calculated');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, confirmedCurrentFuelGallons, session?.requiredReturnFuelGallons, session?.pickupDateTime]);

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

  // 2026-08-28 correction: neither the Current Fuel card, the hero, Prepare
  // for Return, nor Add Fuel During Rental may derive a gallons-needed or
  // return-ready CONCLUSION from raw last-known session.currentFuelGallons
  // anymore — a `needed` const used to live here for exactly that and was
  // removed. Each accordion computes its own confirmed-* figures from
  // confirmedCurrentFuelGallons (see renderFuelConfirmPanel() and the
  // fuel-state domain model in lib/rentalCalculations.ts); the Current Fuel
  // card shows only last-known facts (gallons/target/timestamp/source), no
  // verdict.
  const countdown = returnCountdown(session.returnDateTime);

  // 2026-08-28 correction (independent review, Correction 4) — the HERO
  // must never claim a return-ready verdict from the raw LAST-KNOWN
  // session.currentFuelGallons. The hero owns lifecycle facts only
  // (Active/Near Return/Completed/Cancelled, countdown, scheduled pickup);
  // the one authoritative return-ready judgment lives entirely inside the
  // Prepare for Return accordion, gated on confirmedCurrentFuelGallons (see
  // renderFuelConfirmPanel() / prepareReturnContent below). `heroStatus` is
  // therefore null — not merely unstyled, but genuinely absent — until a
  // confirmation exists for THIS session; the hero shows neutral copy
  // instead of a red/amber/green claim.
  const heroStatus = confirmedCurrentFuelGallons != null
    ? returnReadyStatus(confirmedCurrentFuelGallons, session.requiredReturnFuelGallons)
    : null;

  // `chip` is for the tinted hero (needs to read against a dark gradient);
  // plain white/tinted backgrounds elsewhere use the same palette family.
  const HERO_STATUS_CONFIG = {
    needs_fuel:   { label: t.rentalReturn.statusNeedsFuel,   chip: 'bg-red-400/90 text-white' },
    nearly_ready: { label: t.rentalReturn.statusNearlyReady, chip: 'bg-amber-400 text-amber-950' },
    return_ready: { label: t.rentalReturn.statusReturnReady, chip: 'bg-white text-emerald-700' },
  } as const;

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

  // ── Shared last-known → confirmed fuel panel (2026-08-28) ────────────────
  // Rendered identically inside BOTH accordions below so "confirmed current
  // fuel" can never diverge into two different displayed numbers for the
  // same tank. Every FuelDataSource requires confirmation today — see the
  // Correction 11 note in lib/rentalCalculations.ts for why that decision
  // has no separate helper function of its own anymore.
  const hasCurrentFuelReading = session.currentFuelGallons != null;
  // This reduces to the one real question: has THIS
  // session already confirmed a value.
  const currentFuelNeedsConfirmation = hasCurrentFuelReading && confirmedCurrentFuelGallons == null;

  function renderFuelConfirmPanel() {
    if (!hasCurrentFuelReading) return null;
    const currentSource = session!.currentFuelSource as FuelDataSource | null;

    if (!currentFuelNeedsConfirmation && confirmedCurrentFuelGallons != null) {
      return (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-3 text-center space-y-1">
          <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">{t.rentalReturn.confirmedFuelForCalcLabel}</p>
          <p className="text-base font-black text-emerald-900">{formatGallons(confirmedCurrentFuelGallons, confirmedCurrentFuelSource)}</p>
          <p className="text-[10px] text-emerald-600">{t.rentalReturn.confirmedAtLabel}: {formatUpdatedAt(confirmedCurrentFuelUpdatedAt)}</p>
        </div>
      );
    }

    return (
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-3 text-center space-y-2">
        <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">{t.rentalReturn.lastReportedFuel}</p>
        <p className="text-base font-black text-blue-900">{formatGallons(session!.currentFuelGallons, currentSource)}</p>
        <p className="text-[10px] text-blue-600">{t.rentalReturn.lastUpdatedLabel}: {formatUpdatedAt(session!.currentFuelUpdatedAt)}</p>
        {currentSource && (
          <p className="text-[10px] text-blue-500">
            {currentSource === 'RECEIPT' ? t.rentalReturn.fuelCaptionFromReceipt : t.rentalReturn.fuelCaptionEstimated}
          </p>
        )}
        {!showConfirmFuelInput ? (
          <button
            type="button"
            onClick={() => { setShowConfirmFuelInput(true); setConfirmPendingFuel(null); setConfirmSaveState('idle'); }}
            className="text-xs font-bold text-blue-700 hover:text-blue-900 underline"
          >
            {t.rentalReturn.confirmUpdateCurrentFuelCta}
          </button>
        ) : (
          <div className="bg-white rounded-lg p-2 space-y-2 text-left">
            <FuelLevelInput
              tankCapacity={tankCapacity}
              onResolved={setConfirmPendingFuel}
              compact
              gaugeStyle={resolvedGaugeStyle}
            />
            <button
              type="button"
              disabled={!confirmPendingFuel || confirmSaveState === 'saving'}
              onClick={confirmCurrentFuel}
              className="w-full py-2 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40"
            >
              {confirmSaveState === 'saving' ? t.rentalReturn.savingLabel : t.rentalReturn.confirmUpdateCurrentFuelCta}
            </button>
            {confirmSaveState === 'error' && (
              <div className="text-center space-y-1">
                <p className="text-[11px] text-red-600">{t.rentalReturn.fuelSaveFailed}</p>
                <button type="button" onClick={confirmCurrentFuel} className="text-xs font-bold text-blue-700 underline">
                  {t.rentalReturn.retryLabel}
                </button>
              </div>
            )}
            {confirmSaveState === 'conflict' && (
              <p className="text-[11px] text-amber-600 text-center">{t.rentalReturn.fuelConfirmConflictMessage}</p>
            )}
          </div>
        )}
      </div>
    );
  }

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
              no data behind it. Say what's true instead.
              2026-08-28 correction — heroStatus is null (neutral, no color
              claim) until confirmedCurrentFuelGallons exists for THIS
              session; a last-known reading on file is never enough for this
              badge to render green/amber/red. */}
          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${
            isUpcoming ? 'bg-white/90 text-slate-700'
            : !showLiveFuel || heroStatus == null ? 'bg-white/25 text-white'
            : HERO_STATUS_CONFIG[heroStatus].chip
          }`}>
            {isUpcoming ? t.rentalReturn.statusUpcoming
             : !showLiveFuel ? t.rentalReturn.statusFuelNotSet
             : heroStatus == null ? t.rentalReturn.confirmFuelToCheckReturnStatus
             : HERO_STATUS_CONFIG[heroStatus].label}
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
                  // 2026-08-28 correction — this bar is a last-known-state
                  // fill level, not a return-readiness verdict, so its color
                  // must not vary with the raw (unconfirmed) gallons-needed
                  // gap. A single neutral rental-blue fill regardless of
                  // `needed` avoids the card implying a ready/not-ready
                  // conclusion it isn't authorized to make — that lives only
                  // in Prepare for Return, gated on confirmed fuel.
                  background: 'linear-gradient(90deg,#3b82f6,#1e40af)',
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
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.lastReportedFuel}</p>
            <p className="text-lg font-black text-slate-800">{formatGallons(session.currentFuelGallons, session.currentFuelSource as FuelDataSource)}</p>
          </div>
          <div className="bg-slate-50 rounded-xl py-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.target}</p>
            <p className="text-lg font-black text-slate-800">{formatGallons(session.requiredReturnFuelGallons, 'MANUAL_GALLONS')}</p>
          </div>
        </div>
        )}
        {showLiveFuel && session.currentFuelUpdatedAt && (
          <p className="text-[10px] text-slate-400 text-center">
            {t.rentalReturn.lastUpdatedLabel}: {formatUpdatedAt(session.currentFuelUpdatedAt)}
          </p>
        )}
        {session.currentFuelSource && (
          <p className="text-[10px] text-slate-400 text-center">
            {session.currentFuelSource === 'RECEIPT' ? t.rentalReturn.fuelCaptionFromReceipt : t.rentalReturn.fuelCaptionEstimated}
            {' · '}{fuelSourceLabel(session.currentFuelSource as FuelDataSource)}
          </p>
        )}

        {!showLiveFuel && (
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
        )}
        {/* 2026-08-28 correction — this card is a LAST-KNOWN-STATE /
            informational surface, not a calculator: it must never conclude
            "Add X gal" or "✓ No fuel needed" from raw, unconfirmed
            session.currentFuelGallons. That gallons-needed / return-ready
            conclusion belongs solely to Prepare for Return, gated on an
            explicit confirmedCurrentFuelGallons for this dashboard session.
            The gallons/target/timestamp/source/return-requirement figures
            above remain — those are last-known-state facts, not a verdict. */}

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
            {saveFuelError && (
              <p className="text-[11px] text-red-600 text-center">{saveFuelError}</p>
            )}
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
          {saveFuelError && (
            <p className="text-[11px] text-red-600 text-center">{saveFuelError}</p>
          )}
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
          FUEL ACTIONS — Phase 6A.4 TRUE ACCORDION. Each action card is
          followed IMMEDIATELY by its own expanded content in source order
          — no CSS `order` trick moves a workflow's content away from the
          card the renter tapped. Only ONE of Add Fuel During Rental /
          Prepare for Return is ever expanded at a time (activeWorkflow is
          a single enum). Find Gas is no longer a separate top-level card —
          it's an action INSIDE whichever workflow is open. Hidden
          entirely before pickup: a renter without the car yet has nothing
          to add fuel to or prepare a return for. ═══════════════════════ */}
      {!isUpcoming && (() => {
        const addFuelCard = (
          <button
            key="add-fuel-card"
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
            }`}
          >
            <p className={`font-black ${isNearReturn ? 'text-sm' : 'text-base'} text-amber-800`}>⛽ {t.rentalReturn.tripCalcTitle}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t.rentalReturn.addFuelActionSubtitle}</p>
          </button>
        );

        // ── ADD FUEL DURING RENTAL — expanded content, directly below the
        // card above. CURRENT STATE -> USER INPUT -> CALCULATE -> RESULTS
        // -> ACTION, same mental model as Prepare for Return below.
        const addFuelContent = !isUpcoming && tankCapacity > 0 && activeWorkflow === 'add_fuel' && (
          <div key="add-fuel-content" className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4 space-y-3">
            <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">⛽ {t.rentalReturn.tripCalcTitle}</p>
            {(() => {
              // Correction (2026-08-28): the calculator's "current" input is
              // now the CONFIRMED-for-this-calculation value, never the raw
              // last-known session.currentFuelGallons directly — see the
              // fuel-state domain model in lib/rentalCalculations.ts
              // (invariant 10). A stored value alone must never enable
              // Calculate; only a successful in-session confirmation does.
              const hasCurrentFuel = session.currentFuelGallons != null;
              const confirmedGallons = confirmedCurrentFuelGallons;
              const tripDesiredGallonsRaw = tripDesiredFuel?.gallons ?? null;
              const tripPrice = Number(tripPricePerGal);
              const estimate = confirmedGallons != null && tripDesiredGallonsRaw != null
                ? tripFillEstimate(confirmedGallons, tripDesiredGallonsRaw, tankCapacity, tripPrice > 0 ? tripPrice : undefined)
                : null;
              const tripGallonsToAdd = estimate?.gallonsToAdd ?? null;
              const tripEstCost = estimate?.estimatedCost ?? null;
              const tripDesiredEqualsConfirmed = confirmedGallons != null && tripDesiredGallonsRaw != null && tripDesiredGallonsRaw === confirmedGallons;
              const tripDesiredBelowConfirmed = confirmedGallons != null && tripDesiredGallonsRaw != null
                && estimate != null && estimate.gallonsToAdd <= 0 && !tripDesiredEqualsConfirmed;

              // No current reading at all — never calculate from a
              // fabricated 0. Same "unknown renders as unknown" rule as the
              // rest of this dashboard. Points at the EXISTING current-fuel
              // update flow (showUpdateFuel, already rendered in the
              // Current Fuel card above) rather than a second fuel-entry
              // control.
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
                  {/* LAST_KNOWN -> CONFIRMING -> CONFIRMED, shared with
                      Prepare for Return below so the two accordions can
                      never disagree about "confirmed current fuel." */}
                  {renderFuelConfirmPanel()}

                  {/* USER INPUT — desired level + gas price, both editable,
                      visually distinct (white/bordered fields) from the
                      shaded read-only/results boxes around them. Disabled
                      until a confirmation exists: there's nothing honest to
                      calculate FROM before then. */}
                  <div className={confirmedGallons == null ? 'opacity-40 pointer-events-none' : undefined}>
                    <label className="field-label">{t.rentalReturn.tripCalcDesiredLevel}</label>
                    <FuelLevelInput
                      tankCapacity={tankCapacity}
                      onResolved={(v) => { setTripDesiredFuel(v); setHasCalculatedTripFill(false); }}
                      compact
                      gaugeStyle={resolvedGaugeStyle}
                    />
                  </div>

                  <div className={confirmedGallons == null ? 'opacity-40 pointer-events-none' : undefined}>
                    <label className="field-label">{t.rentalReturn.gasPriceAtPumpLabel}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                      <input
                        type="number" inputMode="decimal" min="0" step="0.01" placeholder="3.19"
                        value={tripPricePerGal}
                        onChange={(e) => { setTripPricePerGal(e.target.value); setHasCalculatedTripFill(false); }}
                        className="input-field pl-6"
                      />
                    </div>
                  </div>

                  {confirmedGallons != null && tripDesiredGallonsRaw != null && (
                    <button
                      type="button"
                      onClick={() => {
                        setHasCalculatedTripFill(true);
                        if (!tripCalcTrackedRef.current) {
                          tripCalcTrackedRef.current = true;
                          trackClientEvent('rental_trip_fill_calculated');
                        }
                      }}
                      className="w-full py-2.5 rounded-xl bg-amber-600 text-white text-sm font-bold"
                    >
                      {t.rentalReturn.calculateFuelNeededCta}
                    </button>
                  )}

                  {/* RESULTS — only after the renter explicitly calculates.
                      Visually distinct from the input fields above: a
                      shaded box with bold figures, never styled like an
                      editable field. */}
                  {hasCalculatedTripFill && confirmedGallons != null && (
                    tripDesiredEqualsConfirmed ? (
                      <p className="text-[11px] text-amber-600 text-center">{t.rentalReturn.desiredEqualsConfirmedMsg}</p>
                    ) : tripDesiredBelowConfirmed ? (
                      <p className="text-[11px] text-amber-600 text-center">{t.rentalReturn.desiredBelowConfirmedMsg}</p>
                    ) : tripGallonsToAdd != null && tripGallonsToAdd > 0 && (
                      <>
                        <div className="grid grid-cols-2 gap-3 text-center bg-amber-50 rounded-xl p-3 border border-amber-100">
                          <div>
                            <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">{t.rentalReturn.fuelToAddLabel}</p>
                            <p className="text-lg font-black text-amber-900">{tripGallonsToAdd} gal</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">{t.rentalReturn.estimatedCostLabel}</p>
                            <p className="text-lg font-black text-amber-900">{tripEstCost != null ? `$${tripEstCost.toFixed(2)}` : '—'}</p>
                          </div>
                        </div>

                        {/* ACTION — Find Gas Nearby (shared component, this
                            accordion's own reveal) + Log This Fill-Up. */}
                        <button
                          type="button"
                          onClick={() => setShowFindGasTrip((v) => !v)}
                          className="w-full py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-bold"
                        >
                          📍 {t.rentalReturn.findGasNearbyLabel}
                        </button>
                        {showFindGasTrip && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.findGasNearbyLabel}</p>
                            <FindGasNearReturn
                              returnLat={session.returnLatitude} returnLng={session.returnLongitude}
                              gallonsNeeded={tripGallonsToAdd} rentalRatePerGallon={session.rentalFuelChargePerGallon}
                            />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            trackClientEvent('rental_trip_fill_log_started');
                            setRefuelDefaultType('trip');
                            setRefuelSuggestion({ gallons: tripGallonsToAdd, price: tripPrice > 0 ? tripPrice : undefined });
                            setShowRefuel(true);
                          }}
                          className="w-full py-2.5 rounded-xl bg-amber-600 text-white text-sm font-bold"
                        >
                          {t.rentalReturn.tripCalcLogCta}
                        </button>
                      </>
                    )
                  )}

                  {/* Logging without calculating first — same trip
                      RefuelLogModal flow, no suggested gallons/price. */}
                  <div className="pt-1 border-t border-slate-100 text-center">
                    <p className="text-[11px] text-slate-400">{t.rentalReturn.alreadyFilledUpTitle}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setRefuelDefaultType('trip');
                        setRefuelSuggestion({});
                        setShowRefuel(true);
                      }}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800"
                    >
                      {t.rentalReturn.logAFillUpCta}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        );

        const prepareReturnCard = (
          <button
            key="prepare-return-card"
            type="button"
            onClick={() => setActiveWorkflow((w) => (w === 'prepare_return' ? 'none' : 'prepare_return'))}
            className={`w-full text-left rounded-2xl border p-4 transition-colors ${
              activeWorkflow === 'prepare_return' ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-800'
            }`}
          >
            <p className={`font-black ${isNearReturn ? 'text-base' : 'text-sm'}`}>🚗 {t.rentalReturn.prepareForReturnTitle}</p>
            <p className={`text-[11px] mt-0.5 ${activeWorkflow === 'prepare_return' ? 'text-blue-100' : 'text-slate-500'}`}>{t.rentalReturn.prepareReturnActionSubtitle}</p>
          </button>
        );

        // ── PREPARE FOR RETURN — expanded content, directly below the
        // card above. Owns EVERY return-specific calculation. No Trip
        // Fill-Up CTA lives here — that job belongs entirely to Add Fuel
        // During Rental. Reuses gallonsNeeded()/estimatedFuelCost()/
        // estimatedRentalCompanyCharge()/estimatedSavings() exactly as
        // computed at the top of this component — presentation
        // consolidation only, not new fuel math.
        const prepareReturnContent = activeWorkflow === 'prepare_return' && (() => {
          // Correction (2026-08-28): return-ready judgment and the fuel-
          // needed figure both derive from the CONFIRMED-for-this-
          // calculation value, never the raw last-known
          // session.currentFuelGallons — see the fuel-state domain model
          // in lib/rentalCalculations.ts. Before a confirmation exists,
          // this section must not claim ready/not-ready/fuel-needed=X at
          // all.
          const confirmedGallons = confirmedCurrentFuelGallons;
          const confirmedNeeded = confirmedGallons != null
            ? gallonsNeeded(session.requiredReturnFuelGallons ?? 0, confirmedGallons)
            : null;
          const confirmedRentalCharge = confirmedNeeded != null
            ? estimatedRentalCompanyCharge(confirmedNeeded, session.rentalFuelChargePerGallon)
            : null;
          const confirmedSelfRefuelCost = confirmedNeeded != null && Number(calcPricePerGal) > 0
            ? estimatedFuelCost(confirmedNeeded, Number(calcPricePerGal))
            : 0;
          const confirmedSavings = confirmedRentalCharge != null && Number(calcPricePerGal) > 0
            ? estimatedSavings(confirmedRentalCharge, confirmedSelfRefuelCost)
            : null;

          return (
          <div key="prepare-return-content" className="bg-white rounded-2xl border border-blue-200 shadow-sm p-4 space-y-3">
            <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">🚗 {t.rentalReturn.prepareForReturnTitle}</p>
            <p className="text-[11px] text-slate-500 leading-snug">{t.rentalReturn.prepareForReturnHint}</p>

            {!hasFuelReading ? (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-3 text-center space-y-2">
                <p className="text-[11px] text-blue-700 leading-snug">{t.rentalReturn.calculateFillNeedsFuelPrompt}</p>
                <button type="button" onClick={() => setShowUpdateFuel(true)} className="text-xs font-bold text-blue-600 hover:text-blue-800">
                  {t.rentalReturn.updateCurrentFuel}
                </button>
              </div>
            ) : confirmedGallons == null ? (
              <>
                {renderFuelConfirmPanel()}
                <p className="text-[11px] text-blue-600 text-center leading-snug">{t.rentalReturn.confirmFuelToCheckReturnStatus}</p>
              </>
            ) : confirmedNeeded != null && confirmedNeeded <= 0 ? (
              <>
                {renderFuelConfirmPanel()}
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-3 text-center">
                  <p className="text-[11px] text-emerald-700 leading-snug">{t.rentalReturn.calculateFillAtOrAboveTarget}</p>
                </div>
              </>
            ) : (
              <>
                {/* Guaranteed non-null in this branch (the `confirmedNeeded
                    != null` checks above already excluded null); named
                    separately just so TS can narrow it once instead of at
                    every call site below. */}
                {(() => { const neededSafe = confirmedNeeded as number; return (
                <>
                {/* CURRENT STATE — confirmed-for-calculation, never raw */}
                {renderFuelConfirmPanel()}
                <div className="grid grid-cols-2 gap-3 text-center bg-slate-50 rounded-xl p-3">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.currentLabel}</p>
                    <p className="text-base font-black text-slate-800">{formatGallons(confirmedGallons, session.currentFuelSource as FuelDataSource)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.requiredLabel}</p>
                    <p className="text-base font-black text-slate-800">
                      {formatGallons(session.requiredReturnFuelGallons, 'MANUAL_GALLONS')}
                      {' · '}
                      {{ same_as_pickup: t.rentalReturn.returnSameAsPickup, full: t.rentalReturn.returnFull, exact: t.rentalReturn.returnExact }[session.requiredReturnPolicyType ?? 'same_as_pickup']}
                    </p>
                  </div>
                </div>

                {/* USER INPUT — gas price at pump */}
                <div>
                  <label className="field-label">{t.rentalReturn.gasPriceAtPumpLabel}</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                    <input
                      type="number" inputMode="decimal" min="0" step="0.01" placeholder="3.19"
                      value={calcPricePerGal}
                      onChange={(e) => { setCalcPricePerGal(e.target.value); setHasCalculatedReturn(false); }}
                      className="input-field pl-6"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setHasCalculatedReturn(true);
                    if (!calculatedOnceRef.current) {
                      calculatedOnceRef.current = true;
                      trackClientEvent('rental_fill_calculated');
                    }
                  }}
                  className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold"
                >
                  {t.rentalReturn.calculateReturnCostCta}
                </button>

                {/* RESULTS — only after the renter explicitly calculates,
                    AND only with a real confirmation behind confirmedNeeded
                    (guaranteed by this branch). */}
                {hasCalculatedReturn && (
                  <>
                    <div className="bg-blue-50 rounded-xl p-3 border border-blue-100 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-blue-700 font-bold">{t.rentalReturn.fuelNeededLabel}</span>
                        <span className="font-black text-blue-900">{neededSafe} gal</span>
                      </div>
                      {Number(calcPricePerGal) > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-blue-700 font-bold">{t.rentalReturn.estimatedGasStationCostLabel}</span>
                          <span className="font-black text-blue-900">${estimatedFuelCost(neededSafe, Number(calcPricePerGal)).toFixed(2)}</span>
                        </div>
                      )}
                      {session.rentalFuelChargePerGallon != null && confirmedRentalCharge != null && (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-blue-700 font-bold">{t.rentalReturn.rentalCompanyRefuelingRateLabel(session.rentalCompany || '')}</span>
                            <span className="font-black text-blue-900">${session.rentalFuelChargePerGallon.toFixed(2)} / gal</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-blue-700 font-bold">{t.rentalReturn.estimatedRentalCompanyChargeLabel}</span>
                            <span className="font-black text-red-600">~${confirmedRentalCharge.toFixed(2)}</span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* SAVINGS — emphasized, only when both sides are valid. */}
                    {confirmedSavings != null && (
                      confirmedSavings >= 0 ? (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                          <p className="text-lg font-black text-emerald-700">{t.rentalReturn.saveAboutTitle(confirmedSavings)}</p>
                          <p className="text-[11px] text-emerald-600">{t.rentalReturn.byRefuelingBeforeReturning}</p>
                        </div>
                      ) : (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                          <p className="text-[11px] text-amber-700 font-bold">{t.rentalReturn.estimatedDifferenceLabel}</p>
                          <p className="text-sm font-black text-amber-800">{t.rentalReturn.moreThanRentalChargeLabel(Math.abs(confirmedSavings))}</p>
                        </div>
                      )
                    )}
                    <p className="text-[10px] text-slate-400">{t.rentalReturn.priceDisclaimer}</p>

                    {/* ACTION */}
                    <button
                      onClick={() => {
                        if (isNearReturn) trackClientEvent('rental_prepare_return_cta_used');
                        setShowFindGasReturn((v) => !v);
                        trackRentalGasNearReturnViewed();
                      }}
                      className="w-full py-2.5 rounded-xl bg-white border border-blue-300 text-blue-700 text-sm font-bold"
                    >
                      📍 {t.rentalReturn.findGasNearReturn}
                    </button>
                    {showFindGasReturn && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.rentalReturn.findGasNearReturn}</p>
                        <FindGasNearReturn
                          returnLat={session.returnLatitude} returnLng={session.returnLongitude}
                          gallonsNeeded={neededSafe} rentalRatePerGallon={session.rentalFuelChargePerGallon}
                        />
                      </div>
                    )}

                    <button
                      onClick={() => {
                        if (isNearReturn) trackClientEvent('rental_prepare_return_cta_used');
                        setRefuelDefaultType('final_return');
                        setRefuelSuggestion({ gallons: neededSafe > 0 ? neededSafe : undefined, price: Number(calcPricePerGal) > 0 ? Number(calcPricePerGal) : undefined });
                        setShowRefuel(true);
                      }}
                      className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold"
                    >
                      {t.rentalReturn.logFinalFillUpCta}
                    </button>
                  </>
                )}
                </>
                ); })()}
              </>
            )}
          </div>
          );
        })();

        // Near Return: Prepare for Return reads first / primary; Add Fuel
        // stays available underneath, secondary. Active: Add Fuel reads
        // first (the more natural everyday workflow); Prepare for Return
        // remains available but secondary until Near Return. Content
        // always sits directly below its OWN card — this ordering swaps
        // which card+content PAIR comes first, never separates a card
        // from its content.
        return (
          <div
            className="space-y-2"
            // Active wants Fuel Actions BEFORE Fuel History (tripCalc's
            // order value already sits between fuelLevel and fuelLog for
            // 'active' — see RENTAL_LIFECYCLE_SECTION_ORDER, unchanged);
            // near_return wants it promoted above Current Fuel entirely
            // (calculateFill's order value already sits before fuelLevel
            // for 'near_return'). Neither existing single field covers
            // both cases, so this picks per-lifecycle from the SAME
            // unmodified lib constants rather than editing them.
            style={{ order: isNearReturn ? sectionOrder.calculateFill : sectionOrder.tripCalc }}
          >
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide px-1">{t.rentalReturn.fuelActionsTitle}</p>
            {isNearReturn ? (
              <>
                {prepareReturnCard}
                {prepareReturnContent}
                {addFuelCard}
                {addFuelContent}
              </>
            ) : (
              <>
                {addFuelCard}
                {addFuelContent}
                {prepareReturnCard}
                {prepareReturnContent}
              </>
            )}
          </div>
        );
      })()}

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
                <span className="text-slate-500">{t.rentalReturn.rentalCompanyRefuelingRateLabel(session.rentalCompany || '')}</span>
                <span className="font-bold text-slate-800">${session.rentalFuelChargePerGallon.toFixed(2)} / gal</span>
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

/**
 * GasCap™ Rental Return Assistant — persistence layer.
 * Thin wrapper over Prisma; API routes stay thin and never touch prisma directly.
 */
import { prisma } from './prisma';
import type { RefuelLogEntry, FuelDataSource } from './rentalProvider';
import { gallonsNeeded, resolveRequiredReturnFuel, returnReadyStatus, reconcileForTankCapacityChange, isFractionalFuelSource, type ReturnPolicyType, type ReturnReadyStatus } from './rentalCalculations';
import { recordAnalyticsEvent } from './analyticsEvents';
import {
  isValidIanaZone, isTimeZoneSource, isTimeDisambiguation, resolveEventUtc, storedOccurrence,
  type TimeZoneSource, type TimeDisambiguation, type ScheduleErrorCode,
} from './rentalTimezone';

export interface RentalSession {
  id:                          string;
  userId:                      string;
  vehicleId:                   string | null;
  provider:                    string;
  status:                      'active' | 'completed' | 'cancelled';
  rentalCompany:               string;
  rentalAgreementNumber:       string | null;
  rentalConfirmationNumber:    string | null;
  vehicleYear:                 string | null;
  vehicleMake:                 string | null;
  vehicleModel:                string | null;
  vehicleTrim:                 string | null;
  fuelTankCapacityGallons:     number | null;
  pickupFuelGallons:           number | null;
  pickupFuelSource:            FuelDataSource | null;
  requiredReturnFuelGallons:   number | null;
  requiredReturnPolicyType:    ReturnPolicyType | null;
  currentFuelGallons:          number | null;
  currentFuelSource:           FuelDataSource | null;
  currentFuelUpdatedAt:        string | null;
  rentalFuelChargePerGallon:   number | null;
  pickupDateTime:              string | null;
  returnDateTime:              string | null;
  timeZone:                    string | null;
  pickupDateTimeUtc:           string | null;
  returnDateTimeUtc:           string | null;
  // Event-timezone model (2026-10-02): each event's own IANA zone + source.
  pickupTimeZone:              string | null;
  returnTimeZone:              string | null;
  pickupTimeZoneSource:        string | null;
  returnTimeZoneSource:        string | null;
  pickupLatitude:              number | null;
  pickupLongitude:             number | null;
  pickupLocation:              string | null;
  returnLocation:              string | null;
  returnLatitude:              number | null;
  returnLongitude:             number | null;
  pickupVehiclePhotoThumb:     string | null;
  pickupGaugePhotoThumb:       string | null;
  pickupAgreementPhotoThumb:   string | null;
  returnGaugePhotoThumb:       string | null;
  returnReceiptPhotoThumb:     string | null;
  refuelLogs:                  RefuelLogEntry[];
  fuelFeeCharged:              boolean | null;
  fuelFeeAmount:                number | null;
  fuelFeeGallonsClaimed:        number | null;
  fuelFeeRentalReportedLevel:   number | null;
  disputeNotes:                 string | null;
  feedbackRating:               number | null;
  feedbackText:                 string | null;
  notes:                        string | null;
  reminderSentAt:               string | null;
  pickupReminder24SentAt:       string | null;
  pickupReminder2SentAt:        string | null;
  returnReminder2SentAt:        string | null;
  completedAt:                  string | null;
  fuelGaugeStyle:                string | null;
  createdAt:                    string;
  updatedAt:                    string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRentalSession(row: any): RentalSession {
  return {
    ...row,
    refuelLogs: Array.isArray(row.refuelLogs) ? row.refuelLogs as RefuelLogEntry[] : [],
  };
}

// ── Event scheduling (2026-10-02 event-timezone model) ───────────────────────

/** Fuel-state invariants (Part A, 2026-10-02) — all 422, nothing written:
 *  a gauge/percent reading needs a tank capacity to mean any gallons; a tank
 *  may not be cleared while such a reading would be silently lost; and a new
 *  capacity may not contradict an absolute reading or `exact` target (the
 *  reading is never clamped to fit). */
export type RentalFuelErrorCode = 'tank_capacity_required' | 'tank_clear_would_discard_reading' | 'fuel_reading_exceeds_tank_capacity';

/** Thrown by create/update for a bad schedule or fuel state; routes map it
 *  to 400/422 (the existing routes already map this class, unchanged). */
export class RentalScheduleError extends Error {
  constructor(public code: ScheduleErrorCode | RentalFuelErrorCode, public field: string) {
    super(`${field}: ${code}`);
    this.name = 'RentalScheduleError';
  }
  get status(): number {
    return this.code === 'nonexistent_local_time' || this.code === 'ambiguous_local_time'
      || this.code === 'tank_capacity_required' || this.code === 'tank_clear_would_discard_reading'
      || this.code === 'fuel_reading_exceeds_tank_capacity' ? 422 : 400;
  }
}

/** Throws when a gauge/percent reading arrives without a usable tank capacity. */
function assertReadingHasTank(source: unknown, capacity: number | null | undefined, field: string): void {
  if (isFractionalFuelSource(source as string | null) && !(typeof capacity === 'number' && capacity > 0)) {
    throw new RentalScheduleError('tank_capacity_required', field);
  }
}

export interface ResolvedEvent {
  local:  string | null;
  zone:   string | null;
  source: TimeZoneSource | null;
  utc:    string | null;
}

const blankToNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * CREATE: one event's (local, zone, source, utc). Zone precedence: a valid
 * submitted EVENT zone (an invalid one is rejected, never ignored); else the
 * legacy device `timeZone` from an older client, recorded as source
 * 'device'; else null (no UTC can be derived — same as a legacy row with no
 * zone). The pickup zone is never borrowed for return or vice versa.
 */
export function resolveCreateEvent(field: 'pickup' | 'return', opts: {
  local: unknown; eventZone: unknown; eventSource: unknown; legacyZone: unknown; choice: unknown;
}): ResolvedEvent {
  const local = blankToNull(opts.local);
  let zone: string | null = null;
  let source: TimeZoneSource | null = null;
  if (opts.eventZone !== undefined && opts.eventZone !== null && opts.eventZone !== '') {
    if (!isValidIanaZone(opts.eventZone)) throw new RentalScheduleError('invalid_time_zone', `${field}TimeZone`);
    zone = opts.eventZone;
    source = isTimeZoneSource(opts.eventSource) ? opts.eventSource : 'device';
  } else if (isValidIanaZone(opts.legacyZone)) {
    zone = opts.legacyZone;
    source = 'device';
  }
  if (!local) return { local: null, zone, source, utc: null };
  if (!zone) {
    // No zone to interpret it in — keep the wall clock, no instant (legacy parity).
    return { local, zone, source, utc: null };
  }
  const r = resolveEventUtc(local, zone, isTimeDisambiguation(opts.choice) ? opts.choice : null);
  if (!r.ok) throw new RentalScheduleError(r.code, `${field}DateTime`);
  return { local, zone, source, utc: r.utcIso };
}

export interface UpdatedEvent extends ResolvedEvent {
  /** True when the instant may have changed — reset this event's reminder stamps. */
  scheduleChanged: boolean;
  zoneWritten:     boolean;
}

/**
 * PATCH: one event. Effective zone = submitted valid event zone, else the
 * STORED event zone, else the STORED legacy `timeZone` — never the editing
 * device's zone (a body `timeZone` is ignored by the caller). The instant is
 * recomputed only when this event's wall clock, effective zone, or explicit
 * ambiguous-occurrence choice actually changes; an unrelated edit never
 * re-derives (so a stored LATER occurrence is never flipped to earlier).
 */
export function resolveUpdateEvent(field: 'pickup' | 'return', stored: {
  local: string | null; eventZone: string | null; eventSource: string | null; legacyZone: string | null; utc: string | null;
}, patch: { local: unknown; eventZone: unknown; eventSource: unknown; choice: unknown }): UpdatedEvent {
  const storedZone = stored.eventZone ?? stored.legacyZone;
  const storedSource = (stored.eventSource as TimeZoneSource | null) ?? (stored.legacyZone ? 'device' : null);

  let zone = storedZone;
  let source = storedSource;
  let zoneWritten = false;
  if (patch.eventZone !== undefined && patch.eventZone !== null && patch.eventZone !== '') {
    if (!isValidIanaZone(patch.eventZone)) throw new RentalScheduleError('invalid_time_zone', `${field}TimeZone`);
    zone = patch.eventZone;
    source = isTimeZoneSource(patch.eventSource) ? patch.eventSource : 'user';
    zoneWritten = zone !== stored.eventZone || source !== stored.eventSource;
  }
  const local = patch.local !== undefined ? blankToNull(patch.local) : stored.local;
  const choice = isTimeDisambiguation(patch.choice) ? patch.choice : null;

  const localChanged = local !== stored.local;
  const zoneChanged  = zone !== storedZone;
  const occurrenceChanged = !localChanged && !zoneChanged && choice !== null
    && choice !== storedOccurrence(stored.local, storedZone, stored.utc);

  if (!localChanged && !zoneChanged && !occurrenceChanged) {
    return { local, zone, source, utc: stored.utc, scheduleChanged: false, zoneWritten };
  }
  if (!local || !zone) {
    return { local, zone, source, utc: null, scheduleChanged: true, zoneWritten };
  }
  const r = resolveEventUtc(local, zone, choice);
  if (!r.ok) throw new RentalScheduleError(r.code, `${field}DateTime`);
  return { local, zone, source, utc: r.utcIso, scheduleChanged: true, zoneWritten };
}

export interface CreateRentalSessionInput {
  rentalCompany:             string;
  rentalAgreementNumber?:    string;
  rentalConfirmationNumber?: string;
  vehicleId?:                string;
  vehicleYear?:              string;
  vehicleMake?:              string;
  vehicleModel?:             string;
  vehicleTrim?:              string;
  fuelTankCapacityGallons?:  number;
  pickupFuelGallons?:        number;
  pickupFuelSource?:         FuelDataSource;
  requiredReturnPolicyType?: ReturnPolicyType;
  requiredReturnFuelGallons?: number; // only used when policy is 'exact'
  rentalFuelChargePerGallon?: number;
  pickupDateTime?:           string;
  returnDateTime?:           string;
  /** LEGACY: the creating device's IANA zone. Kept for backward compatibility
   *  only; used as an event zone (source 'device') when an older client sends
   *  no event zone. */
  timeZone?:                 string;
  pickupTimeZone?:           string;
  pickupTimeZoneSource?:     TimeZoneSource;
  returnTimeZone?:           string;
  returnTimeZoneSource?:     TimeZoneSource;
  /** Transient: required only when a wall time is ambiguous (DST fall-back). */
  pickupTimeDisambiguation?: TimeDisambiguation;
  returnTimeDisambiguation?: TimeDisambiguation;
  pickupLatitude?:           number;
  pickupLongitude?:          number;
  pickupLocation?:           string;
  returnLocation?:           string;
  returnLatitude?:           number;
  returnLongitude?:          number;
  pickupVehiclePhotoThumb?:  string;
  pickupGaugePhotoThumb?:    string;
  pickupAgreementPhotoThumb?: string;
  notes?:                    string;
}

export async function createRentalSession(userId: string, input: CreateRentalSessionInput): Promise<RentalSession> {
  const now = new Date().toISOString();
  if (input.pickupFuelGallons != null) assertReadingHasTank(input.pickupFuelSource, input.fuelTankCapacityGallons, 'pickupFuelGallons');
  const policyType = input.requiredReturnPolicyType ?? 'same_as_pickup';
  const requiredReturnFuelGallons = resolveRequiredReturnFuel(
    policyType,
    input.pickupFuelGallons ?? null,
    input.fuelTankCapacityGallons ?? null,
    input.requiredReturnFuelGallons ?? null,
  );

  // Validates + derives BOTH instants before anything is written; throws
  // RentalScheduleError (400/422). Client-supplied *Utc values are never read.
  const pickup = resolveCreateEvent('pickup', {
    local: input.pickupDateTime, eventZone: input.pickupTimeZone, eventSource: input.pickupTimeZoneSource,
    legacyZone: input.timeZone, choice: input.pickupTimeDisambiguation,
  });
  const ret = resolveCreateEvent('return', {
    local: input.returnDateTime, eventZone: input.returnTimeZone, eventSource: input.returnTimeZoneSource,
    legacyZone: input.timeZone, choice: input.returnTimeDisambiguation,
  });

  const row = await prisma.rentalSession.create({
    data: {
      id:                     crypto.randomUUID(),
      userId,
      vehicleId:              input.vehicleId ?? null,
      provider:                'manual',
      status:                  'active',
      rentalCompany:           input.rentalCompany,
      rentalAgreementNumber:   input.rentalAgreementNumber ?? null,
      rentalConfirmationNumber: input.rentalConfirmationNumber ?? null,
      vehicleYear:             input.vehicleYear ?? null,
      vehicleMake:             input.vehicleMake ?? null,
      vehicleModel:            input.vehicleModel ?? null,
      vehicleTrim:             input.vehicleTrim ?? null,
      fuelTankCapacityGallons: input.fuelTankCapacityGallons ?? null,
      pickupFuelGallons:       input.pickupFuelGallons ?? null,
      pickupFuelSource:        input.pickupFuelSource ?? null,
      requiredReturnFuelGallons,
      requiredReturnPolicyType: policyType,
      // The pickup reading is also our first "current" reading until the
      // renter updates it — same source/confidence as the pickup entry.
      currentFuelGallons:      input.pickupFuelGallons ?? null,
      currentFuelSource:       input.pickupFuelSource ?? null,
      currentFuelUpdatedAt:    input.pickupFuelGallons != null ? now : null,
      rentalFuelChargePerGallon: input.rentalFuelChargePerGallon ?? null,
      pickupDateTime:          pickup.local,
      returnDateTime:          ret.local,
      timeZone:                isValidIanaZone(input.timeZone) ? input.timeZone : null,
      pickupTimeZone:          pickup.zone,
      pickupTimeZoneSource:    pickup.source,
      pickupDateTimeUtc:       pickup.utc,
      returnTimeZone:          ret.zone,
      returnTimeZoneSource:    ret.source,
      returnDateTimeUtc:       ret.utc,
      pickupLatitude:          typeof input.pickupLatitude  === 'number' ? input.pickupLatitude  : null,
      pickupLongitude:         typeof input.pickupLongitude === 'number' ? input.pickupLongitude : null,
      pickupLocation:          input.pickupLocation ?? null,
      returnLocation:          input.returnLocation ?? null,
      returnLatitude:          input.returnLatitude ?? null,
      returnLongitude:         input.returnLongitude ?? null,
      pickupVehiclePhotoThumb:   input.pickupVehiclePhotoThumb ?? null,
      pickupGaugePhotoThumb:     input.pickupGaugePhotoThumb ?? null,
      pickupAgreementPhotoThumb: input.pickupAgreementPhotoThumb ?? null,
      notes:                   input.notes ?? null,
      createdAt:               now,
      updatedAt:               now,
    },
  });
  // Growth Sprint 1, P0C-1A — no rental company/agreement/confirmation/
  // address/lat-long/vehicle/photo/fuel/notes data in metadata. Known
  // limitation, not addressed here: this create path has no request-level
  // dedup, so a client retry after a lost response can produce a second,
  // genuinely distinct RentalSession row — each still correctly gets its
  // own non-duplicate event, but the underlying source data itself carries
  // that separate risk (tracked as a backlog item, not fixed in P0C-1A).
  try {
    await recordAnalyticsEvent({
      eventType: 'rental_setup_completed',
      originPlatform: 'unknown',
      emitter: 'server',
      userId,
      source: 'rental_setup',
      idempotencyKey: `rental_setup_completed:${row.id}`,
    });
  } catch (e) { console.error('[GasCap analytics] rental_setup_completed write failed:', e); }
  return toRentalSession(row);
}

export async function getRentalSessionsForUser(userId: string, status?: string): Promise<RentalSession[]> {
  const rows = await prisma.rentalSession.findMany({
    where:   { userId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toRentalSession);
}

export async function getRentalSession(userId: string, id: string): Promise<RentalSession | undefined> {
  const row = await prisma.rentalSession.findFirst({ where: { id, userId } });
  return row ? toRentalSession(row) : undefined;
}

export interface UpdateRentalSessionInput {
  rentalCompany?:              string;
  rentalAgreementNumber?:      string;
  rentalConfirmationNumber?:   string;
  vehicleYear?:                string;
  vehicleMake?:                string;
  vehicleModel?:               string;
  vehicleTrim?:                string;
  /** Explicit null clears it (Part A) — refused while a gauge/percent reading exists. */
  fuelTankCapacityGallons?:    number | null;
  pickupDateTime?:             string;
  /** IGNORED on update (2026-10-02). Kept in the type only so stale clients
   *  that still send their device zone are accepted and that zone is never
   *  applied — editing from another timezone must not reinterpret a rental. */
  timeZone?:                   string;
  pickupTimeZone?:             string;
  pickupTimeZoneSource?:       TimeZoneSource;
  returnTimeZone?:             string;
  returnTimeZoneSource?:       TimeZoneSource;
  pickupTimeDisambiguation?:   TimeDisambiguation;
  returnTimeDisambiguation?:   TimeDisambiguation;
  pickupLocation?:             string;
  pickupLatitude?:             number;
  pickupLongitude?:            number;
  pickupFuelGallons?:          number;
  pickupFuelSource?:           FuelDataSource;
  requiredReturnFuelGallons?:  number;
  requiredReturnPolicyType?:   ReturnPolicyType;
  currentFuelGallons?:        number;
  currentFuelSource?:         FuelDataSource;
  rentalFuelChargePerGallon?: number;
  returnDateTime?:            string;
  returnLocation?:            string;
  returnLatitude?:            number;
  returnLongitude?:           number;
  notes?:                     string;
  /** Phase 4 — VISUAL fuel gauge style override for this rental only. Never
   *  affects currentFuelGallons or any other fuel value. Validated against
   *  the canonical GAUGE_STYLES list at the API layer. Phase 4B: explicit
   *  null clears the override (inherit linked Vehicle / user global). */
  fuelGaugeStyle?:            string | null;
}

export async function updateRentalSession(userId: string, id: string, input: UpdateRentalSessionInput): Promise<RentalSession | undefined> {
  const existing = await prisma.rentalSession.findFirst({ where: { id, userId } });
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const effectiveCapacity = input.fuelTankCapacityGallons !== undefined ? input.fuelTankCapacityGallons : existing.fuelTankCapacityGallons;
  if (input.pickupFuelGallons  != null) assertReadingHasTank(input.pickupFuelSource,  effectiveCapacity, 'pickupFuelGallons');
  if (input.currentFuelGallons != null) assertReadingHasTank(input.currentFuelSource, effectiveCapacity, 'currentFuelGallons');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now };
  if (input.rentalCompany         !== undefined) data.rentalCompany         = input.rentalCompany;
  if (input.rentalAgreementNumber !== undefined) data.rentalAgreementNumber = input.rentalAgreementNumber;
  if (input.rentalConfirmationNumber !== undefined) data.rentalConfirmationNumber = input.rentalConfirmationNumber;
  if (input.vehicleYear           !== undefined) data.vehicleYear           = input.vehicleYear;
  if (input.vehicleMake           !== undefined) data.vehicleMake           = input.vehicleMake;
  if (input.vehicleModel          !== undefined) data.vehicleModel          = input.vehicleModel;
  if (input.vehicleTrim           !== undefined) data.vehicleTrim           = input.vehicleTrim;
  if (input.fuelTankCapacityGallons   !== undefined) data.fuelTankCapacityGallons   = input.fuelTankCapacityGallons;
  // pickupDateTime / returnDateTime / zones are written by the event-schedule
  // block below; input.timeZone (legacy device zone) is deliberately ignored.
  if (input.pickupLocation            !== undefined) data.pickupLocation            = input.pickupLocation;
  if (input.pickupLatitude            !== undefined) data.pickupLatitude            = input.pickupLatitude;
  if (input.pickupLongitude           !== undefined) data.pickupLongitude           = input.pickupLongitude;
  if (input.pickupFuelGallons         !== undefined) data.pickupFuelGallons         = input.pickupFuelGallons;
  if (input.pickupFuelSource          !== undefined) data.pickupFuelSource          = input.pickupFuelSource;

  // Under the default 'same_as_pickup' policy the return target IS the pickup
  // level, so changing pickup fuel has to move the target with it — otherwise
  // correcting a pickup reading leaves a stale target silently driving every
  // gallons-needed calculation for the rest of the rental. Only recompute
  // when the caller didn't set an explicit target in the same request.
  const effectivePolicy = (input.requiredReturnPolicyType ?? existing.requiredReturnPolicyType) as ReturnPolicyType | null;
  if (
    input.pickupFuelGallons !== undefined &&
    input.requiredReturnFuelGallons === undefined &&
    (effectivePolicy ?? 'same_as_pickup') === 'same_as_pickup'
  ) {
    data.requiredReturnFuelGallons = input.pickupFuelGallons;
  }
  if (input.requiredReturnFuelGallons !== undefined) data.requiredReturnFuelGallons = input.requiredReturnFuelGallons;
  if (input.requiredReturnPolicyType  !== undefined) data.requiredReturnPolicyType  = input.requiredReturnPolicyType;
  if (input.currentFuelGallons !== undefined) { data.currentFuelGallons = input.currentFuelGallons; data.currentFuelUpdatedAt = now; }
  if (input.currentFuelSource  !== undefined) data.currentFuelSource  = input.currentFuelSource;
  if (input.rentalFuelChargePerGallon !== undefined) data.rentalFuelChargePerGallon = input.rentalFuelChargePerGallon;
  if (input.returnLocation    !== undefined) data.returnLocation    = input.returnLocation;
  if (input.returnLatitude    !== undefined) data.returnLatitude    = input.returnLatitude;
  if (input.returnLongitude   !== undefined) data.returnLongitude   = input.returnLongitude;
  if (input.notes             !== undefined) data.notes             = input.notes;
  if (input.fuelGaugeStyle    !== undefined) data.fuelGaugeStyle    = input.fuelGaugeStyle;

  // ── Event schedule recompute + reminder reset (2026-10-02) ──────────────
  // Each event independently: its instant is re-derived, and ONLY its own
  // reminder stamps reset, when its wall clock, effective zone, or explicit
  // ambiguous-occurrence choice actually changes. Unrelated edits — and the
  // editing device's timezone — never touch scheduling.
  const p = resolveUpdateEvent('pickup', {
    local: existing.pickupDateTime, eventZone: existing.pickupTimeZone, eventSource: existing.pickupTimeZoneSource,
    legacyZone: existing.timeZone, utc: existing.pickupDateTimeUtc,
  }, { local: input.pickupDateTime, eventZone: input.pickupTimeZone, eventSource: input.pickupTimeZoneSource, choice: input.pickupTimeDisambiguation });
  const r = resolveUpdateEvent('return', {
    local: existing.returnDateTime, eventZone: existing.returnTimeZone, eventSource: existing.returnTimeZoneSource,
    legacyZone: existing.timeZone, utc: existing.returnDateTimeUtc,
  }, { local: input.returnDateTime, eventZone: input.returnTimeZone, eventSource: input.returnTimeZoneSource, choice: input.returnTimeDisambiguation });

  if (p.scheduleChanged) {
    data.pickupDateTime = p.local;
    data.pickupDateTimeUtc = p.utc;
    data.pickupReminder24SentAt = null;
    data.pickupReminder2SentAt  = null;
  }
  if (p.zoneWritten) { data.pickupTimeZone = p.zone; data.pickupTimeZoneSource = p.source; }
  if (r.scheduleChanged) {
    data.returnDateTime = r.local;
    data.returnDateTimeUtc = r.utc;
    data.reminderSentAt        = null;
    data.returnReminder2SentAt = null;
  }
  if (r.zoneWritten) { data.returnTimeZone = r.zone; data.returnTimeZoneSource = r.source; }

  // ── Tank capacity changed: reconcile the fuel figures ────────────────────
  //
  // Every stored level is in GALLONS, but a gauge or percent entry is really a
  // FRACTION of a specific tank — the gallons were derived from a capacity
  // that may no longer apply. Swapping the vehicle (a common correction: the
  // renter picks the right trim, or the EPA lookup is fixed) left the old
  // gallons in place, producing states like "~24.5 gal" on a 14 gal tank.
  // Part A (2026-10-02) makes all three transitions explicit — first entry
  // (null → value), change, and clear (value → null) — in
  // reconcileForTankCapacityChange(); a clear that would discard a
  // gauge/percent observation is refused (422), never silently applied.
  if (input.fuelTankCapacityGallons !== undefined) {
    const plan = reconcileForTankCapacityChange({
      oldCapacity: existing.fuelTankCapacityGallons,
      newCapacity: input.fuelTankCapacityGallons,
      policy: (effectivePolicy ?? 'same_as_pickup'),
      pickup:  { gallons: (data.pickupFuelGallons  ?? existing.pickupFuelGallons)  as number | null,
                 source:  (data.pickupFuelSource   ?? existing.pickupFuelSource)   as string | null, explicit: input.pickupFuelGallons !== undefined },
      current: { gallons: (data.currentFuelGallons ?? existing.currentFuelGallons) as number | null,
                 source:  (data.currentFuelSource  ?? existing.currentFuelSource)  as string | null, explicit: input.currentFuelGallons !== undefined },
      required: { gallons: existing.requiredReturnFuelGallons, explicit: data.requiredReturnFuelGallons !== undefined },
    });
    if (!plan.ok) throw new RentalScheduleError(plan.code, plan.field);
    if (plan.pickupFuelGallons         !== undefined) data.pickupFuelGallons         = plan.pickupFuelGallons;
    if (plan.currentFuelGallons        !== undefined) data.currentFuelGallons        = plan.currentFuelGallons;
    if (plan.requiredReturnFuelGallons !== undefined) data.requiredReturnFuelGallons = plan.requiredReturnFuelGallons;
  }

  const row = await prisma.rentalSession.update({ where: { id }, data });
  return toRentalSession(row);
}

// ── Current-fuel confirmation write (2026-08-28, TOCTOU/optimistic-
// concurrency correction from independent review) ──────────────────────────
//
// The ordinary updateRentalSession() above is read-then-write: fetch
// `existing`, validate, unconditional prisma.update(). Between that read and
// the write, another PATCH (a second device, a Fillup logged concurrently)
// could change currentFuelGallons — the validation the route already ran
// would then be checked against state that's no longer current, and the
// unconditional update would blindly overwrite whatever the other write
// just established.
//
// This function exists ONLY for the confirmation write specifically (the
// one piece of this feature whose entire correctness the app depends on) —
// it is not a general-purpose replacement for updateRentalSession(). The
// condition is expressed directly in the WHERE clause of an atomic
// updateMany() rather than as a separate read check: if `count` comes back
// 0, the row's currentFuelGallons no longer equals what the caller last
// saw, so nothing was written and the caller must treat it as a conflict
// (HTTP 409 at the route layer) rather than silently proceeding.
export type ConfirmRentalCurrentFuelResult =
  | { status: 'ok';       session: RentalSession }
  | { status: 'conflict' }
  | { status: 'not_found' };

export async function confirmRentalCurrentFuel(
  userId: string,
  id: string,
  input: {
    currentFuelGallons: number;
    currentFuelSource:  FuelDataSource;
    /** The full last-known fuel-state snapshot the caller validated the new
     *  reading against — null in any of these means the caller believes
     *  that field was null on the server at the time it read/validated.
     *  2026-08-28 correction (independent review, Blocker 2): gallons alone
     *  is not a sufficient optimistic-concurrency key. A concurrent Fillup
     *  that tops off an already-full tank can leave currentFuelGallons
     *  numerically unchanged while currentFuelSource/currentFuelUpdatedAt
     *  advance — and a concurrent tank-capacity edit can invalidate the
     *  gallons-vs-capacity validation this write depended on without
     *  touching currentFuelGallons at all. Conditioning the write on the
     *  full snapshot the caller actually validated against closes both
     *  gaps with no schema change and no separate read-then-write window:
     *  the check IS the write, expressed as the updateMany() WHERE clause. */
    expectedPriorCurrentFuelGallons:        number | null;
    expectedPriorCurrentFuelSource:         string | null;
    expectedPriorCurrentFuelUpdatedAt:      string | null;
    expectedPriorFuelTankCapacityGallons:   number | null;
  },
): Promise<ConfirmRentalCurrentFuelResult> {
  const existing = await prisma.rentalSession.findFirst({ where: { id, userId } });
  if (!existing) return { status: 'not_found' };

  const now = new Date().toISOString();
  const result = await prisma.rentalSession.updateMany({
    where: {
      id,
      userId,
      // The conditional snapshot: the confirmation write is only valid if
      // EVERY field the caller validated its proposed reading against still
      // matches. Anything else changing concurrently (pickup fuel, gauge
      // style, ...) is irrelevant to THIS write's correctness and is
      // deliberately not part of the condition — only the fields this
      // write's validation actually depended on. Prisma translates a plain
      // `null` in a `where` filter to `IS NULL`, so a caller who believed a
      // field was unset correctly requires it still be unset.
      currentFuelGallons:      input.expectedPriorCurrentFuelGallons,
      currentFuelSource:       input.expectedPriorCurrentFuelSource,
      currentFuelUpdatedAt:    input.expectedPriorCurrentFuelUpdatedAt,
      fuelTankCapacityGallons: input.expectedPriorFuelTankCapacityGallons,
    },
    data: {
      currentFuelGallons:   input.currentFuelGallons,
      currentFuelSource:    input.currentFuelSource,
      currentFuelUpdatedAt: now,
      updatedAt:            now,
    },
  });

  if (result.count === 0) return { status: 'conflict' };

  // Post-write identity check (2026-08-28 independent review, post-CI
  // hardening): the updateMany() above correctly protects the WRITE, but an
  // unrestricted findFirst({ id, userId }) here can observe a LATER
  // concurrent mutation — e.g. a Fillup that lands between our updateMany
  // succeeding and this read running. That later state is real and correct
  // as the row's last-known fuel, but it is NOT what the renter just
  // confirmed; returning it as this confirmation's result would let the
  // client mark an observation the renter never actually confirmed as
  // "confirmed." Re-reading with the EXACT state this write just created
  // (using the same `now` stamped above, not a fresh timestamp) closes that
  // gap: if anything changed the row again in that narrow window, this read
  // matches nothing and we correctly report a conflict instead — the
  // existing 409 path reloads the newest state and asks the renter to
  // reconfirm it, rather than silently returning it as already-confirmed.
  const row = await prisma.rentalSession.findFirst({
    where: {
      id,
      userId,
      currentFuelGallons:      input.currentFuelGallons,
      currentFuelSource:       input.currentFuelSource,
      currentFuelUpdatedAt:    now,
      fuelTankCapacityGallons: input.expectedPriorFuelTankCapacityGallons,
    },
  });
  if (!row) return { status: 'conflict' };
  return { status: 'ok', session: toRentalSession(row) };
}

export async function deleteRentalSession(userId: string, id: string): Promise<boolean> {
  const res = await prisma.rentalSession.deleteMany({ where: { id, userId } });
  return res.count > 0;
}

/**
 * LEGACY — frozen after the Phase 3A cutover (2026-08-25). No live route
 * calls this anymore; POST /api/rental-sessions/:id/refuel now creates a
 * canonical Fillup row via lib/rentalFillups.ts's createRentalFillup()
 * instead. Retained only so historical sessions created before the cutover
 * remain readable (RentalSession.refuelLogs is read-only compatibility data
 * now — see that field's schema.prisma doc comment) and so
 * pre-cutover-behavior tests keep passing. Do not wire this into any new
 * write path.
 */
export async function logRefuel(
  userId: string, id: string, entry: Omit<RefuelLogEntry, 'id' | 'timestamp'>,
): Promise<RentalSession | undefined> {
  const existing = await prisma.rentalSession.findFirst({ where: { id, userId } });
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const fullEntry: RefuelLogEntry = { ...entry, id: crypto.randomUUID(), timestamp: now };
  const existingLogs = Array.isArray(existing.refuelLogs) ? existing.refuelLogs as unknown as RefuelLogEntry[] : [];
  const newCurrentFuel = (existing.currentFuelGallons ?? 0) + entry.gallons;
  const cappedFuel = existing.fuelTankCapacityGallons != null
    ? Math.min(newCurrentFuel, existing.fuelTankCapacityGallons)
    : newCurrentFuel;

  const row = await prisma.rentalSession.update({
    where: { id },
    data: {
      refuelLogs:           [...existingLogs, fullEntry] as unknown as object,
      currentFuelGallons:   cappedFuel,
      currentFuelSource:    'RECEIPT',
      currentFuelUpdatedAt: now,
      updatedAt:            now,
    },
  });
  return toRentalSession(row);
}

export interface CompleteRentalSessionInput {
  returnGaugePhotoThumb?:      string;
  returnReceiptPhotoThumb?:    string;
  finalOdometer?:              number;
  fuelFeeCharged?:             boolean;
  fuelFeeAmount?:              number;
  fuelFeeGallonsClaimed?:      number;
  fuelFeeRentalReportedLevel?: number;
  disputeNotes?:               string;
  feedbackRating?:             number;
  feedbackText?:               string;
}

export async function completeRentalSession(
  userId: string, id: string, input: CompleteRentalSessionInput,
): Promise<RentalSession | undefined> {
  const existing = await prisma.rentalSession.findFirst({ where: { id, userId } });
  if (!existing) return undefined;

  // Phase 3A completion hardening (2026-08-25) — a repeated "Complete
  // Rental" request (double-tap, retry after a dropped response) is now a
  // safe no-op: it returns the already-completed session unchanged rather
  // than re-applying (and potentially overwriting) dispute/feedback fields
  // from a second, possibly different submission. Completing a rental never
  // creates a Fillup — completion and logging a final fuel transaction are
  // related but distinct actions (see lib/rentalFillups.ts's fillupType:
  // 'final_return', logged separately via the refuel flow if the renter
  // actually filled up).
  if (existing.status === 'completed') return toRentalSession(existing);

  const now = new Date().toISOString();
  const row = await prisma.rentalSession.update({
    where: { id },
    data: {
      status:                      'completed',
      completedAt:                  now,
      returnGaugePhotoThumb:        input.returnGaugePhotoThumb      ?? existing.returnGaugePhotoThumb,
      returnReceiptPhotoThumb:      input.returnReceiptPhotoThumb    ?? existing.returnReceiptPhotoThumb,
      fuelFeeCharged:               input.fuelFeeCharged             ?? null,
      fuelFeeAmount:                input.fuelFeeAmount              ?? null,
      fuelFeeGallonsClaimed:        input.fuelFeeGallonsClaimed      ?? null,
      fuelFeeRentalReportedLevel:   input.fuelFeeRentalReportedLevel ?? null,
      disputeNotes:                 input.disputeNotes               ?? null,
      feedbackRating:               input.feedbackRating             ?? null,
      feedbackText:                 input.feedbackText               ?? null,
      updatedAt:                    now,
    },
  });

  try {
    await recordAnalyticsEvent({
      eventType: 'rental_session_completed', originPlatform: 'unknown', emitter: 'server', userId,
      idempotencyKey: `rental_session_completed:${id}`,
    });
  } catch (e) { console.error('[GasCap analytics] rental_session_completed write failed:', e); }

  return toRentalSession(row);
}

export function computeSessionStatus(session: Pick<RentalSession, 'currentFuelGallons' | 'requiredReturnFuelGallons'>): ReturnReadyStatus {
  return returnReadyStatus(session.currentFuelGallons, session.requiredReturnFuelGallons);
}

export function computeGallonsNeeded(session: Pick<RentalSession, 'currentFuelGallons' | 'requiredReturnFuelGallons'>): number {
  if (session.requiredReturnFuelGallons == null || session.currentFuelGallons == null) return 0;
  return gallonsNeeded(session.requiredReturnFuelGallons, session.currentFuelGallons);
}

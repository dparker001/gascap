/**
 * GasCap™ Rental Return Assistant — persistence layer.
 * Thin wrapper over Prisma; API routes stay thin and never touch prisma directly.
 */
import { prisma } from './prisma';
import type { RefuelLogEntry, FuelDataSource } from './rentalProvider';
import { gallonsNeeded, resolveRequiredReturnFuel, returnReadyStatus, reconcileFuelForNewTank, type ReturnPolicyType, type ReturnReadyStatus } from './rentalCalculations';
import { recordAnalyticsEvent } from './analyticsEvents';
import { localDateTimeToUtcIso } from './rentalTimezone';

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
  /** IANA timezone captured from the browser at creation time — see lib/rentalTimezone.ts. */
  timeZone?:                 string;
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
  const policyType = input.requiredReturnPolicyType ?? 'same_as_pickup';
  const requiredReturnFuelGallons = resolveRequiredReturnFuel(
    policyType,
    input.pickupFuelGallons ?? null,
    input.fuelTankCapacityGallons ?? null,
    input.requiredReturnFuelGallons ?? null,
  );

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
      pickupDateTime:          input.pickupDateTime ?? null,
      returnDateTime:          input.returnDateTime ?? null,
      timeZone:                input.timeZone ?? null,
      pickupDateTimeUtc:       localDateTimeToUtcIso(input.pickupDateTime, input.timeZone),
      returnDateTimeUtc:       localDateTimeToUtcIso(input.returnDateTime, input.timeZone),
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
  fuelTankCapacityGallons?:    number;
  pickupDateTime?:             string;
  /** IANA timezone captured from the browser at edit time — see lib/rentalTimezone.ts. */
  timeZone?:                   string;
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
}

export async function updateRentalSession(userId: string, id: string, input: UpdateRentalSessionInput): Promise<RentalSession | undefined> {
  const existing = await prisma.rentalSession.findFirst({ where: { id, userId } });
  if (!existing) return undefined;

  const now = new Date().toISOString();
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
  if (input.pickupDateTime            !== undefined) data.pickupDateTime            = input.pickupDateTime;
  if (input.timeZone                  !== undefined) data.timeZone                  = input.timeZone;
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
  if (input.returnDateTime    !== undefined) data.returnDateTime    = input.returnDateTime;
  if (input.returnLocation    !== undefined) data.returnLocation    = input.returnLocation;
  if (input.returnLatitude    !== undefined) data.returnLatitude    = input.returnLatitude;
  if (input.returnLongitude   !== undefined) data.returnLongitude   = input.returnLongitude;
  if (input.notes             !== undefined) data.notes             = input.notes;

  // ── Reminder timezone/UTC recompute + dedup reset (2026-08-25 P0 fix) ───
  // Only trigger on an ACTUAL value change (not merely "the caller included
  // this field"), so resubmitting an unchanged rental never resets a dedup
  // flag or reschedules a reminder that already correctly fired.
  const pickupDateTimeChanged = input.pickupDateTime !== undefined && input.pickupDateTime !== existing.pickupDateTime;
  const returnDateTimeChanged = input.returnDateTime !== undefined && input.returnDateTime !== existing.returnDateTime;
  const timeZoneChanged       = input.timeZone       !== undefined && input.timeZone       !== existing.timeZone;

  if (pickupDateTimeChanged || returnDateTimeChanged || timeZoneChanged) {
    const effectivePickup = (data.pickupDateTime ?? existing.pickupDateTime) as string | null;
    const effectiveReturn = (data.returnDateTime ?? existing.returnDateTime) as string | null;
    const effectiveTz     = (data.timeZone ?? existing.timeZone) as string | null;
    data.pickupDateTimeUtc = localDateTimeToUtcIso(effectivePickup, effectiveTz);
    data.returnDateTimeUtc = localDateTimeToUtcIso(effectiveReturn, effectiveTz);
  }
  // Pickup-side dedup only resets when the PICKUP time (or the timezone
  // interpreting it) actually changed — a return-time-only edit must not
  // re-nag someone who already got their pickup reminders.
  if (pickupDateTimeChanged || timeZoneChanged) {
    data.pickupReminder24SentAt = null;
    data.pickupReminder2SentAt  = null;
  }
  // Return-side dedup only resets when the RETURN time (or timezone) changed.
  if (returnDateTimeChanged || timeZoneChanged) {
    data.reminderSentAt        = null;
    data.returnReminder2SentAt = null;
  }

  // ── Tank capacity changed: reconcile the fuel figures ────────────────────
  //
  // Every stored level is in GALLONS, but a gauge or percent entry is really a
  // FRACTION of a specific tank — the gallons were derived from a capacity
  // that may no longer apply. Swapping the vehicle (a common correction: the
  // renter picks the right trim, or the EPA lookup is fixed) left the old
  // gallons in place, producing states like "~24.5 gal" on a 14 gal tank:
  // 7/8 of the previous 28-gallon vehicle, displayed as an over-full tank and
  // a satisfied return target.
  //
  // Gauge/percent readings are rescaled so the FRACTION the renter actually
  // observed is preserved — that, not the gallon figure, was their input.
  // Absolute entries (typed gallons, a receipt) are left alone but clamped,
  // since a tank cannot hold more than its capacity either way.
  const newCap = (data.fuelTankCapacityGallons ?? existing.fuelTankCapacityGallons) as number | null;
  const oldCap = existing.fuelTankCapacityGallons;
  const capChanged =
    data.fuelTankCapacityGallons !== undefined &&
    newCap != null && oldCap != null && newCap > 0 && oldCap > 0 && newCap !== oldCap;

  if (capChanged && newCap != null && oldCap != null) {
    const reconcile = (gallons: number | null, source: string | null): number | null =>
      reconcileFuelForNewTank(gallons, source as FuelDataSource | null, oldCap, newCap);

    // Only touch values the caller didn't explicitly set in this same request —
    // an explicit value is the user's current intent and outranks a rescale.
    if (input.pickupFuelGallons === undefined) {
      data.pickupFuelGallons = reconcile(
        existing.pickupFuelGallons,
        (data.pickupFuelSource ?? existing.pickupFuelSource) as string | null,
      );
    }
    if (input.currentFuelGallons === undefined) {
      data.currentFuelGallons = reconcile(
        existing.currentFuelGallons,
        (data.currentFuelSource ?? existing.currentFuelSource) as string | null,
      );
    }
    if (input.requiredReturnFuelGallons === undefined && data.requiredReturnFuelGallons === undefined) {
      // The target follows whatever policy produced it; under same-as-pickup
      // it tracks the reconciled pickup level, otherwise just clamp it.
      const policy = (effectivePolicy ?? 'same_as_pickup');
      data.requiredReturnFuelGallons = policy === 'same_as_pickup'
        ? (data.pickupFuelGallons ?? reconcile(existing.pickupFuelGallons, (existing.pickupFuelSource as string | null)))
        : reconcile(existing.requiredReturnFuelGallons, null);
    }
  }

  const row = await prisma.rentalSession.update({ where: { id }, data });
  return toRentalSession(row);
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

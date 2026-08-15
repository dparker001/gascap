/**
 * GasCap™ Rental Return Assistant — persistence layer.
 * Thin wrapper over Prisma; API routes stay thin and never touch prisma directly.
 */
import { prisma } from './prisma';
import type { RefuelLogEntry, FuelDataSource } from './rentalProvider';
import { gallonsNeeded, resolveRequiredReturnFuel, returnReadyStatus, type ReturnPolicyType, type ReturnReadyStatus } from './rentalCalculations';

export interface RentalSession {
  id:                          string;
  userId:                      string;
  vehicleId:                   string | null;
  provider:                    string;
  status:                      'active' | 'completed' | 'cancelled';
  rentalCompany:               string;
  rentalAgreementNumber:       string | null;
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
  if (input.currentFuelGallons !== undefined) { data.currentFuelGallons = input.currentFuelGallons; data.currentFuelUpdatedAt = now; }
  if (input.currentFuelSource  !== undefined) data.currentFuelSource  = input.currentFuelSource;
  if (input.rentalFuelChargePerGallon !== undefined) data.rentalFuelChargePerGallon = input.rentalFuelChargePerGallon;
  if (input.returnDateTime    !== undefined) data.returnDateTime    = input.returnDateTime;
  if (input.returnLocation    !== undefined) data.returnLocation    = input.returnLocation;
  if (input.returnLatitude    !== undefined) data.returnLatitude    = input.returnLatitude;
  if (input.returnLongitude   !== undefined) data.returnLongitude   = input.returnLongitude;
  if (input.notes             !== undefined) data.notes             = input.notes;

  const row = await prisma.rentalSession.update({ where: { id }, data });
  return toRentalSession(row);
}

export async function deleteRentalSession(userId: string, id: string): Promise<boolean> {
  const res = await prisma.rentalSession.deleteMany({ where: { id, userId } });
  return res.count > 0;
}

/** Append an "I Just Refueled" log entry and roll it into currentFuelGallons. */
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
  return toRentalSession(row);
}

export function computeSessionStatus(session: Pick<RentalSession, 'currentFuelGallons' | 'requiredReturnFuelGallons'>): ReturnReadyStatus {
  return returnReadyStatus(session.currentFuelGallons, session.requiredReturnFuelGallons);
}

export function computeGallonsNeeded(session: Pick<RentalSession, 'currentFuelGallons' | 'requiredReturnFuelGallons'>): number {
  if (session.requiredReturnFuelGallons == null || session.currentFuelGallons == null) return 0;
  return gallonsNeeded(session.requiredReturnFuelGallons, session.currentFuelGallons);
}

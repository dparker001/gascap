/**
 * Saved vehicles — persisted in PostgreSQL via Prisma.
 */
import { prisma } from './prisma';
import type { VehicleSpecs } from './vehicleSpecs';
import { recordAnalyticsEvent } from './analyticsEvents';

export interface SavedVehicle {
  id:                 string;
  userId:             string;
  name:               string;    // custom nickname or auto "2022 Toyota Camry"
  gallons:            number;    // tank capacity (confirmed by user)
  // Raw VIN — stored so specs can be re-fetched later
  vin?:               string;
  // Rich vehicle data from EPA fueleconomy.gov
  year?:              string;
  make?:              string;
  model?:             string;
  trim?:              string;
  fuelType?:          string;
  // True once the user has explicitly set/confirmed fuelType themselves (via the
  // edit-vehicle fuel type selector) — distinguishes "the owner told us" from
  // "our best EPA-derived guess", which matters both for display (no need to
  // caveat a user-confirmed value) and for liability (see gotcha-vin-epa-trim-matching
  // memory — a wrong octane recommendation is a real mechanical/legal risk).
  fuelTypeConfirmedByUser?: boolean;
  epaId?:             string;
  // Baseline odometer when vehicle was added to garage
  currentOdometer?:   number;
  vehicleSpecs?:      VehicleSpecs;
  isDefault:          boolean;
  createdAt:          string;
  /** Phase 4 (2026-08-25) — VISUAL fuel gauge style only, one of
   *  lib/gaugeStyles.ts's GAUGE_STYLES. Undefined/null resolves to the
   *  GasCap default (analog needle) via resolveGaugeStyle() — never
   *  inferred from VIN/make/model, always either unset or user-chosen. */
  fuelGaugeStyle?:    string | null;
}

function toSavedVehicle(v: {
  id: string;
  userId: string;
  name: string;
  gallons: number;
  vin: string | null;
  year: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  fuelType: string | null;
  fuelTypeConfirmedByUser?: boolean;
  epaId: string | null;
  currentOdometer: number | null;
  vehicleSpecs: unknown;
  isDefault?: boolean;
  createdAt: string;
  fuelGaugeStyle?: string | null;
}): SavedVehicle {
  return {
    id:                 v.id,
    userId:             v.userId,
    name:               v.name,
    gallons:            v.gallons,
    vin:                v.vin             ?? undefined,
    year:               v.year            ?? undefined,
    make:               v.make            ?? undefined,
    model:              v.model           ?? undefined,
    trim:               v.trim            ?? undefined,
    fuelType:           v.fuelType        ?? undefined,
    fuelTypeConfirmedByUser: v.fuelTypeConfirmedByUser ?? false,
    epaId:              v.epaId           ?? undefined,
    currentOdometer:    v.currentOdometer ?? undefined,
    vehicleSpecs:       v.vehicleSpecs    != null ? (v.vehicleSpecs as VehicleSpecs) : undefined,
    isDefault:          v.isDefault       ?? false,
    createdAt:          v.createdAt,
    fuelGaugeStyle:     v.fuelGaugeStyle  ?? undefined,
  };
}

export async function getVehiclesForUser(userId: string): Promise<SavedVehicle[]> {
  const rows = await prisma.vehicle.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toSavedVehicle);
}

export async function addVehicle(
  userId: string,
  name: string,
  gallons: number,
  extra?: {
    vin?:             string;
    year?:            string;
    make?:            string;
    model?:           string;
    trim?:            string;
    fuelType?:        string;
    epaId?:           string;
    currentOdometer?: number;
    vehicleSpecs?:    VehicleSpecs;
  },
): Promise<SavedVehicle> {
  const row = await prisma.vehicle.create({
    data: {
      id:              crypto.randomUUID(),
      userId,
      name:            name.trim(),
      gallons,
      createdAt:       new Date().toISOString(),
      vin:             extra?.vin             ?? null,
      year:            extra?.year            ?? null,
      make:            extra?.make            ?? null,
      model:           extra?.model           ?? null,
      trim:            extra?.trim            ?? null,
      fuelType:        extra?.fuelType        ?? null,
      epaId:           extra?.epaId           ?? null,
      currentOdometer: extra?.currentOdometer ?? null,
      vehicleSpecs:    (extra?.vehicleSpecs ?? undefined) as unknown as object | undefined,
    },
  });
  // Growth Sprint 1, P0C-1A — fires for every genuine Vehicle creation
  // (manual save, VIN-derived save, and CSV/Fleet import all funnel through
  // this single function). No VIN/name/vehicle-identifying metadata.
  try {
    await recordAnalyticsEvent({
      eventType: 'vehicle_saved',
      originPlatform: 'unknown',
      emitter: 'server',
      userId,
      source: 'vehicle_create',
      idempotencyKey: `vehicle_saved:${row.id}`,
    });
  } catch (e) { console.error('[GasCap analytics] vehicle_saved write failed:', e); }
  return toSavedVehicle(row);
}

export async function deleteVehicle(userId: string, vehicleId: string): Promise<void> {
  await prisma.vehicle.deleteMany({
    where: { id: vehicleId, userId },
  });
}

// Only one vehicle can be default at a time — clear any existing default
// before setting the new one, in a single transaction so a mid-request
// failure can't leave two vehicles (or zero) marked default.
export async function setDefaultVehicle(userId: string, vehicleId: string): Promise<SavedVehicle | undefined> {
  const existing = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
  if (!existing) return undefined;

  const [, row] = await prisma.$transaction([
    prisma.vehicle.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
    prisma.vehicle.update({ where: { id: vehicleId }, data: { isDefault: true } }),
  ]);
  return toSavedVehicle(row);
}

export async function clearDefaultVehicle(userId: string, vehicleId: string): Promise<SavedVehicle | undefined> {
  const existing = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
  if (!existing) return undefined;
  const row = await prisma.vehicle.update({ where: { id: vehicleId }, data: { isDefault: false } });
  return toSavedVehicle(row);
}

export async function updateVehicle(
  userId: string,
  vehicleId: string,
  updates: {
    name?: string; gallons?: number; vin?: string; currentOdometer?: number; vehicleSpecs?: VehicleSpecs;
    fuelType?: string; fuelTypeConfirmedByUser?: boolean;
    /** Phase 4 — VISUAL preference only; validated against the canonical
     *  GAUGE_STYLES list at the API layer before reaching here. */
    fuelGaugeStyle?: string | null;
  },
): Promise<SavedVehicle | undefined> {
  // Verify ownership first
  const existing = await prisma.vehicle.findFirst({
    where: { id: vehicleId, userId },
  });
  if (!existing) return undefined;

  const data: Record<string, unknown> = {};
  if (updates.name             !== undefined) data.name             = updates.name;
  if (updates.gallons          !== undefined) data.gallons          = updates.gallons;
  if (updates.vin              !== undefined) data.vin              = updates.vin || null;
  if (updates.currentOdometer  !== undefined) data.currentOdometer  = updates.currentOdometer;
  if (updates.vehicleSpecs     !== undefined) data.vehicleSpecs     = updates.vehicleSpecs;
  if (updates.fuelType         !== undefined) data.fuelType         = updates.fuelType || null;
  if (updates.fuelTypeConfirmedByUser !== undefined) data.fuelTypeConfirmedByUser = updates.fuelTypeConfirmedByUser;
  if (updates.fuelGaugeStyle   !== undefined) data.fuelGaugeStyle   = updates.fuelGaugeStyle;

  const row = await prisma.vehicle.update({
    where: { id: vehicleId },
    data,
  });
  return toSavedVehicle(row);
}

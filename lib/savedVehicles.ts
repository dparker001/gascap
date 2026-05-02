/**
 * Saved vehicles — persisted in PostgreSQL via Prisma.
 */
import { prisma } from './prisma';
import type { VehicleSpecs } from './vehicleSpecs';

export interface SavedVehicle {
  id:               string;
  userId:           string;
  name:             string;    // custom nickname or auto "2022 Toyota Camry"
  gallons:          number;    // tank capacity (confirmed by user)
  // Raw VIN — stored so specs can be re-fetched later
  vin?:             string;
  // Rich vehicle data from EPA fueleconomy.gov
  year?:            string;
  make?:            string;
  model?:           string;
  trim?:            string;
  fuelType?:        string;
  epaId?:           string;
  // Baseline odometer when vehicle was added to garage
  currentOdometer?: number;
  vehicleSpecs?:    VehicleSpecs;
  createdAt:        string;
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
  epaId: string | null;
  currentOdometer: number | null;
  vehicleSpecs: unknown;
  createdAt: string;
}): SavedVehicle {
  return {
    id:              v.id,
    userId:          v.userId,
    name:            v.name,
    gallons:         v.gallons,
    vin:             v.vin             ?? undefined,
    year:            v.year            ?? undefined,
    make:            v.make            ?? undefined,
    model:           v.model           ?? undefined,
    trim:            v.trim            ?? undefined,
    fuelType:        v.fuelType        ?? undefined,
    epaId:           v.epaId           ?? undefined,
    currentOdometer: v.currentOdometer ?? undefined,
    vehicleSpecs:    v.vehicleSpecs    != null ? (v.vehicleSpecs as VehicleSpecs) : undefined,
    createdAt:       v.createdAt,
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
  return toSavedVehicle(row);
}

export async function deleteVehicle(userId: string, vehicleId: string): Promise<void> {
  await prisma.vehicle.deleteMany({
    where: { id: vehicleId, userId },
  });
}

export async function updateVehicle(
  userId: string,
  vehicleId: string,
  updates: { name?: string; gallons?: number; vin?: string; currentOdometer?: number; vehicleSpecs?: VehicleSpecs },
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

  const row = await prisma.vehicle.update({
    where: { id: vehicleId },
    data,
  });
  return toSavedVehicle(row);
}

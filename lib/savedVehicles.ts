/**
 * Saved vehicles — persisted per user in a JSON file.
 * For production: replace with a DB table.
 */
import fs   from 'fs';
import path from 'path';
import type { VehicleSpecs } from './vehicleSpecs';

export interface SavedVehicle {
  id:               string;
  userId:           string;
  name:             string;    // custom nickname or auto "2022 Toyota Camry"
  gallons:          number;    // tank capacity (confirmed by user)
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

const DATA_FILE = path.join(process.cwd(), 'data', 'vehicles.json');

function read(): SavedVehicle[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as SavedVehicle[];
  } catch {
    return [];
  }
}

function write(rows: SavedVehicle[]) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2));
}

export function getVehiclesForUser(userId: string): SavedVehicle[] {
  return read().filter((v) => v.userId === userId);
}

export function addVehicle(
  userId: string,
  name: string,
  gallons: number,
  extra?: {
    year?:            string;
    make?:            string;
    model?:           string;
    trim?:            string;
    fuelType?:        string;
    epaId?:           string;
    currentOdometer?: number;
    vehicleSpecs?:    VehicleSpecs;
  },
): SavedVehicle {
  const rows = read();
  const vehicle: SavedVehicle = {
    id:        crypto.randomUUID(),
    userId,
    name:      name.trim(),
    gallons,
    createdAt: new Date().toISOString(),
    ...extra,
  };
  rows.push(vehicle);
  write(rows);
  return vehicle;
}

export function deleteVehicle(userId: string, vehicleId: string): void {
  const rows = read().filter((v) => !(v.id === vehicleId && v.userId === userId));
  write(rows);
}

export function updateVehicle(
  userId: string,
  vehicleId: string,
  updates: { name?: string; gallons?: number; currentOdometer?: number },
): SavedVehicle | undefined {
  const all = read();
  const idx = all.findIndex((v) => v.userId === userId && v.id === vehicleId);
  if (idx === -1) return undefined;
  if (updates.name             !== undefined) all[idx].name             = updates.name;
  if (updates.gallons          !== undefined) all[idx].gallons          = updates.gallons;
  if (updates.currentOdometer  !== undefined) all[idx].currentOdometer  = updates.currentOdometer;
  write(all);
  return all[idx];
}

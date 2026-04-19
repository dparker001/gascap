/**
 * Fillup Log — JSON file store.
 * Each record represents one pump visit logged by a user.
 */
import fs   from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const FILE = path.join(process.cwd(), 'data', 'fillups.json');

export interface Fillup {
  id:             string;
  userId:         string;
  vehicleId?:     string;
  vehicleName:    string;
  date:           string;   // YYYY-MM-DD
  gallonsPumped:  number;
  pricePerGallon: number;
  totalCost:      number;   // gallonsPumped × pricePerGallon
  odometerReading?: number; // optional — enables MPG calculation
  fuelLevelBefore?: number; // 0–100 %
  notes?:         string;
  driverLabel?:   string;   // Fleet Phase 1 — who drove (attribution only)
  createdAt:      string;   // ISO timestamp
}

function read(): Fillup[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Fillup[];
  } catch {
    return [];
  }
}

function write(data: Fillup[]): void {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

/** All fillups for a user, newest first */
export function getFillups(userId: string): Fillup[] {
  return read()
    .filter((f) => f.userId === userId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

// ── Fillup validation ──────────────────────────────────────────────────────

export interface FillupValidationResult {
  errors:      string[];   // hard blocks — cannot save
  warnings:    string[];   // soft — can override with force:true
  canOverride: boolean;    // true when only warnings, no hard errors
}

/**
 * Validate a candidate fillup against existing history for this user.
 * Call BEFORE addFillup. Returns hard errors and soft warnings.
 */
export function validateNewFillup(
  userId: string,
  incoming: {
    vehicleId?:      string;
    vehicleName:     string;
    date:            string;
    gallonsPumped:   number;
    pricePerGallon:  number;
    odometerReading?: number;
  },
): FillupValidationResult {
  const errors:   string[] = [];
  const warnings: string[] = [];

  const all       = getFillups(userId);
  const vehicleKey = incoming.vehicleId ?? incoming.vehicleName;

  // Get all fillups for this specific vehicle, sorted oldest→newest
  const vehicleFillups = all
    .filter((f) => (f.vehicleId ?? f.vehicleName) === vehicleKey)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  const lastFillup = vehicleFillups.length > 0
    ? vehicleFillups[vehicleFillups.length - 1]
    : null;

  // ── Hard errors ────────────────────────────────────────────────

  // Future date
  const today = new Date().toISOString().split('T')[0];
  if (incoming.date > today) {
    errors.push('Fill-up date cannot be in the future.');
  }

  // ── Same-day duplicate ─────────────────────────────────────────
  const sameDayExists = vehicleFillups.some((f) => f.date === incoming.date);
  if (sameDayExists) {
    warnings.push(
      `A fill-up for "${incoming.vehicleName}" is already logged on this date. ` +
      `Two fill-ups on the same day is unusual — are you sure?`
    );
  }

  // ── Odometer checks ───────────────────────────────────────────
  if (incoming.odometerReading != null && lastFillup?.odometerReading != null) {
    const miles = incoming.odometerReading - lastFillup.odometerReading;

    // Odometer went backwards — hard error
    if (miles < 0) {
      errors.push(
        `Odometer reading (${incoming.odometerReading.toLocaleString()} mi) is lower than the ` +
        `last recorded reading (${lastFillup.odometerReading.toLocaleString()} mi). ` +
        `Odometers don't go backwards — please check your entry.`
      );
    }

    // Suspiciously small miles since last fill-up on a different date
    if (miles >= 0 && miles < 15 && incoming.date !== lastFillup.date) {
      warnings.push(
        `Only ${miles} mile${miles !== 1 ? 's' : ''} since the last fill-up — that seems too short for a separate visit. ` +
        `Did you enter the correct odometer reading?`
      );
    }

    // Suspiciously large jump
    if (miles > 6000) {
      warnings.push(
        `${miles.toLocaleString()} miles since the last fill-up is unusually high. ` +
        `Please verify the odometer reading is correct.`
      );
    }

    // Would-be MPG sanity check
    const wouldBeMpg = miles > 0 && lastFillup.gallonsPumped > 0
      ? miles / incoming.gallonsPumped
      : null;
    if (wouldBeMpg !== null) {
      if (wouldBeMpg < 5) {
        warnings.push(
          `The calculated MPG (${wouldBeMpg.toFixed(1)}) is extremely low. ` +
          `Check the odometer reading or gallons entered.`
        );
      } else if (wouldBeMpg > 120) {
        warnings.push(
          `The calculated MPG (${wouldBeMpg.toFixed(1)}) is unrealistically high. ` +
          `Check the odometer reading or gallons entered.`
        );
      }
    }
  }

  // ── Gallons sanity ────────────────────────────────────────────
  if (incoming.gallonsPumped > 60) {
    warnings.push(
      `${incoming.gallonsPumped} gallons is more than most personal vehicle tanks hold. ` +
      `Please confirm this is correct.`
    );
  }

  // ── Price sanity ─────────────────────────────────────────────
  if (incoming.pricePerGallon < 1.5) {
    warnings.push(
      `$${incoming.pricePerGallon.toFixed(2)}/gal is unusually low for US fuel prices. ` +
      `Please confirm this is correct.`
    );
  } else if (incoming.pricePerGallon > 9.0) {
    warnings.push(
      `$${incoming.pricePerGallon.toFixed(2)}/gal is unusually high. ` +
      `Please confirm this is correct.`
    );
  }

  return {
    errors,
    warnings,
    canOverride: errors.length === 0 && warnings.length > 0,
  };
}

/** Add a new fillup record */
export function addFillup(
  userId: string,
  data: Omit<Fillup, 'id' | 'userId' | 'totalCost' | 'createdAt'>,
): Fillup {
  const all = read();
  const entry: Fillup = {
    ...data,
    id:        randomUUID(),
    userId,
    totalCost: Math.round(data.gallonsPumped * data.pricePerGallon * 100) / 100,
    createdAt: new Date().toISOString(),
  };
  all.push(entry);
  write(all);
  return entry;
}

/** Fields that users are allowed to edit after logging */
export type FillupPatch = Partial<Pick<Fillup,
  'date' | 'gallonsPumped' | 'pricePerGallon' | 'odometerReading' | 'notes' | 'driverLabel'
>>;

/** Update an existing fillup (only if it belongs to the user). Returns the updated record or null. */
export function updateFillup(userId: string, fillupId: string, patch: FillupPatch): Fillup | null {
  const all = read();
  const idx = all.findIndex((f) => f.id === fillupId && f.userId === userId);
  if (idx === -1) return null;
  const updated: Fillup = { ...all[idx], ...patch };
  // Always recalculate totalCost from the (possibly updated) gallons and price
  updated.totalCost = Math.round(updated.gallonsPumped * updated.pricePerGallon * 100) / 100;
  all[idx] = updated;
  write(all);
  return updated;
}

/** Delete a fillup by id (only if it belongs to the user) */
export function deleteFillup(userId: string, fillupId: string): boolean {
  const all = read();
  const next = all.filter((f) => !(f.id === fillupId && f.userId === userId));
  if (next.length === all.length) return false;
  write(next);
  return true;
}

/**
 * Compute MPG for each fillup that has consecutive odometer readings.
 * Returns a map of fillupId → mpg (null if not calculable).
 */
export function computeMpg(fillups: Fillup[]): Record<string, number | null> {
  // Sort oldest→newest per vehicle to find consecutive pairs
  const byVehicle: Record<string, Fillup[]> = {};
  for (const f of fillups) {
    const key = f.vehicleId ?? f.vehicleName;
    if (!byVehicle[key]) byVehicle[key] = [];
    byVehicle[key].push(f);
  }

  const result: Record<string, number | null> = {};
  for (const f of fillups) result[f.id] = null;

  for (const group of Object.values(byVehicle)) {
    const sorted = [...group]
      .filter((f) => f.odometerReading != null)
      .sort((a, b) => a.date.localeCompare(b.date));

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.odometerReading == null || curr.odometerReading == null) continue;
      const miles = curr.odometerReading - prev.odometerReading;
      if (miles > 0 && curr.gallonsPumped > 0) {
        result[curr.id] = Math.round((miles / curr.gallonsPumped) * 10) / 10;
      }
    }
  }

  return result;
}

/** Aggregate stats for a user's fillup history */
export function getFillupStats(fillups: Fillup[], mpgMap: Record<string, number | null>) {
  const totalSpent   = fillups.reduce((s, f) => s + f.totalCost, 0);
  const totalGallons = fillups.reduce((s, f) => s + f.gallonsPumped, 0);
  const mpgValues    = Object.values(mpgMap).filter((v): v is number => v !== null);
  const avgMpg       = mpgValues.length > 0
    ? Math.round((mpgValues.reduce((s, v) => s + v, 0) / mpgValues.length) * 10) / 10
    : null;

  return {
    count:        fillups.length,
    totalSpent:   Math.round(totalSpent * 100) / 100,
    totalGallons: Math.round(totalGallons * 10) / 10,
    avgMpg,
  };
}

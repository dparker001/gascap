/**
 * Fillup Log — PostgreSQL via Prisma.
 * Migrated from JSON file store so fill-up data survives Railway deployments.
 */
import { randomUUID } from 'crypto';
import { prisma }     from './prisma';

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
  stationName?:   string;
  notes?:         string;
  driverLabel?:   string;   // Fleet Phase 1 — driver attribution
  fuelGrade?:     string;   // "regular" | "midgrade" | "premium" | "diesel" | "e85"
  receiptThumb?:  string;   // base64 data URL of compressed receipt thumbnail
  createdAt:      string;   // ISO timestamp
}

// ── Type adapter ────────────────────────────────────────────────────────────

/**
 * Prisma returns nullable fields as `null`; our Fillup interface uses
 * optional (undefined). This adapter normalises the two.
 */
function fromPrisma(r: {
  id: string; userId: string; vehicleId: string | null; vehicleName: string;
  date: string; gallonsPumped: number; pricePerGallon: number; totalCost: number;
  odometerReading: number | null; fuelLevelBefore: number | null;
  stationName: string | null; notes: string | null; driverLabel: string | null;
  fuelGrade: string | null; receiptThumb: string | null;
  createdAt: string;
}): Fillup {
  return {
    id:              r.id,
    userId:          r.userId,
    vehicleId:       r.vehicleId    ?? undefined,
    vehicleName:     r.vehicleName,
    date:            r.date,
    gallonsPumped:   r.gallonsPumped,
    pricePerGallon:  r.pricePerGallon,
    totalCost:       r.totalCost,
    odometerReading: r.odometerReading ?? undefined,
    fuelLevelBefore: r.fuelLevelBefore ?? undefined,
    stationName:     r.stationName     ?? undefined,
    notes:           r.notes           ?? undefined,
    driverLabel:     r.driverLabel     ?? undefined,
    fuelGrade:       r.fuelGrade       ?? undefined,
    receiptThumb:    r.receiptThumb    ?? undefined,
    createdAt:       r.createdAt,
  };
}

// ── Read ────────────────────────────────────────────────────────────────────

/** All fillups for a user, newest first */
export async function getFillups(userId: string): Promise<Fillup[]> {
  const rows = await prisma.fillup.findMany({
    where:   { userId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(fromPrisma);
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface FillupValidationResult {
  errors:      string[];
  warnings:    string[];
  canOverride: boolean;
}

/**
 * Validate a candidate fillup against existing history for this user.
 * Call BEFORE addFillup. Returns hard errors and soft warnings.
 * Now async because getFillups is async.
 */
export async function validateNewFillup(
  userId: string,
  incoming: {
    vehicleId?:      string;
    vehicleName:     string;
    date:            string;
    gallonsPumped:   number;
    pricePerGallon:  number;
    odometerReading?: number;
  },
): Promise<FillupValidationResult> {
  const errors:   string[] = [];
  const warnings: string[] = [];

  const all        = await getFillups(userId);
  const vehicleKey = incoming.vehicleId ?? incoming.vehicleName;

  const vehicleFillups = all
    .filter((f) => (f.vehicleId ?? f.vehicleName) === vehicleKey)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  const lastFillup = vehicleFillups.length > 0
    ? vehicleFillups[vehicleFillups.length - 1]
    : null;

  // ── Hard errors ──────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  if (incoming.date > today) {
    errors.push('Fill-up date cannot be in the future.');
  }

  // ── Same-day duplicate ───────────────────────────────────────────
  const sameDayExists = vehicleFillups.some((f) => f.date === incoming.date);
  if (sameDayExists) {
    warnings.push(
      `A fill-up for "${incoming.vehicleName}" is already logged on this date. ` +
      `Two fill-ups on the same day is unusual — are you sure?`
    );
  }

  // ── Odometer checks ──────────────────────────────────────────────
  if (incoming.odometerReading != null && lastFillup?.odometerReading != null) {
    const miles = incoming.odometerReading - lastFillup.odometerReading;

    if (miles < 0) {
      errors.push(
        `Odometer reading (${incoming.odometerReading.toLocaleString()} mi) is lower than the ` +
        `last recorded reading (${lastFillup.odometerReading.toLocaleString()} mi). ` +
        `Odometers don't go backwards — please check your entry.`
      );
    }

    if (miles >= 0 && miles < 15 && incoming.date !== lastFillup.date) {
      warnings.push(
        `Only ${miles} mile${miles !== 1 ? 's' : ''} since the last fill-up — that seems too short for a separate visit. ` +
        `Did you enter the correct odometer reading?`
      );
    }

    if (miles > 6000) {
      warnings.push(
        `${miles.toLocaleString()} miles since the last fill-up is unusually high. ` +
        `Please verify the odometer reading is correct.`
      );
    }

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

  // ── Gallons sanity ────────────────────────────────────────────────
  if (incoming.gallonsPumped > 60) {
    warnings.push(
      `${incoming.gallonsPumped} gallons is more than most personal vehicle tanks hold. ` +
      `Please confirm this is correct.`
    );
  }

  // ── Price sanity ──────────────────────────────────────────────────
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

// ── Write ───────────────────────────────────────────────────────────────────

/** Add a new fillup record */
export async function addFillup(
  userId: string,
  data: Omit<Fillup, 'id' | 'userId' | 'totalCost' | 'createdAt'>,
): Promise<Fillup> {
  const entry = await prisma.fillup.create({
    data: {
      id:              randomUUID(),
      userId,
      vehicleId:       data.vehicleId       ?? null,
      vehicleName:     data.vehicleName,
      date:            data.date,
      gallonsPumped:   data.gallonsPumped,
      pricePerGallon:  data.pricePerGallon,
      totalCost:       Math.round(data.gallonsPumped * data.pricePerGallon * 100) / 100,
      odometerReading: data.odometerReading  ?? null,
      fuelLevelBefore: data.fuelLevelBefore  ?? null,
      stationName:     data.stationName      ?? null,
      notes:           data.notes            ?? null,
      driverLabel:     data.driverLabel      ?? null,
      fuelGrade:       data.fuelGrade        ?? null,
      receiptThumb:    data.receiptThumb     ?? null,
      createdAt:       new Date().toISOString(),
    },
  });
  return fromPrisma(entry);
}

/** Fields that users are allowed to edit after logging */
export type FillupPatch = Partial<Pick<Fillup,
  'date' | 'gallonsPumped' | 'pricePerGallon' | 'odometerReading' | 'stationName' | 'notes' | 'driverLabel' | 'fuelGrade'
>>;

/** Update an existing fillup (only if it belongs to the user). Returns updated record or null. */
export async function updateFillup(
  userId: string,
  fillupId: string,
  patch: FillupPatch,
): Promise<Fillup | null> {
  // Verify ownership
  const existing = await prisma.fillup.findFirst({ where: { id: fillupId, userId } });
  if (!existing) return null;

  const gallons = patch.gallonsPumped ?? existing.gallonsPumped;
  const price   = patch.pricePerGallon ?? existing.pricePerGallon;
  const updated = await prisma.fillup.update({
    where: { id: fillupId },
    data: {
      ...(patch.date            !== undefined && { date:            patch.date }),
      ...(patch.gallonsPumped   !== undefined && { gallonsPumped:   patch.gallonsPumped }),
      ...(patch.pricePerGallon  !== undefined && { pricePerGallon:  patch.pricePerGallon }),
      ...(patch.odometerReading !== undefined && { odometerReading: patch.odometerReading ?? null }),
      ...(patch.stationName     !== undefined && { stationName:     patch.stationName     ?? null }),
      ...(patch.notes           !== undefined && { notes:           patch.notes           ?? null }),
      ...(patch.driverLabel     !== undefined && { driverLabel:     patch.driverLabel     ?? null }),
      ...(patch.fuelGrade       !== undefined && { fuelGrade:       patch.fuelGrade       ?? null }),
      totalCost: Math.round(gallons * price * 100) / 100,
    },
  });
  return fromPrisma(updated);
}

/** Delete a fillup by id (only if it belongs to the user) */
export async function deleteFillup(userId: string, fillupId: string): Promise<boolean> {
  const result = await prisma.fillup.deleteMany({
    where: { id: fillupId, userId },
  });
  return result.count > 0;
}

/** Return the user's recently used station names, newest-first, deduplicated. */
export async function getRecentStations(userId: string, limit = 10): Promise<string[]> {
  const rows = await prisma.fillup.findMany({
    where:   { userId, stationName: { not: null } },
    select:  { stationName: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const seen   = new Set<string>();
  const result: string[] = [];
  for (const r of rows) {
    if (!r.stationName || seen.has(r.stationName)) continue;
    seen.add(r.stationName);
    result.push(r.stationName);
    if (result.length >= limit) break;
  }
  return result;
}

// ── Pure computation helpers (synchronous — work on already-fetched data) ──

/**
 * Compute MPG for each fillup that has consecutive odometer readings.
 * Returns a map of fillupId → mpg (null if not calculable).
 */
export function computeMpg(fillups: Fillup[]): Record<string, number | null> {
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

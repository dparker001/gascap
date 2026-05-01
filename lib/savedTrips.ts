/**
 * Saved Trips — JSON file store.
 *
 * Each record represents a saved trip fuel calculation, including the
 * route (if route-based) and the calculated fuel plan.
 *
 * Pro/Fleet only: trial users (whose plan = 'pro') can save and view trips.
 * Free users see locked cards after their trial expires.
 */
import fs   from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const FILE = path.join(process.cwd(), 'data', 'saved-trips.json');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SavedTrip {
  id:             string;
  userId:         string;
  savedAt:        string;   // ISO timestamp

  // Route info — present for route-based trips, absent for manual-distance trips
  origin?:        string;
  destination?:   string;

  // Inputs
  distanceMiles:  number;
  mpg:            number;
  tankGallons:    number;
  pricePerGallon: number;
  travelers:      number;
  fuelPct:        number;   // starting fuel level 0–100

  // Calculated results
  gallonsNeeded:  number;
  fuelCost:       number;
  stops:          number;   // en-route refuel stops
  totalTripCost:  number;   // full trip cost (no current-fuel offset)
}

// ── File I/O ──────────────────────────────────────────────────────────────────

function read(): SavedTrip[] {
  try {
    if (!fs.existsSync(FILE)) return [];
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as SavedTrip[];
  } catch { return []; }
}

function write(trips: SavedTrip[]): void {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(trips, null, 2));
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getTripsForUser(userId: string): SavedTrip[] {
  return read()
    .filter((t) => t.userId === userId)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function addTrip(
  userId: string,
  data: Omit<SavedTrip, 'id' | 'userId' | 'savedAt'>,
): SavedTrip {
  const trips = read();
  const trip: SavedTrip = {
    id:      randomUUID(),
    userId,
    savedAt: new Date().toISOString(),
    ...data,
  };
  trips.push(trip);
  write(trips);
  return trip;
}

export function removeTrip(userId: string, tripId: string): boolean {
  const trips    = read();
  const filtered = trips.filter((t) => !(t.id === tripId && t.userId === userId));
  if (filtered.length === trips.length) return false;
  write(filtered);
  return true;
}

/**
 * Plausible factory tank-capacity ranges by EPA vehicle size class.
 *
 * The AI fallback that guesses tank size accepted anything between 0 and 150
 * gallons, so a wrong-but-not-absurd answer sailed through: a 2026 Nissan
 * Pathfinder came back as 14 gal against a real ~19.5. Nothing flagged it,
 * and an undersized tank biases every gallons-needed figure DOWNWARD — the
 * direction that leaves a renter short at the pump and paying the rental
 * company's refuel rate. A too-small tank is the expensive kind of wrong.
 *
 * EPA already publishes a size class (VClass) for every vehicle in the same
 * response the tank lookup comes from. It was being discarded. These bands
 * turn it into a sanity check.
 *
 * Bands are deliberately generous — they exist to catch an answer from the
 * wrong vehicle class, not to second-guess a plausible one.
 */

export interface TankBand { min: number; max: number }

/** Matched longest-key-first, so "Standard Sport Utility" beats "Sport Utility". */
const BANDS: Array<[string, TankBand]> = [
  ['standard sport utility',   { min: 15, max: 30 }],
  ['small sport utility',      { min: 11, max: 20 }],
  ['sport utility',            { min: 11, max: 30 }],
  ['standard pickup',          { min: 17, max: 38 }],
  ['small pickup',             { min: 14, max: 24 }],
  ['pickup',                   { min: 14, max: 38 }],
  ['minivan',                  { min: 16, max: 22 }],
  ['van',                      { min: 16, max: 35 }],
  ['midsize station wagon',    { min: 11, max: 20 }],
  ['small station wagon',      { min: 10, max: 18 }],
  ['large car',                { min: 13, max: 25 }],
  ['midsize car',              { min: 11, max: 20 }],
  ['compact car',              { min: 9,  max: 17 }],
  ['subcompact car',           { min: 9,  max: 16 }],
  ['minicompact car',          { min: 9,  max: 16 }],
  ['two seater',               { min: 9,  max: 22 }],
  ['special purpose',          { min: 11, max: 36 }],
];

/** The band for an EPA VClass string, or null when the class is unrecognised. */
export function tankBandForVClass(vClass: string | null | undefined): TankBand | null {
  if (!vClass) return null;
  const v = vClass.toLowerCase();
  // Longest key first so more specific classes win.
  for (const [key, band] of [...BANDS].sort((a, b) => b[0].length - a[0].length)) {
    if (v.includes(key)) return band;
  }
  return null;
}

export type TankPlausibility = 'ok' | 'out_of_band' | 'unknown_class';

export function checkTankPlausibility(
  gallons: number | null | undefined,
  vClass: string | null | undefined,
): TankPlausibility {
  if (gallons == null) return 'unknown_class';
  const band = tankBandForVClass(vClass);
  if (!band) return 'unknown_class';
  return gallons >= band.min && gallons <= band.max ? 'ok' : 'out_of_band';
}

/**
 * Last-resort value when a guess is out of band and a retry didn't help.
 *
 * The band midpoint, not the nearest bound: a clamp lands on the edge of
 * plausibility, which for the Pathfinder case would have produced 15 against
 * a real 19.5 — still low, still biased the costly way. The midpoint is the
 * least-wrong single number for a class when the specific vehicle is unknown.
 */
export function bandMidpoint(band: TankBand): number {
  return Math.round(((band.min + band.max) / 2) * 10) / 10;
}

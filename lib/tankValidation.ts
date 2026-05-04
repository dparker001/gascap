/**
 * lib/tankValidation.ts
 * Reasonableness-check utilities for user-entered tank capacity.
 * NEVER blocks calculation — only returns advisory warnings.
 */

export interface TankWarning {
  /** Human-readable warning message */
  message: string;
  /** EPA/AI-estimated value to offer as a one-click correction */
  suggestion?: number;
}

/** ±20% tolerance band around the EPA/AI estimate */
const TOLERANCE = 0.20;

/**
 * Vehicle-class fallback ranges (gallons) used when no EPA estimate is available.
 * Keywords are matched as substrings against the NHTSA bodyClass field (lowercased).
 */
const CLASS_RANGES: Array<{ keywords: string[]; range: [number, number]; label: string }> = [
  { keywords: ['motorcycle', 'moped', 'scooter'],                  range: [2.5, 8],  label: 'motorcycle'    },
  { keywords: ['pickup', 'truck'],                                  range: [18, 40],  label: 'pickup/truck'  },
  { keywords: ['cargo van', 'passenger van'],                       range: [22, 35],  label: 'van'           },
  { keywords: ['minivan'],                                          range: [18, 26],  label: 'minivan'       },
  { keywords: ['sport utility', 'suv', 'crossover', 'multipurpos'],range: [14, 36],  label: 'SUV/crossover' },
  { keywords: ['wagon'],                                            range: [12, 20],  label: 'wagon'         },
  { keywords: ['sedan', 'saloon', 'coupe', 'convertible', 'hatch'],range: [10, 20],  label: 'car'           },
];

function getClassRange(bodyClass: string): { range: [number, number]; label: string } | null {
  const lower = bodyClass.toLowerCase();
  for (const entry of CLASS_RANGES) {
    if (entry.keywords.some((k) => lower.includes(k))) {
      return { range: entry.range, label: entry.label };
    }
  }
  return null;
}

/**
 * Validates a user-entered tank capacity against an EPA/AI estimate or vehicle-class norms.
 *
 * Priority order:
 *  1. EPA/AI estimate  — warn if entered value is >20% off
 *  2. Vehicle class    — warn if outside class-typical range
 *  3. Absolute sanity  — warn only for clearly impossible values (< 2.5 or > 120 gal)
 *
 * Returns null when the value looks fine or when there is insufficient data to validate.
 *
 * @param entered      Gallons entered by the user (undefined / NaN / ≤0 → skip check)
 * @param epaEstimate  Tank size from EPA range ÷ MPG, or Claude AI fallback
 * @param bodyClass    NHTSA body class string (e.g. "Sedan/Saloon", "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)")
 */
export function checkTankSize(
  entered: number | undefined,
  epaEstimate: number | undefined,
  bodyClass?: string,
): TankWarning | null {
  if (!entered || isNaN(entered) || entered <= 0) return null;

  // ── 1. Primary: compare against EPA/AI estimate ──────────────────────────
  if (epaEstimate && epaEstimate > 0) {
    const low  = Math.round(epaEstimate * (1 - TOLERANCE) * 10) / 10;
    const high = Math.round(epaEstimate * (1 + TOLERANCE) * 10) / 10;
    if (entered < low || entered > high) {
      const direction = entered < low ? 'lower' : 'higher';
      return {
        message: `${entered} gal is ${direction} than expected — EPA data estimates ~${epaEstimate} gal for this vehicle.`,
        suggestion: epaEstimate,
      };
    }
    return null; // within ±20% — all good
  }

  // ── 2. Fallback: vehicle-class range ─────────────────────────────────────
  if (bodyClass) {
    const classInfo = getClassRange(bodyClass);
    if (classInfo) {
      const [min, max] = classInfo.range;
      if (entered < min || entered > max) {
        return {
          message: `${entered} gal is outside the typical range for a ${classInfo.label} (${min}–${max} gal). Double-check your owner's manual.`,
        };
      }
      return null; // within class range — good
    }
  }

  // ── 3. Absolute sanity check ──────────────────────────────────────────────
  if (entered < 2.5 || entered > 120) {
    return {
      message: `${entered} gal seems unusual. Most vehicle tanks are between 10 and 40 gallons — double-check your owner's manual.`,
    };
  }

  return null;
}

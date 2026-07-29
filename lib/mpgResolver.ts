/**
 * Pure MPG-resolution logic, safe to import from CLIENT components.
 *
 * This must have zero server-only imports (no ./prisma, no ./fillups, etc.) —
 * lib/fillups.ts pulls in the Prisma client (Node's `pg` driver, which needs
 * fs/net/tls/dns), so importing it from a 'use client' component breaks the
 * webpack bundle at build time (TypeScript's `tsc --noEmit` does NOT catch this —
 * only a real Next.js build does). MpgInsightCard.tsx and TripCostEstimator.tsx
 * both hit exactly this build failure before this file was split out.
 */
import type { VehicleSpecs } from './vehicleSpecs';

export type MpgSourceLabel = 'epaCombinedEstimate' | 'avgFromFillupLog' | '';

export interface MpgResolution {
  mpg:      number | null;
  labelKey: MpgSourceLabel;
}

/**
 * Resolve the best MPG to DISPLAY AND CALCULATE WITH for a vehicle.
 *
 * EPA's combined rating (decoded from the VIN, stored on vehicleSpecs) is
 * authoritative whenever it's on file — it's available immediately (zero fill-ups
 * required) and isn't skewed by a mistyped odometer reading or a missed fill-up
 * breaking a "consecutive readings" pair. The user's own observed average (from
 * logged fill-ups) is used ONLY when no EPA data exists at all, and only when it
 * falls in a believable range — it's never allowed to override a known EPA rating.
 * Odometer entries are still valuable and still collected; they just become a
 * silent "your actual vs. EPA" comparison instead of the primary number.
 *
 * (Originally implemented locally in TripCostEstimator.tsx — centralized so every
 * MPG-consuming surface follows the same rule instead of each falling back to raw
 * computeMpg() independently.)
 */
export function resolveVehicleMpg(
  vehicleSpecs: VehicleSpecs | null | undefined,
  observedAvgMpg: number | null | undefined,
): MpgResolution {
  const epaMpg = vehicleSpecs?.combMpg;
  if (epaMpg != null) {
    return { mpg: epaMpg, labelKey: 'epaCombinedEstimate' };
  }
  if (observedAvgMpg != null && observedAvgMpg >= 5 && observedAvgMpg <= 200) {
    return { mpg: observedAvgMpg, labelKey: 'avgFromFillupLog' };
  }
  return { mpg: null, labelKey: '' };
}

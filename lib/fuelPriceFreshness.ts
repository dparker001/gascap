/**
 * Pure helpers for fuel-price freshness — safe to import from client
 * components (lib/nearbyGas.ts is server-only).
 */
import type { FuelPrice } from '@/lib/nearbyGas';

/**
 * When Google last observed any of these prices (freshest updateTime), or
 * null if Google didn't say. This — never the time GasCap fetched or saved
 * the price — is what "Updated …" labels must show.
 */
export function freshestPriceTime(prices: FuelPrice[]): string | null {
  return prices
    .map((p) => p.updatedAt)
    .filter((t): t is string => !!t)
    .sort()
    .at(-1) ?? null;
}

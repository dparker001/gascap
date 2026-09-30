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

export type FavoritePriceStatus = 'live' | 'last_known' | 'unavailable';

/**
 * How a favorite's price chip may fill the calculator:
 *   'direct'  — live price: normal one-tap apply
 *   'confirm' — last-known price: only after the user explicitly accepts
 *               "Use last-known price?", whatever its age
 *   'none'    — no price
 * An unknown/missing status is never treated as live.
 * (ChatGPT review 2026-09-30: a recent last-known price must not be applied
 * silently as though it were current.)
 */
export function favoriteApplyMode(status: FavoritePriceStatus | undefined): 'direct' | 'confirm' | 'none' {
  if (status === 'live')        return 'direct';
  if (status === 'unavailable') return 'none';
  return 'confirm';
}

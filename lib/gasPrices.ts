/**
 * Gas-price resolution for /api/gas-price.
 *
 * Fixes the "spins forever" bug by NEVER blocking a request on a live EIA call:
 *  - Instant value comes from a committed seed (data/gas-prices-seed.json) or the
 *    in-memory cache.
 *  - A background EIA refresh (fire-and-forget) updates the cache for next time.
 * On Railway (long-lived Node process) the module-level cache persists across
 * requests, so after warm-up everything is served live from memory.
 *
 * EIA's free weekly retail series only covers ~9 states directly + PADD regions +
 * national, so each state resolves: own state series → its PADD region → national.
 * Regenerate the seed periodically: scripts/generate-gas-price-seed.mjs
 */

import seedData from '@/data/gas-prices-seed.json';
import { duoareaChainForState, REGION_STATES } from './eiaAreas';
import { isStaleObservation } from './eiaFreshness';

const EIA_KEY  = process.env.EIA_API_KEY ?? '';
const TTL_MS   = 6 * 60 * 60 * 1000;   // 6h — EIA updates weekly, so this is plenty fresh
const FALLBACK = 3.15;

const seed = seedData as { updatedAt: string; national: number; states: Record<string, number> };

/** `period` is the EIA survey date of the price — its real observation date. */
const cache = new Map<string, { price: number; period: string; at: number }>();

function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function fetchEia(duoarea: string): Promise<{ price: number; period: string } | null> {
  if (!EIA_KEY) return null;
  try {
    const url =
      `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${EIA_KEY}` +
      `&frequency=weekly&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=1` +
      `&facets[duoarea][]=${duoarea}&facets[product][]=EPMR`;
    const res = await fetch(url, { signal: timeoutSignal(7000) });
    if (!res.ok) return null;
    const json = await res.json() as { response?: { data?: { value?: string | number; period?: string }[] } };
    const row = json.response?.data?.[0];
    const v = parseFloat(String(row?.value ?? ''));
    const period = String(row?.period ?? '');
    // Without a real observation date the value is not usable as "live".
    if (isNaN(v) || !/^\d{4}-\d{2}-\d{2}$/.test(period)) return null;
    return { price: Math.round(v * 1000) / 1000, period };
  } catch {
    return null;
  }
}

async function fetchStateLive(state: string): Promise<{ price: number; period: string } | null> {
  for (const duoarea of duoareaChainForState(state)) {
    const p = await fetchEia(duoarea);
    if (p) return p;
  }
  return null;
}

export interface StatePrice {
  price: number;
  /** True only when served from a fresh in-memory EIA observation. */
  live: boolean;
  /**
   * Where the number came from. 'eia_live' = an EIA observation held in
   * memory (asOf is its real survey date). 'seed' = the committed snapshot
   * file; asOf is when that FILE was generated, which is not an EIA survey
   * date and may be months old — treat `stale` accordingly.
   */
  source: 'eia_live' | 'seed';
  /** YYYY-MM-DD: EIA survey date (eia_live) or seed generation date (seed). */
  asOf: string;
  /** True when asOf is older than the freshness threshold (lib/eiaFreshness). */
  stale: boolean;
}

/**
 * Instant (non-blocking) price for a state. Returns a cached/seed value right away
 * and kicks off a background refresh. `live` = served from a fresh in-memory cache
 * hit (vs. the committed seed snapshot).
 */
export function getStatePrice(state: string): StatePrice {
  const hit = cache.get(state);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { price: hit.price, live: true, source: 'eia_live', asOf: hit.period, stale: isStaleObservation(hit.period) };
  }

  // Fire-and-forget refresh — updates the cache for subsequent requests.
  void fetchStateLive(state)
    .then((p) => { if (p) cache.set(state, { price: p.price, period: p.period, at: Date.now() }); })
    .catch(() => { /* ignore — seed already returned */ });

  const price = seed.states[state] ?? seed.national ?? FALLBACK;
  return { price, live: false, source: 'seed', asOf: seed.updatedAt, stale: isStaleObservation(seed.updatedAt) };
}

const ALL_STATES = Object.values(REGION_STATES).flat();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Warm/refresh the whole in-memory cache (for a scheduled cron). Returns # updated. */
export async function refreshAll(): Promise<number> {
  let n = 0;
  for (const st of ALL_STATES) {
    const p = await fetchStateLive(st);
    if (p) { cache.set(st, { price: p.price, period: p.period, at: Date.now() }); n++; }
    await sleep(120);
  }
  return n;
}

export const seedUpdatedAt = seed.updatedAt;

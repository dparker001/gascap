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
import { duoareaChainForState, scopeForArea, REGION_STATES, type PriceScope } from './eiaAreas';
import { isStaleObservation } from './eiaFreshness';

const EIA_KEY  = process.env.EIA_API_KEY ?? '';
const TTL_MS   = 6 * 60 * 60 * 1000;   // 6h — EIA updates weekly, so this is plenty fresh
/**
 * A result from a LESS specific area than the state's best one (e.g. national
 * because the state/region request timed out) is only a stopgap, so it is
 * cached briefly and the more specific series is retried soon. Otherwise one
 * timeout would pin a national price as the state's for the full TTL.
 */
const FALLBACK_TTL_MS = 10 * 60 * 1000;
/**
 * Per-request timeout. This runs in a fire-and-forget background refresh, so
 * waiting longer costs a user nothing; EIA latency was measured anywhere from
 * 0.5 s to >30 s (2026-10-07), and a 7 s cutoff turned routine slowness into
 * silent national-for-state fallbacks.
 */
const EIA_TIMEOUT_MS = 20_000;
const FALLBACK = 3.15;

const seed = seedData as { updatedAt: string; national: number; states: Record<string, number> };

/**
 * One resolved live EIA observation WITH its provenance. `period` is the EIA
 * survey date (its real observation date); `area`/`scope` say which EIA series
 * actually supplied the number — which may be less specific than the state it
 * was requested for.
 */
export interface LiveHit {
  price:  number;
  period: string;
  area:   string;
  scope:  PriceScope;
}

interface CacheEntry extends LiveHit {
  at:  number;
  ttl: number;
}

const cache    = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<void>>();

async function fetchEia(duoarea: string): Promise<{ price: number; period: string } | null> {
  if (!EIA_KEY) return null;
  try {
    const url =
      `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${EIA_KEY}` +
      `&frequency=weekly&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=1` +
      `&facets[duoarea][]=${duoarea}&facets[product][]=EPMR`;
    const res = await fetch(url, { signal: AbortSignal.timeout(EIA_TIMEOUT_MS) });
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

/**
 * Walk state -> region -> national and return the first EIA observation WITH
 * the area that supplied it. Never returns a price without saying where it
 * came from (exported for tests).
 */
export async function resolveStateLive(state: string): Promise<LiveHit | null> {
  for (const area of duoareaChainForState(state)) {
    const p = await fetchEia(area);
    const scope = scopeForArea(area);
    if (p && scope) return { ...p, area, scope };
  }
  return null;
}

function remember(state: string, hit: LiveHit): void {
  const best = duoareaChainForState(state)[0];
  cache.set(state, { ...hit, at: Date.now(), ttl: hit.area === best ? TTL_MS : FALLBACK_TTL_MS });
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
  /**
   * EIA area that actually supplied the price (e.g. 'SFL', 'R1Z', 'NUS') and
   * its scope. May be LESS specific than the requested state — a Florida
   * request answered from national data reports scope 'national'. Both are
   * null for the seed, whose per-state provenance was not recorded.
   */
  area: string | null;
  scope: PriceScope | null;
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
  if (hit && Date.now() - hit.at < hit.ttl) {
    return {
      price: hit.price, live: true, source: 'eia_live',
      area: hit.area, scope: hit.scope,
      asOf: hit.period, stale: isStaleObservation(hit.period),
    };
  }

  // Fire-and-forget refresh — updates the cache for subsequent requests. One
  // refresh per state at a time, so a slow EIA is not hit by every request.
  if (!inflight.has(state)) {
    const p = resolveStateLive(state)
      .then((h) => { if (h) remember(state, h); })
      .catch(() => { /* ignore — seed already returned */ })
      .finally(() => { inflight.delete(state); });
    inflight.set(state, p);
  }

  const price = seed.states[state] ?? seed.national ?? FALLBACK;
  return {
    price, live: false, source: 'seed', area: null, scope: null,
    asOf: seed.updatedAt, stale: isStaleObservation(seed.updatedAt),
  };
}

const ALL_STATES = Object.values(REGION_STATES).flat();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Warm/refresh the whole in-memory cache (for a scheduled cron). Returns # updated. */
export async function refreshAll(): Promise<number> {
  let n = 0;
  for (const st of ALL_STATES) {
    const h = await resolveStateLive(st);
    if (h) { remember(st, h); n++; }
    await sleep(120);
  }
  return n;
}

export const seedUpdatedAt = seed.updatedAt;

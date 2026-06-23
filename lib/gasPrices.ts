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

const EIA_KEY  = process.env.EIA_API_KEY ?? '';
const TTL_MS   = 6 * 60 * 60 * 1000;   // 6h — EIA updates weekly, so this is plenty fresh
const FALLBACK = 3.15;

const seed = seedData as { updatedAt: string; national: number; states: Record<string, number> };

// state → ordered EIA duoarea codes to try (mirror of the seed generator).
const REGION: Record<string, string[]> = {
  R1X: ['CT','ME','MA','NH','RI','VT'],
  R1Y: ['DE','DC','MD','NJ','NY','PA'],
  R1Z: ['FL','GA','NC','SC','VA','WV'],
  R20: ['IL','IN','IA','KS','KY','MI','MN','MO','NE','ND','OH','OK','SD','TN','WI'],
  R30: ['AL','AR','LA','MS','NM','TX'],
  R40: ['CO','ID','MT','UT','WY'],
  R50: ['AK','AZ','CA','HI','NV','OR','WA'],
};
const DIRECT = new Set(['CA','CO','FL','MA','MN','NY','OH','TX','WA']);
const STATE_DUOAREAS: Record<string, string[]> = {};
for (const [region, states] of Object.entries(REGION)) {
  for (const st of states) {
    STATE_DUOAREAS[st] = [...(DIRECT.has(st) ? [`S${st}`] : []), region, 'NUS'];
  }
}

const cache = new Map<string, { price: number; at: number }>();

function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function fetchEia(duoarea: string): Promise<number | null> {
  if (!EIA_KEY) return null;
  try {
    const url =
      `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${EIA_KEY}` +
      `&frequency=weekly&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=1` +
      `&facets[duoarea][]=${duoarea}&facets[product][]=EPMR`;
    const res = await fetch(url, { signal: timeoutSignal(7000) });
    if (!res.ok) return null;
    const json = await res.json() as { response?: { data?: { value?: string | number }[] } };
    const v = parseFloat(String(json.response?.data?.[0]?.value ?? ''));
    return isNaN(v) ? null : Math.round(v * 1000) / 1000;
  } catch {
    return null;
  }
}

async function fetchStateLive(state: string): Promise<number | null> {
  for (const duoarea of STATE_DUOAREAS[state] ?? ['NUS']) {
    const p = await fetchEia(duoarea);
    if (p) return p;
  }
  return null;
}

/**
 * Instant (non-blocking) price for a state. Returns a cached/seed value right away
 * and kicks off a background refresh. `live` = served from a fresh in-memory cache
 * hit (vs. the committed seed snapshot).
 */
export function getStatePrice(state: string): { price: number; live: boolean } {
  const hit = cache.get(state);
  if (hit && Date.now() - hit.at < TTL_MS) return { price: hit.price, live: true };

  // Fire-and-forget refresh — updates the cache for subsequent requests.
  void fetchStateLive(state)
    .then((p) => { if (p) cache.set(state, { price: p, at: Date.now() }); })
    .catch(() => { /* ignore — seed already returned */ });

  const price = seed.states[state] ?? seed.national ?? FALLBACK;
  return { price, live: false };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Warm/refresh the whole in-memory cache (for a scheduled cron). Returns # updated. */
export async function refreshAll(): Promise<number> {
  let n = 0;
  for (const st of Object.keys(STATE_DUOAREAS)) {
    const p = await fetchStateLive(st);
    if (p) { cache.set(st, { price: p, at: Date.now() }); n++; }
    await sleep(120);
  }
  return n;
}

export const seedUpdatedAt = seed.updatedAt;

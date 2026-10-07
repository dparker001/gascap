/**
 * Follow-up to PR #65 — price PROVENANCE.
 *
 * Production (2026-10-07): a Florida request returned $4.354 labelled
 * `eia_live`. $4.354 is the NATIONAL Regular price; Florida's own EIA series
 * (SFL) was $3.97. fetchStateLive() walked state -> region -> national but
 * returned only {price, period}, so when the finer requests timed out the
 * national value was cached under the Florida key and reported as the
 * state's live price for 6 hours.
 *
 * Fixtures mirror the real EIA observations of 2026-10-05:
 *   SFL 3.97 (Florida)   R1Z 3.959 (East Coast Central Atlantic/Lower Atlantic region)
 *   NUS 4.354 (national)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scopeForArea } from '@/lib/eiaAreas';

type Series = Record<string, { value: string; period?: string } | 'fail' | 'http500'>;
const PERIOD = '2026-10-05';
const REAL: Series = { SFL: { value: '3.97' }, R1Z: { value: '3.959' }, NUS: { value: '4.354' }, SCA: { value: '6.227' }, R50: { value: '5.9' } };

function stubEia(series: Series) {
  const f = vi.fn(async (url: string) => {
    const area = new URL(url).searchParams.get('facets[duoarea][]')!;
    const s = series[area];
    if (!s || s === 'fail') throw new DOMException('The operation was aborted', 'TimeoutError');
    if (s === 'http500') return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ response: { data: [{ period: s.period ?? PERIOD, value: s.value }] } }) };
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const areasCalled = (f: ReturnType<typeof stubEia>) =>
  f.mock.calls.map((c) => new URL((c as unknown as [string])[0]).searchParams.get('facets[duoarea][]'));

async function load() {
  process.env.EIA_API_KEY = 'test-key-not-real';
  vi.resetModules();
  return import('@/lib/gasPrices');
}
/** Request once (kicks the background refresh), wait for it to land, return the served value. */
async function warm(mod: Awaited<ReturnType<typeof load>>, state: string) {
  mod.getStatePrice(state);
  await vi.waitFor(() => expect(mod.getStatePrice(state).live).toBe(true));
  return mod.getStatePrice(state);
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-07T18:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('scopeForArea', () => {
  it('classifies EIA areas', () => {
    expect(scopeForArea('SFL')).toBe('state');
    expect(scopeForArea('SCA')).toBe('state');
    expect(scopeForArea('R1Z')).toBe('region');
    expect(scopeForArea('R50')).toBe('region');
    expect(scopeForArea('NUS')).toBe('national');
  });
  it('null for anything unrecognised — never guessed', () => {
    for (const a of ['SGA', 'XYZ', '', null, undefined, 'Y05LA']) expect(scopeForArea(a as string | null | undefined)).toBeNull();
  });
});

describe('getStatePrice — provenance through the live lookup', () => {
  it('1. Florida direct success: Florida price + state provenance', async () => {
    stubEia(REAL);
    const r = await warm(await load(), 'FL');
    expect(r).toMatchObject({ price: 3.97, area: 'SFL', scope: 'state', source: 'eia_live', asOf: PERIOD, live: true });
  });

  it('2. Florida request fails, region succeeds: REGIONAL price + regional provenance', async () => {
    const f = stubEia({ ...REAL, SFL: 'fail' });
    const r = await warm(await load(), 'FL');
    expect(r).toMatchObject({ price: 3.959, area: 'R1Z', scope: 'region' });
    expect(areasCalled(f)).toEqual(['SFL', 'R1Z']);        // walked in order, stopped at the first success
  });

  it('3. state and region fail, national succeeds: NATIONAL price + national provenance', async () => {
    stubEia({ ...REAL, SFL: 'fail', R1Z: 'http500' });
    const r = await warm(await load(), 'FL');
    expect(r).toMatchObject({ price: 4.354, area: 'NUS', scope: 'national' });
  });

  it('4. REGRESSION: a national fallback never masquerades as Florida-specific', async () => {
    stubEia({ ...REAL, SFL: 'fail', R1Z: 'fail' });
    const r = await warm(await load(), 'FL');
    expect(r.price).toBe(4.354);                 // the exact production symptom...
    expect(r.scope).not.toBe('state');           // ...is now disclosed as national,
    expect(r.area).not.toBe('SFL');              // ...from the national series.
    expect(r.scope).toBe('national');
  });

  it('5. cache preserves provenance (and does not refetch)', async () => {
    const f = stubEia({ ...REAL, SFL: 'fail' });
    const mod = await load();
    const first = await warm(mod, 'FL');
    const calls = f.mock.calls.length;
    const second = mod.getStatePrice('FL');
    expect(second).toMatchObject({ price: first.price, area: 'R1Z', scope: 'region', live: true });
    expect(f.mock.calls.length).toBe(calls);
  });

  it('6a. a cached fallback keeps its scope when served later — it is never upgraded to "state"', async () => {
    stubEia({ ...REAL, SFL: 'fail', R1Z: 'fail' });
    const mod = await load();
    await warm(mod, 'FL');
    vi.setSystemTime(new Date('2026-10-07T18:05:00Z'));      // +5 min, still inside the fallback TTL
    expect(mod.getStatePrice('FL')).toMatchObject({ area: 'NUS', scope: 'national', live: true });
  });

  it('6b. a fallback is only a stopgap: after its short TTL the specific series is retried and wins', async () => {
    const series: Series = { ...REAL, SFL: 'fail', R1Z: 'fail' };
    const f = stubEia(series);
    const mod = await load();
    await warm(mod, 'FL');
    expect(mod.getStatePrice('FL').scope).toBe('national');

    series.SFL = { value: '3.97' };                           // EIA recovers
    vi.setSystemTime(new Date('2026-10-07T18:11:00Z'));      // +11 min > 10 min fallback TTL
    mod.getStatePrice('FL');                                  // expired -> triggers a retry
    await vi.waitFor(() => expect(mod.getStatePrice('FL')).toMatchObject({ price: 3.97, area: 'SFL', scope: 'state' }));
    expect(areasCalled(f).filter((a) => a === 'SFL').length).toBeGreaterThanOrEqual(2);
  });

  it('6c. a state-specific result keeps the long TTL (not re-fetched for hours)', async () => {
    const f = stubEia(REAL);
    const mod = await load();
    await warm(mod, 'FL');
    const calls = f.mock.calls.length;
    vi.setSystemTime(new Date('2026-10-07T23:00:00Z'));      // +5 h, inside the 6 h TTL
    expect(mod.getStatePrice('FL')).toMatchObject({ area: 'SFL', scope: 'state', live: true });
    expect(f.mock.calls.length).toBe(calls);
  });

  it('a state with no series of its own: its REGION is the best available (long TTL, not a "fallback")', async () => {
    const f = stubEia(REAL);
    const mod = await load();
    const r = await warm(mod, 'GA');
    expect(r).toMatchObject({ price: 3.959, area: 'R1Z', scope: 'region' });
    const calls = f.mock.calls.length;
    vi.setSystemTime(new Date('2026-10-07T23:00:00Z'));
    mod.getStatePrice('GA');
    expect(f.mock.calls.length).toBe(calls);                  // long TTL because R1Z IS the best series for GA
  });

  it('California direct stays state-specific (real-world control: it was already correct in production)', async () => {
    stubEia(REAL);
    expect(await warm(await load(), 'CA')).toMatchObject({ price: 6.227, area: 'SCA', scope: 'state' });
  });

  it('unknown state ("US") resolves to national', async () => {
    stubEia(REAL);
    expect(await warm(await load(), 'US')).toMatchObject({ area: 'NUS', scope: 'national' });
  });

  it('7. seed fallback is labelled as seed, with no invented provenance', async () => {
    stubEia({});                                              // EIA entirely down
    const mod = await load();
    const r = mod.getStatePrice('FL');
    expect(r).toMatchObject({ source: 'seed', live: false, area: null, scope: null, asOf: '2026-06-23', stale: true });
  });

  it('EIA entirely down: stays on the labelled seed (never an unlabelled or invented live value)', async () => {
    stubEia({});
    const mod = await load();
    mod.getStatePrice('FL');
    await new Promise((r) => setTimeout(r, 30));
    expect(mod.getStatePrice('FL').source).toBe('seed');
  });

  it('only one background refresh per state is in flight (a slow EIA is not hammered by every request)', async () => {
    const f = stubEia(REAL);
    const mod = await load();
    mod.getStatePrice('FL'); mod.getStatePrice('FL'); mod.getStatePrice('FL');
    await vi.waitFor(() => expect(mod.getStatePrice('FL').live).toBe(true));
    expect(areasCalled(f).filter((a) => a === 'SFL')).toHaveLength(1);
  });
});

describe('GET /api/gas-price — truthful labelling', () => {
  const latestSnapshotForChain = vi.fn();
  const getStatePrice = vi.fn();
  const base = { price: 0, live: true, source: 'eia_live', asOf: PERIOD, stale: false };

  async function call(state = 'FL') {
    process.env.EIA_API_KEY = 'test-key-not-real';
    vi.resetModules();
    vi.doMock('@/lib/gasPrices', () => ({ getStatePrice }));
    vi.doMock('@/lib/fuelPriceSnapshots', () => ({ latestSnapshotForChain }));
    vi.doMock('@/lib/usStateFromCoords', () => ({ usStateFromCoords: () => state }));
    const { GET } = await import('@/app/api/gas-price/route');
    return (await GET(new Request('https://x.test/api/gas-price?lat=28.5&lng=-81.4'))).json();
  }
  beforeEach(() => { getStatePrice.mockReset(); latestSnapshotForChain.mockReset(); });

  it('state-specific live price: priceScope state, isState true, not a fallback', async () => {
    getStatePrice.mockReturnValue({ ...base, price: 3.97, area: 'SFL', scope: 'state' });
    const b = await call();
    expect(b).toMatchObject({ price: 3.97, priceArea: 'SFL', priceScope: 'state', priceFallback: false, isState: true, isNational: false, priceSource: 'eia_live' });
  });

  it('REGRESSION: Florida answered with the national price is reported as national, a fallback, and NOT as Florida', async () => {
    getStatePrice.mockReturnValue({ ...base, price: 4.354, area: 'NUS', scope: 'national' });
    const b = await call();
    expect(b).toMatchObject({ state: 'FL', price: 4.354, priceArea: 'NUS', priceScope: 'national', priceFallback: true, isState: false, isNational: true });
  });

  it('regional fallback: priceScope region, fallback true, neither isState nor isNational', async () => {
    getStatePrice.mockReturnValue({ ...base, price: 3.959, area: 'R1Z', scope: 'region' });
    const b = await call();
    expect(b).toMatchObject({ priceArea: 'R1Z', priceScope: 'region', priceFallback: true, isState: false, isNational: false });
  });

  it('a state with no own series: region is its best series, so not flagged as a fallback', async () => {
    getStatePrice.mockReturnValue({ ...base, price: 3.725, area: 'R1Z', scope: 'region' });
    const b = await call('GA');
    expect(b).toMatchObject({ priceScope: 'region', priceFallback: false });
  });

  it('8. stored-snapshot fallback preserves the ACTUAL area (regional snapshot is not called state)', async () => {
    getStatePrice.mockReturnValue({ price: 3.739, live: false, source: 'seed', area: null, scope: null, asOf: '2026-06-23', stale: true });
    latestSnapshotForChain.mockResolvedValue({ price: 3.959, area: 'R1Z', observedOn: PERIOD });
    const b = await call();
    expect(b).toMatchObject({ priceSource: 'eia_snapshot', price: 3.959, priceArea: 'R1Z', priceScope: 'region', priceFallback: true, isState: false, asOf: PERIOD });
  });

  it('8b. a state-level snapshot is reported as state-specific', async () => {
    getStatePrice.mockReturnValue({ price: 3.739, live: false, source: 'seed', area: null, scope: null, asOf: '2026-06-23', stale: true });
    latestSnapshotForChain.mockResolvedValue({ price: 3.97, area: 'SFL', observedOn: PERIOD });
    expect(await call()).toMatchObject({ priceScope: 'state', priceArea: 'SFL', priceFallback: false, isState: true });
  });

  it('7b. seed: no provenance claimed; flags keep their old request-based meaning', async () => {
    getStatePrice.mockReturnValue({ price: 3.739, live: false, source: 'seed', area: null, scope: null, asOf: '2026-06-23', stale: true });
    latestSnapshotForChain.mockResolvedValue(null);
    const b = await call();
    expect(b).toMatchObject({ priceSource: 'seed', priceArea: null, priceScope: null, priceFallback: null, isState: true, isNational: false, stale: true });
  });

  it('9. backward compatibility: every field existing consumers read is still present', async () => {
    getStatePrice.mockReturnValue({ ...base, price: 3.97, area: 'SFL', scope: 'state' });
    const b = await call();
    for (const k of ['price', 'state', 'isState', 'isNational', 'source', 'live', 'locMethod', 'priceSource', 'asOf', 'stale']) {
      expect(b).toHaveProperty(k);
    }
    expect(b.source).toBe('eia');
  });
});

describe('UI consumer (GasPriceLookup)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'components/GasPriceLookup.tsx'), 'utf8') as string;
  it('labels by the scope the price actually came from, falling back to the old logic when absent', () => {
    expect(src).toMatch(/priceScope === 'region' \? t\.gasPrice\.regionalAvg/);
    expect(src).toMatch(/result\.isState \? t\.gasPrice\.stateAvg\(stateName\) : t\.gasPrice\.nationalAvg/);
  });
  it('the remembered/auto-applied note does not call a fallback "<State> avg"', () => {
    expect(src).toMatch(/scope === 'national' \? 'National'/);
    expect(src).toMatch(/scope === 'region'\s+\? 'Regional'/);
  });
});

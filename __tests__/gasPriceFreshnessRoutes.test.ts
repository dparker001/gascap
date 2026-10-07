/**
 * Phase 0.5B — stale-seed ambiguity + observation-vs-retrieval time on the
 * public price routes (/api/gas-price, /api/gas-price/national) and the
 * in-memory state-price resolver (lib/gasPrices.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const NOW = new Date('2026-10-07T18:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  process.env.EIA_API_KEY = 'test-key-not-real';
  vi.resetModules();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('lib/gasPrices getStatePrice', () => {
  it('cold process: serves the seed but LABELS it as seed with its generation date, and stale', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // background refresh never resolves
    const { getStatePrice } = await import('@/lib/gasPrices');
    const r = getStatePrice('FL');
    expect(r.live).toBe(false);
    expect(r.source).toBe('seed');
    expect(r.asOf).toBe('2026-06-23');      // when the FILE was generated, not an EIA survey date
    expect(r.stale).toBe(true);             // 3.5 months old
  });

  it('after a live EIA read: live, labelled with the real EIA survey date, not retrieval time', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, json: async () => ({ response: { data: [{ period: '2026-10-05', value: '3.97' }] } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { getStatePrice } = await import('@/lib/gasPrices');
    getStatePrice('FL');                              // triggers background refresh
    await vi.waitFor(() => expect(getStatePrice('FL').live).toBe(true));
    const r = getStatePrice('FL');
    expect(r).toMatchObject({ price: 3.97, live: true, source: 'eia_live', asOf: '2026-10-05', stale: false });
    expect(r.asOf).not.toBe(NOW.toISOString().slice(0, 10)); // not "today"
  });

  it('an EIA row with no real observation date is NOT accepted as live', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ response: { data: [{ value: '3.97' }] } }) })));
    const { getStatePrice } = await import('@/lib/gasPrices');
    getStatePrice('FL');
    await new Promise((r) => setTimeout(r, 20));
    expect(getStatePrice('FL').source).toBe('seed');
  });
});

describe('GET /api/gas-price', () => {
  const seedResult = { price: 3.739, live: false, source: 'seed', asOf: '2026-06-23', stale: true };
  const latestSnapshotForChain = vi.fn();
  const getStatePrice = vi.fn();

  async function call() {
    vi.doMock('@/lib/gasPrices', () => ({ getStatePrice }));
    vi.doMock('@/lib/fuelPriceSnapshots', () => ({ latestSnapshotForChain }));
    const { GET } = await import('@/app/api/gas-price/route');
    return (await GET(new Request('https://x.test/api/gas-price?lat=28.5&lng=-81.4'))).json();
  }
  beforeEach(() => { getStatePrice.mockReset(); latestSnapshotForChain.mockReset(); getStatePrice.mockReturnValue(seedResult); });

  it('cold process + fresh stored EIA observation: prefers it over the months-old seed', async () => {
    latestSnapshotForChain.mockResolvedValue({ price: 3.97, area: 'SFL', observedOn: '2026-10-05' });
    const body = await call();
    expect(body).toMatchObject({ price: 3.97, priceSource: 'eia_snapshot', asOf: '2026-10-05', stale: false, live: false, source: 'eia' });
  });

  it('cold process + only a STALE stored observation: keeps the seed and says so', async () => {
    latestSnapshotForChain.mockResolvedValue({ price: 3.5, area: 'SFL', observedOn: '2026-08-01' });
    const body = await call();
    expect(body).toMatchObject({ price: 3.739, priceSource: 'seed', asOf: '2026-06-23', stale: true });
  });

  it('snapshot table unavailable: falls back to the seed unchanged (no 500)', async () => {
    latestSnapshotForChain.mockRejectedValue(new Error('relation "FuelPriceSnapshot" does not exist'));
    const body = await call();
    expect(body).toMatchObject({ price: 3.739, priceSource: 'seed', stale: true });
  });

  it('warm process (fresh live value): never touches the database', async () => {
    getStatePrice.mockReturnValue({ price: 3.97, live: true, source: 'eia_live', asOf: '2026-10-05', stale: false });
    const body = await call();
    expect(latestSnapshotForChain).not.toHaveBeenCalled();
    expect(body).toMatchObject({ priceSource: 'eia_live', asOf: '2026-10-05', live: true });
  });

  it('keeps every field existing clients read', async () => {
    latestSnapshotForChain.mockResolvedValue(null);
    const body = await call();
    for (const k of ['price', 'state', 'isState', 'isNational', 'source', 'live', 'locMethod']) expect(body).toHaveProperty(k);
  });
});

describe('GET /api/gas-price/national', () => {
  const eia = (product: string, period = '2026-10-05', value = '4.354') =>
    vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get('facets[product][]')).toBe(product);
      return { ok: true, json: async () => ({ response: { data: [{ period, value }] } }) };
    });
  const call = async (qs = '') => {
    const { GET } = await import('@/app/api/gas-price/national/route');
    return GET(new Request(`https://x.test/api/gas-price/national${qs}`));
  };

  it('REGRESSION: reports the EIA survey date as the price date — not the retrieval time', async () => {
    vi.stubGlobal('fetch', eia('EPMR'));
    const body = await (await call()).json();
    expect(body.period).toBe('2026-10-05');
    expect(body.updatedAt).toBe('2026-10-05');                    // deprecated alias now = observation date
    expect(body.fetchedAt).toBe(NOW.toISOString());              // retrieval time is separate and labelled
    expect(body.updatedAt).not.toBe(body.fetchedAt);
  });

  it('is grade-specific using the verified EIA products', async () => {
    for (const [grade, product] of [['regular', 'EPMR'], ['midgrade', 'EPMM'], ['premium', 'EPMP'], ['diesel', 'EPD2D']]) {
      vi.resetModules();
      vi.stubGlobal('fetch', eia(product));
      const body = await (await call(`?grade=${grade}`)).json();
      expect(body.grade).toBe(grade);
    }
  });

  it('rejects unsupported grades instead of silently returning the regular price', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    for (const g of ['e85', 'bogus', '']) {
      const res = await call(`?grade=${g}`);
      expect(res.status).toBe(400);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('flags a stale EIA observation', async () => {
    vi.stubGlobal('fetch', eia('EPMR', '2026-08-03'));
    expect((await (await call()).json()).stale).toBe(true);
  });

  it('drops a row without a real observation date rather than inventing one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ response: { data: [{ value: '4.354' }] } }) })));
    expect((await (await call()).json()).price).toBeNull();
  });
});

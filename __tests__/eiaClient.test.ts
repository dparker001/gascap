/**
 * Phase 0.5B — EIA client. Fixtures are REAL EIA v2 rows captured from
 * api.eia.gov/v2/petroleum/pri/gnd/data on 2026-10-07 (provider-contract
 * rule): `value` arrives as a STRING, rows carry extra descriptive fields,
 * and Florida (SFL) publishes no diesel series. Negative paths cover rows
 * that must never become stored prices.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildEiaUrl, fetchEiaObservations, parseEiaRows, MAX_PLAUSIBLE_PRICE } from '@/lib/eiaClient';

const REAL_RESPONSE = {
  response: {
    total: '4805',
    dateFormat: 'YYYY-MM-DD',
    frequency: 'weekly',
    data: [
      { period: '2026-10-05', duoarea: 'NUS', 'area-name': 'U.S.', product: 'EPD2D', 'product-name': 'No 2 Diesel', process: 'PTE', 'process-name': 'Retail Sales', series: 'EMD_EPD2D_PTE_NUS_DPG', 'series-description': 'U.S. No 2 Diesel Retail Prices (Dollars per Gallon)', value: '6.199', units: '$/GAL' },
      { period: '2026-10-05', duoarea: 'SFL', 'area-name': 'FLORIDA', product: 'EPMR', 'product-name': 'Regular Gasoline', process: 'PTE', 'process-name': 'Retail Sales', series: 'EMM_EPMR_PTE_SFL_DPG', 'series-description': 'Florida Regular All Formulations Retail Gasoline Prices (Dollars per Gallon)', value: '3.97', units: '$/GAL' },
      { period: '2026-10-05', duoarea: 'NUS', 'area-name': 'U.S.', product: 'EPMR', 'product-name': 'Regular Gasoline', process: 'PTE', 'process-name': 'Retail Sales', series: 'EMM_EPMR_PTE_NUS_DPG', 'series-description': 'U.S. Regular All Formulations Retail Gasoline Prices (Dollars per Gallon)', value: '4.354', units: '$/GAL' },
    ],
  },
};

describe('parseEiaRows — positive: real EIA response shape', () => {
  it('parses string values into numbers with the real survey date', () => {
    const rows = parseEiaRows(REAL_RESPONSE);
    expect(rows).toEqual([
      { duoarea: 'NUS', product: 'EPD2D', grade: 'diesel',  period: '2026-10-05', price: 6.199 },
      { duoarea: 'SFL', product: 'EPMR',  grade: 'regular', period: '2026-10-05', price: 3.97 },
      { duoarea: 'NUS', product: 'EPMR',  grade: 'regular', period: '2026-10-05', price: 4.354 },
    ]);
  });
});

describe('parseEiaRows — negative / malformed', () => {
  const base = REAL_RESPONSE.response.data[2];
  const parse = (over: Record<string, unknown>) => parseEiaRows({ response: { data: [{ ...base, ...over }] } });

  it('drops null / empty / non-numeric values', () => {
    expect(parse({ value: null })).toEqual([]);
    expect(parse({ value: '' })).toEqual([]);
    expect(parse({ value: 'n/a' })).toEqual([]);
  });
  it('drops implausible prices (data errors), keeps the bounds themselves', () => {
    expect(parse({ value: '0.01' })).toEqual([]);
    expect(parse({ value: String(MAX_PLAUSIBLE_PRICE + 1) })).toEqual([]);
    expect(parse({ value: '0.5' })).toHaveLength(1);
  });
  it('drops rows without a real YYYY-MM-DD observation date (never substitutes today)', () => {
    expect(parse({ period: '2026-10' })).toEqual([]);
    expect(parse({ period: '' })).toEqual([]);
    expect(parse({ period: undefined })).toEqual([]);
  });
  it('drops products we do not map — including Total Gasoline EPM0', () => {
    expect(parse({ product: 'EPM0' })).toEqual([]);
    expect(parse({ product: 'EPMRR' })).toEqual([]);
  });
  it('tolerates garbage envelopes', () => {
    for (const j of [null, undefined, {}, { response: {} }, { response: { data: 'x' } }, []]) {
      expect(parseEiaRows(j)).toEqual([]);
    }
  });
});

describe('buildEiaUrl', () => {
  it('asks for weekly data, the verified product code, and every area', () => {
    const u = new URL(buildEiaUrl({ apiKey: 'k', areas: ['NUS', 'SFL'], grades: ['regular'], length: 6 }));
    expect(u.searchParams.get('frequency')).toBe('weekly');
    expect(u.searchParams.getAll('facets[product][]')).toEqual(['EPMR']);
    expect(u.searchParams.getAll('facets[duoarea][]')).toEqual(['NUS', 'SFL']);
    expect(u.searchParams.get('length')).toBe('6');
    expect(u.searchParams.get('sort[0][direction]')).toBe('desc');
  });
});

describe('fetchEiaObservations', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

  it('makes one request per grade and merges parsed rows', async () => {
    const fetchImpl = vi.fn(async () => ok(REAL_RESPONSE));
    const rows = await fetchEiaObservations({
      areas: ['NUS', 'SFL'], grades: ['regular', 'diesel'], weeks: 3, apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(rows.length).toBe(6); // 3 valid rows x 2 responses
  });

  it('caps request length at EIA\'s 5,000-row page', async () => {
    const fetchImpl = vi.fn(async () => ok({ response: { data: [] } }));
    await fetchEiaObservations({ areas: Array(17).fill('NUS'), grades: ['regular'], weeks: 999, apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    const u = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(Number(u.searchParams.get('length'))).toBeLessThanOrEqual(5000);
  });

  it('throws on a non-OK response so a cron run fails visibly', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response);
    await expect(
      fetchEiaObservations({ areas: ['NUS'], grades: ['regular'], weeks: 1, apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/503/);
  });

  it('throws when no API key is configured (and does not call out)', async () => {
    const prev = process.env.EIA_API_KEY;
    delete process.env.EIA_API_KEY;
    const fetchImpl = vi.fn();
    await expect(
      fetchEiaObservations({ areas: ['NUS'], grades: ['regular'], weeks: 1, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/EIA_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
    if (prev !== undefined) process.env.EIA_API_KEY = prev;
  });

  it('requests all grades IN PARALLEL (EIA takes ~7–10 s per request; sequential would blow the 30 s cron budget)', async () => {
    let inFlight = 0, maxInFlight = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      const product = new URL(url).searchParams.get('facets[product][]')!;
      return ok({ response: { data: [{ period: '2026-10-05', duoarea: 'NUS', product, value: '4.1' }] } });
    });
    const rows = await fetchEiaObservations({
      areas: ['NUS'], grades: ['regular', 'midgrade', 'premium', 'diesel'], weeks: 1, apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(maxInFlight).toBe(4);
    // deterministic output order = requested grade order, regardless of completion order
    expect(rows.map((r) => r.grade)).toEqual(['regular', 'midgrade', 'premium', 'diesel']);
  });

  it('one failing grade fails the whole fetch (cron goes red rather than storing a partial set silently)', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      new URL(url).searchParams.get('facets[product][]') === 'EPMP'
        ? ({ ok: false, status: 500, json: async () => ({}) }) as Response
        : ok({ response: { data: [] } }));
    await expect(
      fetchEiaObservations({ areas: ['NUS'], grades: ['regular', 'premium'], weeks: 1, apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/premium/);
  });
});

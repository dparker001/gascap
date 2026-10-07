/**
 * Phase 0.5B (2026-10-07) — regression coverage for the fuel-price data
 * foundation fixes. Each assertion below describes OLD behavior that was
 * wrong and must not return:
 *
 *   1. SavingsDashboard compared every historical fill-up against TODAY's
 *      national price (not time-matched), mixed fuel grades, and fell back
 *      to a hardcoded $3.45 presented as if it were a real baseline.
 *   2. /api/gas-price/history queried EIA product EPM0 under a "Regular"
 *      label. EPM0 is "Total Gasoline" (all grades blended); Regular is
 *      EPMR. Verified live against api.eia.gov on 2026-10-07 — the two
 *      differed by ~14 cents/gal that day.
 *   3. /api/gas-price/national stamped `updatedAt: new Date()` — the cache
 *      retrieval time — as if it were the price's observation time.
 *   4. /api/gas-price gave no hint when it was serving the (months-old)
 *      committed seed instead of a real EIA observation.
 *
 * Source-text assertions follow the repo's existing convention
 * (cr2SavingsClaimIntegrity.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

describe('SavingsDashboard methodology (Phase 0.5B)', () => {
  const src = read('components/SavingsDashboard.tsx');

  it('has no hardcoded fallback price standing in for a baseline', () => {
    expect(src).not.toMatch(/FALLBACK_PRICE/);
    expect(src).not.toMatch(/3\.45/);
  });

  it("no longer compares history against today's national price", () => {
    expect(src).not.toMatch(/\/api\/gas-price\/national/);
    expect(src).not.toMatch(/nationalAvg/);
  });

  it('reads its savings figure from the server-computed, time-matched endpoint', () => {
    expect(src).toMatch(/\/api\/fillups\/savings/);
  });
});

describe('Other surfaces that compared history to today\'s price (Phase 0.5B)', () => {
  it('FillupHistory badges come from the per-fill-up server comparison, not today\'s national price', () => {
    const src = read('components/FillupHistory.tsx');
    expect(src).not.toMatch(/\/api\/gas-price\/national/);
    expect(src).not.toMatch(/nationalAvg/);
    expect(src).toMatch(/\/api\/fillups\/savings/);
  });

  it('FillupLogger price card is grade-matched and never compares an unknown grade', () => {
    const src = read('components/FillupLogger.tsx');
    expect(src).toMatch(/\/api\/gas-price\/national\?grade=/);
    expect(src).not.toMatch(/fetch\('\/api\/gas-price\/national'\)/);
  });
});

describe('copy describes the real methodology (Phase 0.5B)', () => {
  it('help page no longer promises a comparison to the "live" national average', () => {
    const help = read('app/help/page.tsx');
    expect(help).not.toMatch(/estimated savings vs\. the live EIA national average/);
    expect(help).toMatch(/same fuel grade/);
  });
  it('AI chat feature block matches the dashboard methodology', () => {
    const chat = read('app/api/ai/chat/route.ts');
    expect(chat).not.toMatch(/savings dashboard vs EIA national average/);
    expect(chat).toMatch(/SAME fuel grade/);
  });
});

describe('EIA product codes (Phase 0.5B)', () => {
  it('history route queries Regular (EPMR), not Total Gasoline (EPM0)', () => {
    const src = read('app/api/gas-price/history/route.ts');
    // The facet actually sent to EIA (comments may still mention EPM0).
    expect(src).not.toMatch(/facets\[product\]\[\]',\s*'EPM0'/);
    expect(src).toMatch(/facets\[product\]\[\]',\s*'EPMR'/);
  });
});

describe('EIA observation vs retrieval time (Phase 0.5B)', () => {
  it('national route exposes the real EIA observation period', () => {
    const src = read('app/api/gas-price/national/route.ts');
    expect(src).toMatch(/period/);
    // Retrieval time may be reported, but never under the observation name.
    expect(src).not.toMatch(/updatedAt:\s*new Date\(\)/);
  });

  it('state price route labels where the number came from and how old it is', () => {
    const src = read('app/api/gas-price/route.ts');
    expect(src).toMatch(/asOf/);
    expect(src).toMatch(/stale/);
  });
});

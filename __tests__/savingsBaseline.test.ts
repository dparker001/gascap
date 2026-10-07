/**
 * Phase 0.5B — defensible savings baseline rules (lib/savingsBaseline.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_BASELINE_AGE_DAYS,
  computeFillupSavings,
  findBaselineForDate,
  pickBaselineForNewFillup,
  summarizeSavings,
  type NationalSnapshots,
  type SavingsFillup,
} from '@/lib/savingsBaseline';

const fill = (over: Partial<SavingsFillup> = {}): SavingsFillup => ({
  id: 'f1', date: '2026-03-12', gallonsPumped: 10, pricePerGallon: 3.5, totalCost: 35,
  fuelGrade: 'regular', ...over,
});

// A national regular series: March price is LOW, "today" (October) is HIGH.
const national: NationalSnapshots = {
  regular: [
    { observedOn: '2026-03-09', price: 3.8 },
    { observedOn: '2026-03-16', price: 3.9 },
    { observedOn: '2026-10-05', price: 4.354 },
  ],
};

describe('findBaselineForDate — time matching', () => {
  const pts = [
    { observedOn: '2026-03-16', price: 3.9 },
    { observedOn: '2026-03-02', price: 3.7 },
    { observedOn: '2026-03-09', price: 3.8 },
  ]; // deliberately unsorted

  it('uses the most recent observation on/before the fill date', () => {
    expect(findBaselineForDate(pts, '2026-03-12')?.price).toBe(3.8);
    expect(findBaselineForDate(pts, '2026-03-16')?.price).toBe(3.9); // same day counts
  });
  it('never uses an observation from AFTER the fill date', () => {
    expect(findBaselineForDate(pts, '2026-03-15')?.observedOn).toBe('2026-03-09');
    expect(findBaselineForDate(pts, '2026-03-01')).toBeNull();
  });
  it(`rejects an observation older than ${MAX_BASELINE_AGE_DAYS} days`, () => {
    expect(findBaselineForDate(pts, '2026-03-29')).not.toBeNull(); // 13 days after 03-16
    expect(findBaselineForDate(pts, '2026-03-30')).toBeNull();     // 14 days
  });
  it('returns null for empty history or a bad date', () => {
    expect(findBaselineForDate([], '2026-03-12')).toBeNull();
    expect(findBaselineForDate(pts, 'garbage')).toBeNull();
  });
});

describe('computeFillupSavings — regression: the old dashboard\'s three sins', () => {
  it('compares against the price of THE FILL-UP\'S week, not today\'s price', () => {
    const r = computeFillupSavings(fill(), national);
    expect(r.status).toBe('compared');
    expect(r.baselinePrice).toBe(3.8);          // 2026-03-09, not 4.354
    expect(r.baselinePeriod).toBe('2026-03-09');
    expect(r.savings).toBe(3);                  // 3.8*10 - 35
    // The old math would have produced (4.354-3.5)*10 = 8.54 of "savings".
    expect(r.savings).not.toBeCloseTo(8.54, 1);
  });

  it('never mixes fuel grades: a premium fill-up is not compared with the regular series', () => {
    const r = computeFillupSavings(fill({ fuelGrade: 'premium', totalCost: 45, pricePerGallon: 4.5 }), national);
    expect(r.status).toBe('no_baseline');
    expect(r.savings).toBeUndefined();
  });

  it('a missing grade is NOT assumed regular', () => {
    expect(computeFillupSavings(fill({ fuelGrade: null }), national).status).toBe('no_grade');
    expect(computeFillupSavings(fill({ fuelGrade: undefined }), national).status).toBe('no_grade');
    expect(computeFillupSavings(fill({ fuelGrade: '' }), national).status).toBe('no_grade');
  });

  it('e85 (no EIA series) is excluded as unsupported', () => {
    expect(computeFillupSavings(fill({ fuelGrade: 'e85' }), national).status).toBe('unsupported_grade');
  });

  it('with no history there is NO savings number — no fallback constant', () => {
    const r = computeFillupSavings(fill(), {});
    expect(r.status).toBe('no_baseline');
    expect(r.savings).toBeUndefined();
    expect(r.baselinePrice).toBeUndefined();
  });

  it('a fill-up older than all stored history is excluded, not extrapolated', () => {
    expect(computeFillupSavings(fill({ date: '2025-01-10' }), national).status).toBe('no_baseline');
  });
});

describe('computeFillupSavings — sign, stored baseline, sanity', () => {
  it('paying MORE than the average is reported as negative, not hidden or zeroed', () => {
    const r = computeFillupSavings(fill({ totalCost: 42, pricePerGallon: 4.2 }), national);
    expect(r.status).toBe('compared');
    expect(r.savings).toBe(-4);
  });

  it('prefers a baseline frozen at log time, and labels its origin', () => {
    const r = computeFillupSavings(
      fill({ baselinePrice: 3.7, baselineSource: 'eia_weekly', baselineArea: 'R1Z', baselinePeriod: '2026-03-09' }),
      {},
    );
    expect(r.status).toBe('compared');
    expect(r.origin).toBe('stored');
    expect(r.baselineArea).toBe('R1Z');
    expect(r.savings).toBe(2);
  });

  it('ignores a stored baseline from an unknown source', () => {
    const r = computeFillupSavings(
      fill({ baselinePrice: 1, baselineSource: 'made_up', baselinePeriod: '2026-03-09' }), national,
    );
    expect(r.origin).toBe('snapshot');
    expect(r.baselinePrice).toBe(3.8);
  });

  it('excludes obviously bad entries instead of crediting them', () => {
    expect(computeFillupSavings(fill({ gallonsPumped: 0 }), national).status).toBe('invalid');
    expect(computeFillupSavings(fill({ totalCost: 0 }), national).status).toBe('invalid');
    // total/gallons ($0.50) wildly disagrees with the entered price ($3.50)
    expect(computeFillupSavings(fill({ totalCost: 5 }), national).status).toBe('invalid');
    // $35.00/gal typo -> a "gap" of >$3 from the baseline
    expect(computeFillupSavings(fill({ pricePerGallon: 35, totalCost: 350 }), national).status).toBe('invalid');
  });

  it('uses the actual amount paid (totalCost), e.g. a pump-rounded or discounted total', () => {
    const r = computeFillupSavings(fill({ totalCost: 33 }), national);
    expect(r.savings).toBe(5); // 38 - 33
  });
});

describe('summarizeSavings — aggregate honesty', () => {
  const list: SavingsFillup[] = [
    fill({ id: 'a' }),                                                            // +3.00
    fill({ id: 'b', date: '2026-03-18', totalCost: 40, pricePerGallon: 4 }),      // 39 - 40 = -1.00
    fill({ id: 'c', fuelGrade: null }),                                            // excluded: no grade
    fill({ id: 'd', fuelGrade: 'e85' }),                                           // excluded: unsupported
    fill({ id: 'e', date: '2025-01-01' }),                                         // excluded: no baseline
    fill({ id: 'f', gallonsPumped: 0 }),                                           // excluded: invalid
  ];
  const s = summarizeSavings(list, national);

  it('only compared fill-ups contribute; the rest are counted with reasons', () => {
    expect(s.fillupsTotal).toBe(6);
    expect(s.compared).toBe(2);
    expect(s.excluded).toEqual({ no_grade: 1, unsupported_grade: 1, no_baseline: 1, invalid: 1 });
  });
  it('net savings = baseline cost - amount paid, across compared fill-ups only', () => {
    expect(s.netSavings).toBe(2); // +3 + -1
    expect(s.gallonsCompared).toBe(20);
    expect(s.spentCompared).toBe(75);
    expect(s.baselineCostCompared).toBe(77);
    expect(s.avgPaidPerGallon).toBe(3.75);
    expect(s.avgBaselinePerGallon).toBe(3.85);
  });
  it('with nothing comparable: zeros and nulls, never an estimate', () => {
    const none = summarizeSavings([fill({ fuelGrade: null })], national);
    expect(none.compared).toBe(0);
    expect(none.netSavings).toBe(0);
    expect(none.avgPaidPerGallon).toBeNull();
    expect(none.avgBaselinePerGallon).toBeNull();
  });
  it('empty input', () => {
    const e = summarizeSavings([], {});
    expect(e.fillupsTotal).toBe(0);
    expect(e.compared).toBe(0);
  });
});

describe('pickBaselineForNewFillup — frozen at log time', () => {
  const series = {
    SFL: [{ observedOn: '2026-10-05', price: 3.97 }],
    R1Z: [{ observedOn: '2026-10-05', price: 3.959 }],
    NUS: [{ observedOn: '2026-10-05', price: 4.354 }],
  };
  it('uses the most specific area that has a qualifying observation', () => {
    const b = pickBaselineForNewFillup({ grade: 'regular', date: '2026-10-07', state: 'FL', pointsByArea: series });
    expect(b).toEqual({ price: 3.97, source: 'eia_weekly', area: 'SFL', period: '2026-10-05' });
  });
  it('falls through state -> region -> national when the finer series is missing', () => {
    const noState = { R1Z: series.R1Z, NUS: series.NUS };
    expect(pickBaselineForNewFillup({ grade: 'regular', date: '2026-10-07', state: 'FL', pointsByArea: noState })?.area).toBe('R1Z');
    expect(pickBaselineForNewFillup({ grade: 'regular', date: '2026-10-07', state: 'FL', pointsByArea: { NUS: series.NUS } })?.area).toBe('NUS');
  });
  it('real-contract case: Florida has no diesel state series, so diesel resolves to the region', () => {
    const diesel = { R1Z: [{ observedOn: '2026-10-05', price: 5.699 }], NUS: [{ observedOn: '2026-10-05', price: 6.199 }] };
    expect(pickBaselineForNewFillup({ grade: 'diesel', date: '2026-10-07', state: 'FL', pointsByArea: diesel })?.area).toBe('R1Z');
  });
  it('no state / unknown state -> national', () => {
    expect(pickBaselineForNewFillup({ grade: 'regular', date: '2026-10-07', pointsByArea: series })?.area).toBe('NUS');
    expect(pickBaselineForNewFillup({ grade: 'regular', date: '2026-10-07', state: 'ZZ', pointsByArea: series })?.area).toBe('NUS');
  });
  it('no baseline for an unpriceable grade or when nothing is recent enough', () => {
    expect(pickBaselineForNewFillup({ grade: null, date: '2026-10-07', pointsByArea: series })).toBeNull();
    expect(pickBaselineForNewFillup({ grade: 'e85', date: '2026-10-07', pointsByArea: series })).toBeNull();
    expect(pickBaselineForNewFillup({ grade: 'regular', date: '2026-12-31', pointsByArea: series })).toBeNull();
  });
});

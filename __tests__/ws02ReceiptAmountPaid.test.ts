/**
 * WS02 Phase 1A — receipt scan populates "amount actually paid".
 *
 * Old behaviour this regresses against: /api/fillups/scan has always
 * returned `totalCost`, and components/FillupLogger.tsx destructured it
 * out of the response and then never used it. `legacyApplyScan` below
 * reproduces exactly what main did with a scan result, and the first test
 * asserts it drops the total — so the suite fails against the old code
 * and passes against the new.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  decideReceiptAmount, normalizeReceiptCurrency, detectReceiptTotalConflict,
  receiptAmountFieldValue, RECEIPT_TOTAL_MAX,
} from '@/lib/receiptScanAmount';

const read = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8');

/** Every field main's handleScan applied from a scan response. */
function legacyApplyScan(data: Record<string, unknown>): Record<string, string> {
  const applied: Record<string, string> = {};
  if (data.gallons        != null) applied.gallons     = String(data.gallons);
  if (data.pricePerGallon != null) applied.price       = String(data.pricePerGallon);
  if (data.date           != null) applied.date        = String(data.date);
  if (data.stationName    != null) applied.stationName = String(data.stationName);
  return applied;                       // totalCost: never read
}

const SCAN = { gallons: 12.004, pricePerGallon: 3.499, totalCost: 42.01, date: '2026-10-19', stationName: 'Shell' };

describe('WS02 1A — the gap being closed', () => {
  it('old behaviour: a scanned totalCost never reached the amount-paid field', () => {
    expect(legacyApplyScan(SCAN)).not.toHaveProperty('amountPaid');
    expect(Object.keys(legacyApplyScan(SCAN))).toEqual(['gallons', 'price', 'date', 'stationName']);
  });

  it('new behaviour: the same scan now yields the total to apply', () => {
    expect(decideReceiptAmount({ ...SCAN, current: '', currentSource: null }))
      .toEqual({ action: 'apply', value: 42.01, conflict: null });
  });

  it('FillupLogger actually calls the decision layer and writes the field', () => {
    const src = read('components/FillupLogger.tsx');
    expect(src).toMatch(/decideReceiptAmount\(/);
    expect(src).toMatch(/totalCost:\s+data\.totalCost/);
    expect(src).toMatch(/writeAmountPaid\(receiptAmountFieldValue\(decision\.value\), 'receipt'\)/);
  });
});

describe('normalizeReceiptCurrency — valid, missing, malformed', () => {
  it('accepts a plain number, rounded to cents', () => {
    expect(normalizeReceiptCurrency(42.01)).toBe(42.01);
    expect(normalizeReceiptCurrency(42.005)).toBe(42.01);   // half-up at the cent
    expect(normalizeReceiptCurrency(42.004)).toBe(42);
  });

  it('accepts the numeric-string and $-prefixed shapes a vision model can emit', () => {
    expect(normalizeReceiptCurrency('42.01')).toBe(42.01);
    expect(normalizeReceiptCurrency(' $42.01 ')).toBe(42.01);
    expect(normalizeReceiptCurrency('1,042.01')).toBe(1042.01);
  });

  it('rejects missing values', () => {
    for (const v of [null, undefined, '', '   ']) expect(normalizeReceiptCurrency(v)).toBeNull();
  });

  it('rejects malformed and out-of-range values', () => {
    for (const v of ['abc', '12.3.4', NaN, Infinity, -5, 0, 0.004, {}, [], true]) {
      expect(normalizeReceiptCurrency(v as unknown), String(v)).toBeNull();
    }
  });

  it('rejects a date or pump id misread as a total', () => {
    expect(normalizeReceiptCurrency(20261020)).toBeNull();
    expect(normalizeReceiptCurrency(RECEIPT_TOTAL_MAX)).toBe(RECEIPT_TOTAL_MAX);
    expect(normalizeReceiptCurrency(RECEIPT_TOTAL_MAX + 0.01)).toBeNull();
  });
});

describe('detectReceiptTotalConflict — the scan disagreeing with itself', () => {
  it('no conflict when the total matches gallons x price within tolerance', () => {
    expect(detectReceiptTotalConflict(42.01, 12.004, 3.499)).toBeNull();
    expect(detectReceiptTotalConflict(42.40, 12.004, 3.499)).toBeNull();   // within $0.50
  });

  it('reports a conflict when it does not', () => {
    expect(detectReceiptTotalConflict(62.01, 12.004, 3.499)).toEqual({
      receiptTotal: 62.01, computedTotal: 42, difference: 20.01,
    });
  });

  it('scales tolerance with the total, so large receipts are not false-flagged', () => {
    // 100 gal x $5.00 = $500; 2% = $10, so $508 is inside and $512 is outside.
    expect(detectReceiptTotalConflict(508, 100, 5)).toBeNull();
    expect(detectReceiptTotalConflict(512, 100, 5)).not.toBeNull();
  });

  it('an absent cross-check is not a conflict', () => {
    expect(detectReceiptTotalConflict(42.01, null, 3.499)).toBeNull();
    expect(detectReceiptTotalConflict(42.01, 12.004, null)).toBeNull();
    expect(detectReceiptTotalConflict(42.01, 0, 0)).toBeNull();
    expect(detectReceiptTotalConflict(42.01, 'abc', 'abc')).toBeNull();
  });
});

describe('decideReceiptAmount — applying without overwriting the user', () => {
  it('applies into an empty field', () => {
    expect(decideReceiptAmount({ totalCost: 42.01, current: '', currentSource: null }))
      .toEqual({ action: 'apply', value: 42.01, conflict: null });
  });

  it('skips a missing total and leaves the field untouched', () => {
    expect(decideReceiptAmount({ totalCost: null, current: '', currentSource: null }))
      .toEqual({ action: 'skip', reason: 'no-total' });
  });

  it('distinguishes a malformed total from an absent one', () => {
    expect(decideReceiptAmount({ totalCost: 'eighty bucks', current: '', currentSource: null }))
      .toEqual({ action: 'skip', reason: 'invalid-total' });
    expect(decideReceiptAmount({ totalCost: -3, current: '', currentSource: null }))
      .toEqual({ action: 'skip', reason: 'invalid-total' });
  });

  it('NEVER silently replaces a figure the user typed — it asks', () => {
    expect(decideReceiptAmount({ totalCost: 42.01, current: '40.00', currentSource: 'user' }))
      .toEqual({ action: 'confirm', value: 42.01, replaces: 40, conflict: null });
  });

  it('says nothing when the user already typed the same amount', () => {
    expect(decideReceiptAmount({ totalCost: 42.01, current: '42.01', currentSource: 'user' }))
      .toEqual({ action: 'skip', reason: 'already-matches' });
    // …including when they typed it without the trailing zero.
    expect(decideReceiptAmount({ totalCost: 42.1, current: '42.10', currentSource: 'user' }))
      .toEqual({ action: 'skip', reason: 'already-matches' });
  });

  it('a re-scan freely replaces the PREVIOUS scan s value', () => {
    expect(decideReceiptAmount({ totalCost: 51.75, current: '42.01', currentSource: 'receipt' }))
      .toEqual({ action: 'apply', value: 51.75, conflict: null });
  });

  it('a field holding garbage has no amount to protect, so it is overwritten', () => {
    expect(decideReceiptAmount({ totalCost: 42.01, current: '12.3.4', currentSource: 'user' }))
      .toEqual({ action: 'apply', value: 42.01, conflict: null });
  });

  it('carries the conflict through both the apply and the confirm paths', () => {
    const conflict = { receiptTotal: 62.01, computedTotal: 42, difference: 20.01 };
    expect(decideReceiptAmount({
      totalCost: 62.01, gallons: 12.004, pricePerGallon: 3.499, current: '', currentSource: null,
    })).toEqual({ action: 'apply', value: 62.01, conflict });
    expect(decideReceiptAmount({
      totalCost: 62.01, gallons: 12.004, pricePerGallon: 3.499, current: '40.00', currentSource: 'user',
    })).toEqual({ action: 'confirm', value: 62.01, replaces: 40, conflict });
  });

  it('a conflicting total is still never auto-reconciled to gallons x price', () => {
    const d = decideReceiptAmount({
      totalCost: 62.01, gallons: 12.004, pricePerGallon: 3.499, current: '', currentSource: null,
    });
    expect(d.action).toBe('apply');
    // The receipt's own number, not the computed one — we surface, we don't fix.
    expect((d as { value: number }).value).toBe(62.01);
  });
});

describe('receiptAmountFieldValue', () => {
  it('formats to two decimals for a currency input', () => {
    expect(receiptAmountFieldValue(42)).toBe('42.00');
    expect(receiptAmountFieldValue(42.1)).toBe('42.10');
    expect(receiptAmountFieldValue(42.01)).toBe('42.01');
  });
});

describe('copy exists in both languages', () => {
  const src = read('lib/translations.ts');
  for (const key of ['amountFromReceipt', 'receiptAmountDiffers', 'receiptAmountUse', 'receiptAmountKeepMine', 'receiptTotalMismatch']) {
    it(`${key} is defined twice (EN + ES)`, () => {
      expect(src.split(new RegExp(`\\b${key}:`)).length - 1).toBe(2);
    });
  }
});

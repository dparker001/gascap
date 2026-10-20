/**
 * Receipt scan -> "amount actually paid" (Workstream 02 Phase 1A, 2026-10-20).
 *
 * `/api/fillups/scan` has always returned `totalCost`. FillupLogger read it
 * out of the response and then dropped it: the one number a fuel receipt
 * states most plainly — the dollars actually charged — was the one number
 * the renter still had to re-type. This module is that wiring's decision
 * layer, kept pure and outside the component so every branch is directly
 * testable (same reason `calcTrip` moved to lib/tripFuelPlanner.ts).
 *
 * Standing rules this has to respect:
 *  - Never invent a reading. A scanned total is applied only when it reads
 *    as a sane currency amount; anything else is left for the user to type.
 *  - A value the user typed themselves is never silently overwritten. The
 *    scan asks ('confirm'), it does not take.
 *  - A scanned total that disagrees with the SAME scan's gallons x
 *    price-per-gallon is surfaced for review, never quietly reconciled:
 *    one of the three was misread and only the user can say which.
 */

/** Smallest currency amount that can be a real fuel purchase. */
export const RECEIPT_TOTAL_MIN = 0.01;
/**
 * Largest plausible single fuel purchase. Generous enough for a fleet
 * fill-up (34 gal x $6 ~= $204) while still rejecting the classic OCR
 * failure of reading a date or pump id as the total (e.g. 20261020).
 */
export const RECEIPT_TOTAL_MAX = 9999.99;

/** A receipt total may differ from gallons x price by at least this much… */
export const RECEIPT_CONFLICT_ABS_TOLERANCE = 0.5;
/** …or this share of the computed total, whichever is larger. */
export const RECEIPT_CONFLICT_REL_TOLERANCE = 0.02;

/**
 * Where the current contents of the amount-paid field came from. 'user'
 * values are protected; a previous scan's value is replaceable by a new
 * scan without asking.
 */
export type ReceiptAmountSource = 'user' | 'receipt' | null;

export interface ReceiptTotalConflict {
  /** The total the receipt scan reported, normalized to cents. */
  receiptTotal:  number;
  /** gallons x pricePerGallon from the same scan, normalized to cents. */
  computedTotal: number;
  /** Absolute difference, normalized to cents. */
  difference:    number;
}

export type ReceiptAmountDecision =
  /** Put `value` in the field now. */
  | { action: 'apply';   value: number; conflict: ReceiptTotalConflict | null }
  /** Ask before replacing the user's own `replaces` with `value`. */
  | { action: 'confirm'; value: number; replaces: number; conflict: ReceiptTotalConflict | null }
  /** Change nothing. */
  | { action: 'skip';    reason: 'no-total' | 'invalid-total' | 'already-matches' };

/**
 * Coerce an OCR value to a currency amount in cents, or null.
 *
 * Accepts a number or a numeric string: the route declares `totalCost` as
 * `number | null`, but that type is an assertion about JSON.parse output
 * from a language model, not a guarantee — a quoted "42.50" or a
 * "$42.50" is exactly the malformed shape worth absorbing here rather
 * than letting `NaN` reach the form.
 */
export function normalizeReceiptCurrency(raw: unknown): number | null {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    const cleaned = raw.trim().replace(/^\$/, '').replace(/,/g, '');
    if (cleaned === '') return null;
    n = Number(cleaned);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100) / 100;
  if (cents < RECEIPT_TOTAL_MIN || cents > RECEIPT_TOTAL_MAX) return null;
  return cents;
}

/**
 * Does the scanned total disagree with the same scan's own gallons x
 * price-per-gallon? Returns null when it agrees, when either factor is
 * missing, or when the factors can't form a comparison — an absent
 * cross-check is not a conflict.
 */
export function detectReceiptTotalConflict(
  receiptTotal: number,
  gallons:      unknown,
  pricePerGallon: unknown,
): ReceiptTotalConflict | null {
  const gal = typeof gallons === 'number' ? gallons : Number(gallons);
  const ppg = typeof pricePerGallon === 'number' ? pricePerGallon : Number(pricePerGallon);
  if (!Number.isFinite(gal) || !Number.isFinite(ppg) || gal <= 0 || ppg <= 0) return null;

  const computedTotal = Math.round(gal * ppg * 100) / 100;
  const difference    = Math.round(Math.abs(receiptTotal - computedTotal) * 100) / 100;
  const tolerance     = Math.max(
    RECEIPT_CONFLICT_ABS_TOLERANCE,
    Math.round(computedTotal * RECEIPT_CONFLICT_REL_TOLERANCE * 100) / 100,
  );
  if (difference <= tolerance) return null;
  return { receiptTotal, computedTotal, difference };
}

export interface ReceiptAmountInput {
  /** `totalCost` as returned by /api/fillups/scan. */
  totalCost:      unknown;
  /** `gallons` from the same scan, for the cross-check only. */
  gallons?:       unknown;
  /** `pricePerGallon` from the same scan, for the cross-check only. */
  pricePerGallon?: unknown;
  /** Raw current contents of the amount-paid input. */
  current:        string;
  /** Provenance of `current`. */
  currentSource:  ReceiptAmountSource;
}

/**
 * Decide what a scan should do to the amount-paid field.
 *
 * Note the asymmetry in how `current` is read: an unparseable or
 * out-of-range existing value counts as empty and is overwritten, because
 * a field holding "12.3.4" has no amount in it to protect. Only a value
 * that reads as real money AND was typed by the user blocks the apply.
 */
export function decideReceiptAmount(input: ReceiptAmountInput): ReceiptAmountDecision {
  const total = normalizeReceiptCurrency(input.totalCost);
  if (total === null) {
    const absent = input.totalCost === null || input.totalCost === undefined
      || (typeof input.totalCost === 'string' && input.totalCost.trim() === '');
    return { action: 'skip', reason: absent ? 'no-total' : 'invalid-total' };
  }

  const conflict = detectReceiptTotalConflict(total, input.gallons, input.pricePerGallon);
  const existing = normalizeReceiptCurrency(input.current);

  if (existing === null)                 return { action: 'apply', value: total, conflict };
  if (input.currentSource !== 'user')    return { action: 'apply', value: total, conflict };
  if (existing === total)                return { action: 'skip',  reason: 'already-matches' };
  return { action: 'confirm', value: total, replaces: existing, conflict };
}

/** The field value a decision produces, formatted for a currency input. */
export function receiptAmountFieldValue(value: number): string {
  return value.toFixed(2);
}

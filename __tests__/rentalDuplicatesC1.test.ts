/** C1 — soft duplicate matching (pure). */
import { describe, it, expect } from 'vitest';
import { findPossibleDuplicate, normalizeCompany, normalizeConfirmation, DUPLICATE_PICKUP_WINDOW_HOURS, type ExistingRentalForDuplicate } from '@/lib/rentalDuplicates';

const H = 3_600_000;
const P = Date.parse('2026-10-10T14:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const ex = (over: Partial<ExistingRentalForDuplicate> = {}): ExistingRentalForDuplicate => ({
  id: 'e1', rentalCompany: 'Hertz', rentalConfirmationNumber: null,
  pickupDateTime: null, returnDateTime: null, pickupDateTimeUtc: iso(P), returnDateTimeUtc: iso(P + 72 * H),
  pickupTimeZone: null, returnTimeZone: null, timeZone: null, ...over,
});
const cand = (over: Record<string, unknown> = {}) => ({ rentalCompany: 'hertz ', rentalConfirmationNumber: null as string | null, pickupDateTimeUtc: iso(P), ...over });

describe('normalization', () => {
  it('company: case, trim and inner whitespace; confirmation: upper-case alphanumerics only', () => {
    expect(normalizeCompany('  Hertz  Rent A  Car ')).toBe('hertz rent a car');
    expect(normalizeConfirmation(' ab-12 3c ')).toBe('AB123C');
    expect(normalizeConfirmation('--')).toBe('');
    expect(normalizeCompany(undefined)).toBe('');
  });
});

describe('confirmation match', () => {
  it('same company + same normalized confirmation → duplicate, regardless of time', () => {
    const m = findPossibleDuplicate(cand({ rentalConfirmationNumber: 'ab-123', pickupDateTimeUtc: iso(P + 900 * H) }),
      [ex({ rentalConfirmationNumber: 'AB123' })]);
    expect(m).toEqual({ rentalId: 'e1', matchedOn: 'confirmation' });
  });
  it('same confirmation but a different company is not a duplicate', () => {
    expect(findPossibleDuplicate(cand({ rentalCompany: 'Avis', rentalConfirmationNumber: 'AB123' }), [ex({ rentalConfirmationNumber: 'AB123' })])).toBeNull();
  });
  it('different confirmation numbers never match, even at the same pickup (a different booking)', () => {
    expect(findPossibleDuplicate(cand({ rentalConfirmationNumber: 'ZZ999' }), [ex({ rentalConfirmationNumber: 'AB123' })])).toBeNull();
  });
});

describe('pickup-window match', () => {
  it('same company within ±36h, confirmation missing on either side → duplicate', () => {
    expect(findPossibleDuplicate(cand({ pickupDateTimeUtc: iso(P + 10 * H) }), [ex()])).toEqual({ rentalId: 'e1', matchedOn: 'pickup_window' });
    expect(findPossibleDuplicate(cand({ rentalConfirmationNumber: 'AB123', pickupDateTimeUtc: iso(P + 10 * H) }), [ex()])).toMatchObject({ matchedOn: 'pickup_window' });
  });
  it('boundary: exactly 36h matches, 36h + 1ms does not', () => {
    const w = DUPLICATE_PICKUP_WINDOW_HOURS * H;
    expect(findPossibleDuplicate(cand({ pickupDateTimeUtc: iso(P + w) }), [ex()])).not.toBeNull();
    expect(findPossibleDuplicate(cand({ pickupDateTimeUtc: iso(P + w + 1) }), [ex()])).toBeNull();
    expect(findPossibleDuplicate(cand({ pickupDateTimeUtc: iso(P - w) }), [ex()])).not.toBeNull();
  });
  it('needs a known UTC instant on BOTH sides — a naive local time is never guessed', () => {
    expect(findPossibleDuplicate(cand({ pickupDateTimeUtc: null }), [ex()])).toBeNull();
    expect(findPossibleDuplicate(cand(), [ex({ pickupDateTimeUtc: null, pickupDateTime: '2026-10-10T10:00' })])).toBeNull();
  });
  it('ignores an existing rental whose schedule is malformed (needs_schedule)', () => {
    expect(findPossibleDuplicate(cand(), [ex({ returnDateTimeUtc: iso(P - H) })])).toBeNull();     // return before pickup
    expect(findPossibleDuplicate(cand(), [ex({ pickupTimeZone: 'EST' })])).toBeNull();            // invalid zone
  });
  it('but a confirmation match still applies to a malformed-schedule rental', () => {
    expect(findPossibleDuplicate(cand({ rentalConfirmationNumber: 'AB123' }), [ex({ returnDateTimeUtc: iso(P - H), rentalConfirmationNumber: 'AB123' })])).toMatchObject({ matchedOn: 'confirmation' });
  });
  it('picks the nearest pickup; a confirmation match outranks a nearer window match', () => {
    const near = ex({ id: 'near', pickupDateTimeUtc: iso(P + 2 * H) });
    const far  = ex({ id: 'far', pickupDateTimeUtc: iso(P + 30 * H) });
    expect(findPossibleDuplicate(cand(), [far, near])!.rentalId).toBe('near');
    const conf = ex({ id: 'conf', rentalConfirmationNumber: 'AB123', pickupDateTimeUtc: iso(P + 900 * H) });
    expect(findPossibleDuplicate(cand({ rentalConfirmationNumber: 'AB123' }), [near, conf])).toEqual({ rentalId: 'conf', matchedOn: 'confirmation' });
  });
  it('blank company never matches', () => {
    expect(findPossibleDuplicate(cand({ rentalCompany: '  ' }), [ex({ rentalCompany: '' })])).toBeNull();
  });
});

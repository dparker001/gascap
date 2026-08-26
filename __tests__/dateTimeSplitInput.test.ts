/**
 * Post-release fix (2026-08-25) — datetime-local overflow. The fused
 * `<input type="datetime-local">` is replaced by separate date+time inputs
 * (components/rental-return/DateTimeSplitInput.tsx). This file tests the
 * pure conversion logic that keeps the underlying stored representation
 * ("YYYY-MM-DDTHH:mm", what pickupDateTime/returnDateTime and
 * localDateTimeToUtcIso already expect) unchanged.
 */
import { describe, it, expect } from 'vitest';
import { splitLocalDateTime, combineLocalDateTime, localDateTimeToUtcIso } from '@/lib/rentalTimezone';

describe('splitLocalDateTime', () => {
  it('splits a combined value into date and time halves', () => {
    expect(splitLocalDateTime('2026-08-27T14:30')).toEqual({ date: '2026-08-27', time: '14:30' });
  });

  it('handles a value with seconds (still matches the leading YYYY-MM-DDTHH:mm)', () => {
    expect(splitLocalDateTime('2026-08-27T14:30:00')).toEqual({ date: '2026-08-27', time: '14:30' });
  });

  it('returns empty halves for an empty or malformed value', () => {
    expect(splitLocalDateTime('')).toEqual({ date: '', time: '' });
    expect(splitLocalDateTime('not-a-date')).toEqual({ date: '', time: '' });
  });
});

describe('combineLocalDateTime', () => {
  it('recombines date and time into the exact stored format', () => {
    expect(combineLocalDateTime('2026-08-27', '14:30')).toBe('2026-08-27T14:30');
  });

  it('returns empty when either half is missing — no half-complete datetime', () => {
    expect(combineLocalDateTime('2026-08-27', '')).toBe('');
    expect(combineLocalDateTime('', '14:30')).toBe('');
    expect(combineLocalDateTime('', '')).toBe('');
  });
});

describe('split/combine round-trip preserves the value localDateTimeToUtcIso expects', () => {
  it('a combined value split then recombined is byte-identical', () => {
    const original = '2026-08-27T14:30';
    const { date, time } = splitLocalDateTime(original);
    expect(combineLocalDateTime(date, time)).toBe(original);
  });

  it('the recombined value still converts to UTC correctly (no timezone regression)', () => {
    const original = '2026-08-27T14:30';
    const { date, time } = splitLocalDateTime(original);
    const recombined = combineLocalDateTime(date, time);
    expect(localDateTimeToUtcIso(recombined, 'America/New_York')).toBe(localDateTimeToUtcIso(original, 'America/New_York'));
  });
});

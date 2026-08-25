/**
 * lib/rentalTimezone.ts — timezone-correct local-wall-clock → UTC
 * conversion for rental pickup/return reminders (2026-08-25 P0 fix).
 */
import { describe, it, expect } from 'vitest';
import { localDateTimeToUtcIso } from '@/lib/rentalTimezone';

describe('localDateTimeToUtcIso', () => {
  it('1. 10:00 AM return in America/New_York (EDT, UTC-4 in August) converts to 14:00 UTC', () => {
    const iso = localDateTimeToUtcIso('2026-08-25T10:00', 'America/New_York');
    expect(iso).toBe('2026-08-25T14:00:00.000Z');
  });

  it('2. 8:00 AM (the expected 2h-before-10AM reminder time) converts correctly in the same zone', () => {
    const iso = localDateTimeToUtcIso('2026-08-25T08:00', 'America/New_York');
    expect(iso).toBe('2026-08-25T12:00:00.000Z');
    // Confirms the 2-hour gap survives the UTC conversion exactly.
    const returnIso = localDateTimeToUtcIso('2026-08-25T10:00', 'America/New_York');
    expect(Date.parse(returnIso!) - Date.parse(iso!)).toBe(2 * 60 * 60 * 1000);
  });

  it('3. same wall-clock time in a different zone (America/Los_Angeles, UTC-7 in August) produces a different UTC instant', () => {
    const nyIso = localDateTimeToUtcIso('2026-08-25T10:00', 'America/New_York');
    const laIso = localDateTimeToUtcIso('2026-08-25T10:00', 'America/Los_Angeles');
    expect(nyIso).not.toBe(laIso);
    expect(laIso).toBe('2026-08-25T17:00:00.000Z');
  });

  it('4. DST-safe: a winter date in America/New_York (EST, UTC-5) uses the correct seasonal offset', () => {
    const iso = localDateTimeToUtcIso('2026-01-15T10:00', 'America/New_York');
    expect(iso).toBe('2026-01-15T15:00:00.000Z');
  });

  it('5. UTC zone itself is a pure passthrough', () => {
    const iso = localDateTimeToUtcIso('2026-08-25T10:00', 'UTC');
    expect(iso).toBe('2026-08-25T10:00:00.000Z');
  });

  it('returns null for missing/invalid inputs rather than guessing', () => {
    expect(localDateTimeToUtcIso(null, 'America/New_York')).toBeNull();
    expect(localDateTimeToUtcIso('2026-08-25T10:00', null)).toBeNull();
    expect(localDateTimeToUtcIso('not-a-date', 'America/New_York')).toBeNull();
    expect(localDateTimeToUtcIso('', '')).toBeNull();
  });
});

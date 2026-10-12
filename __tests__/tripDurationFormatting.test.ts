/**
 * Routing-integrity audit (2026-10-12) — direct unit tests for the Google
 * duration-string → seconds (parseDuration) → displayed hours/minutes
 * (formatDuration) pipeline. No prior test exercised either function; this
 * is the gap that let a corrupted/implausible duration reach the user
 * un-caught during the Orlando→Atlanta "~20 hours" investigation (the
 * underlying cause there was the stale-coordinates race fixed in this PR,
 * not a parsing bug — but the parsing/formatting layer had zero coverage
 * either way).
 */
import { describe, it, expect } from 'vitest';
import { parseDuration } from '@/lib/mapsProvider/googleMapsProvider';
import { formatDuration } from '@/components/TripCostEstimator';

const fmt = {
  durationMin:       (mins: number) => `${mins} min`,
  durationHours:     (hours: number) => `${hours} hr`,
  durationHoursMins: (hours: number, mins: number) => `${hours} hr ${mins} min`,
};

describe('parseDuration — Google Routes duration string → seconds', () => {
  it('parses a plain seconds string like "23506s"', () => {
    expect(parseDuration('23506s')).toBe(23506);
  });

  it('parses "0s" as 0', () => {
    expect(parseDuration('0s')).toBe(0);
  });

  it('parses a large multi-day duration without overflow', () => {
    expect(parseDuration('259200s')).toBe(259200); // 72 hours
  });

  it('returns 0 for malformed input (no trailing "s")', () => {
    expect(parseDuration('abc')).toBe(0);
  });

  it('returns 0 for an empty string', () => {
    expect(parseDuration('')).toBe(0);
  });
});

describe('formatDuration — seconds → human-readable hours/minutes', () => {
  it('formats under an hour as minutes only', () => {
    expect(formatDuration(25 * 60, fmt)).toBe('25 min');
  });

  it('formats exactly one hour with no remainder as hours only', () => {
    expect(formatDuration(60 * 60, fmt)).toBe('1 hr');
  });

  it('formats a mixed duration as hours and minutes', () => {
    // 6h32m, the real Orlando→Atlanta duration confirmed during the audit
    expect(formatDuration(6 * 3600 + 32 * 60, fmt)).toBe('6 hr 32 min');
  });

  it('formats a long multi-hour trip correctly (no duplicate unit conversion)', () => {
    // 453 minutes = 7h33m — guards against double-converting seconds->minutes
    expect(formatDuration(453 * 60, fmt)).toBe('7 hr 33 min');
  });

  it('rounds to the nearest minute rather than truncating', () => {
    // 90.6 minutes rounds to 91 minutes = 1hr 31min
    expect(formatDuration(90.6 * 60, fmt)).toBe('1 hr 31 min');
  });

  it('formats zero seconds as "0 min"', () => {
    expect(formatDuration(0, fmt)).toBe('0 min');
  });

  it('end-to-end: parseDuration feeding formatDuration matches the confirmed live reproduction (6h32m)', () => {
    const seconds = parseDuration('23506s'); // 23506s = 391.77min ≈ 6h32m (6*60+32=392min, rounds down from .77→ check exact)
    expect(formatDuration(seconds, fmt)).toBe('6 hr 32 min');
  });
});

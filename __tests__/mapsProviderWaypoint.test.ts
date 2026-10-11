/**
 * Trip Planner Phase 2 — /api/maps/route now accepts coordinates (Current
 * Location, resolved Favorite Addresses) alongside the existing address
 * string. These guards are what stand between a malformed client payload
 * and Google's Routes API.
 */
import { describe, it, expect } from 'vitest';
import { isLatLng, isValidWaypoint } from '@/lib/mapsProvider/types';

describe('isLatLng', () => {
  it('1. accepts valid coordinates', () => {
    expect(isLatLng({ latitude: 28.5383, longitude: -81.3792 })).toBe(true);
  });
  it('2. rejects out-of-range latitude/longitude', () => {
    expect(isLatLng({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isLatLng({ latitude: 0, longitude: 181 })).toBe(false);
  });
  it('3. rejects NaN/Infinity', () => {
    expect(isLatLng({ latitude: NaN, longitude: 0 })).toBe(false);
    expect(isLatLng({ latitude: Infinity, longitude: 0 })).toBe(false);
  });
  it('4. rejects non-objects, null, and missing fields', () => {
    expect(isLatLng(null)).toBe(false);
    expect(isLatLng('28.5,-81.3')).toBe(false);
    expect(isLatLng({ latitude: 28.5 })).toBe(false);
  });
});

describe('isValidWaypoint', () => {
  it('5. accepts a non-empty address string', () => {
    expect(isValidWaypoint('123 Main St, Orlando, FL')).toBe(true);
  });
  it('6. rejects an empty or whitespace-only string', () => {
    expect(isValidWaypoint('')).toBe(false);
    expect(isValidWaypoint('   ')).toBe(false);
  });
  it('7. accepts valid coordinates', () => {
    expect(isValidWaypoint({ latitude: 28.5, longitude: -81.4 })).toBe(true);
  });
  it('8. rejects undefined/malformed input', () => {
    expect(isValidWaypoint(undefined)).toBe(false);
    expect(isValidWaypoint({ latitude: 'not a number', longitude: -81.4 })).toBe(false);
  });
});

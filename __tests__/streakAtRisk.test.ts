import { describe, it, expect } from 'vitest';
import { isStreakAtRisk } from '../lib/streakRisk';

const TODAY = '2026-08-15';

describe('isStreakAtRisk', () => {
  it('reproduces the reported false alarm', () => {
    // Signed in months ago, has opened the app every day since. The old gate
    // read lastLoginAt and fired nightly; the streak was never at risk.
    expect(isStreakAtRisk(['2026-08-13', '2026-08-14', TODAY], '2026-05-01T10:00:00Z', TODAY)).toBe(false);
  });

  it('is at risk when the last activity was yesterday', () => {
    expect(isStreakAtRisk(['2026-08-13', '2026-08-14'], '2026-05-01T10:00:00Z', TODAY)).toBe(true);
  });

  it('is not at risk after a fresh sign-in today, even with no visit recorded', () => {
    expect(isStreakAtRisk(['2026-08-14'], `${TODAY}T09:00:00Z`, TODAY)).toBe(false);
  });

  it('handles a user ahead of UTC whose local date already rolled over', () => {
    // activeDays uses the CLIENT's local date. At 23:00 UTC someone in CEST
    // is on the 16th — an equality check would have called that "not today".
    expect(isStreakAtRisk(['2026-08-16'], null, TODAY)).toBe(false);
  });

  it('does not depend on activeDays being sorted', () => {
    expect(isStreakAtRisk([TODAY, '2026-08-01', '2026-08-14'], null, TODAY)).toBe(false);
  });

  it('is at risk for a user with no history at all', () => {
    expect(isStreakAtRisk([], null, TODAY)).toBe(true);
    expect(isStreakAtRisk(null, undefined, TODAY)).toBe(true);
  });
});

// The predicate above is only worth anything if the cron actually calls it.
// Reverting the call site would silently restore nightly false alarms while
// every unit test above still passed, so assert the wiring too.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('streak-reminder cron wiring', () => {
  const src = readFileSync(
    join(process.cwd(), 'app/api/cron/streak-reminder/route.ts'),
    'utf8',
  );

  it('gates on isStreakAtRisk', () => {
    expect(src).toContain('isStreakAtRisk(');
  });

  it('does not gate on lastLoginAt directly — that was the bug', () => {
    // lastLoginAt may still be PASSED to isStreakAtRisk; what must not come
    // back is a bare startsWith check standing in for "was active today".
    expect(src).not.toMatch(/lastLogin\w*\.startsWith\(/);
  });
});

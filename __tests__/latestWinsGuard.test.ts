/**
 * Routing-integrity fix (2026-10-12) — pure unit tests for the
 * "only the latest async operation wins" generation-counter primitive.
 */
import { describe, it, expect } from 'vitest';
import { createLatestWinsGuard } from '@/lib/latestWinsGuard';

describe('createLatestWinsGuard', () => {
  it('a freshly-begun token is current', () => {
    const guard = createLatestWinsGuard();
    const token = guard.begin();
    expect(guard.isCurrent(token)).toBe(true);
  });

  it('starting a second operation invalidates the first token', () => {
    const guard = createLatestWinsGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('invalidateAll() invalidates an outstanding token without issuing a new one', () => {
    const guard = createLatestWinsGuard();
    const token = guard.begin();
    guard.invalidateAll();
    expect(guard.isCurrent(token)).toBe(false);
  });

  it('a token from a prior guard instance never matches a different instance', () => {
    const guardA = createLatestWinsGuard();
    const guardB = createLatestWinsGuard();
    const token = guardA.begin();
    expect(guardB.isCurrent(token)).toBe(false);
  });

  it('repeated invalidateAll() calls never resurrect an old token as current', () => {
    const guard = createLatestWinsGuard();
    const token = guard.begin();
    guard.invalidateAll();
    guard.invalidateAll();
    guard.invalidateAll();
    expect(guard.isCurrent(token)).toBe(false);
  });

  it('begin() always returns a token distinct from every previous token', () => {
    const guard = createLatestWinsGuard();
    const tokens = new Set([guard.begin(), guard.begin(), guard.begin()]);
    expect(tokens.size).toBe(3);
  });
});

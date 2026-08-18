/**
 * OTP verification attempt limiting.
 *
 * /api/otp/send was rate limited; the code COMPARISON in the credentials-otp
 * provider was not. A 6-digit code is a 1,000,000-value space with a 10-minute
 * life, and a successful guess mints a session — passwordless sign-in makes
 * verification the security boundary, so it needs its own ceiling.
 *
 * Tests the limiter contract directly. The provider's authorize() cannot be
 * imported here without a live database.
 */
import { describe, it, expect } from 'vitest';
import { checkRateLimit } from '../lib/rateLimit';

const WINDOW = 10 * 60 * 1000;
const MAX    = 5;

describe('OTP verify attempt ceiling', () => {
  it('allows exactly MAX attempts, then refuses', () => {
    const key = `otp-verify:test-${Math.random()}@example.com`;
    for (let i = 1; i <= MAX; i++) {
      expect(checkRateLimit(key, MAX, WINDOW).allowed).toBe(true);
    }
    expect(checkRateLimit(key, MAX, WINDOW).allowed).toBe(false);
  });

  it('leaves 1,000,000 combinations far out of reach within one window', () => {
    // The point of the ceiling: 5 guesses against a 6-digit space is a
    // 1-in-200,000 shot per window, versus effectively certain if unlimited.
    const key = `otp-verify:math-${Math.random()}@example.com`;
    let allowed = 0;
    for (let i = 0; i < 5000; i++) if (checkRateLimit(key, MAX, WINDOW).allowed) allowed++;
    expect(allowed).toBe(MAX);
    expect(allowed / 1_000_000).toBeLessThan(0.00001);
  });

  it('counts each email separately, so one target cannot exhaust another', () => {
    const a = `otp-verify:a-${Math.random()}@example.com`;
    const b = `otp-verify:b-${Math.random()}@example.com`;
    for (let i = 0; i < MAX + 3; i++) checkRateLimit(a, MAX, WINDOW);
    expect(checkRateLimit(a, MAX, WINDOW).allowed).toBe(false);
    expect(checkRateLimit(b, MAX, WINDOW).allowed).toBe(true);
  });
});

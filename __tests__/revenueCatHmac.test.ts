/**
 * Tests for lib/revenueCatHmac.ts — OFF-BY-DEFAULT defense in depth.
 *
 * See that file's header for the important caveat: the exact header name and
 * algorithm here were NOT independently verified against RevenueCat's
 * current live documentation. These tests verify the module's own internal
 * consistency (it correctly implements the scheme IT claims to implement),
 * not that the scheme matches RevenueCat's actual requirements.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { verifyRevenueCatHmac } from '../lib/revenueCatHmac';

const SECRET = 'test-hmac-secret';
const BODY = JSON.stringify({ event: { id: 'evt_1', type: 'INITIAL_PURCHASE' } });

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

beforeEach(() => {
  delete process.env.REVENUECAT_HMAC_SECRET;
});

describe('verifyRevenueCatHmac', () => {
  it('missing local secret → not checked at all (complete no-op)', () => {
    const res = verifyRevenueCatHmac(BODY, sign(BODY, SECRET));
    expect(res.checked).toBe(false);
  });

  it('valid signature → checked and valid', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    const res = verifyRevenueCatHmac(BODY, sign(BODY, SECRET));
    expect(res).toEqual({ checked: true, valid: true });
  });

  it('invalid signature (wrong secret) → checked and invalid', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    const res = verifyRevenueCatHmac(BODY, sign(BODY, 'wrong-secret'));
    expect(res).toMatchObject({ checked: true, valid: false, reason: 'mismatch' });
  });

  it('missing signature header → checked and invalid, distinct reason', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    const res = verifyRevenueCatHmac(BODY, null);
    expect(res).toMatchObject({ checked: true, valid: false, reason: 'missing-header' });
  });

  it('malformed signature (not valid hex) → checked and invalid, not a thrown exception', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    const res = verifyRevenueCatHmac(BODY, 'not-hex-!!!zz');
    expect(res.checked).toBe(true);
    expect((res as { valid: boolean }).valid).toBe(false);
  });

  it('a tampered body fails even with an otherwise-correctly-formed signature', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    const sig = sign(BODY, SECRET);
    const tamperedBody = BODY.replace('INITIAL_PURCHASE', 'REFUND');
    const res = verifyRevenueCatHmac(tamperedBody, sig);
    expect(res).toMatchObject({ checked: true, valid: false, reason: 'mismatch' });
  });

  it('does not throw on an empty body', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    expect(() => verifyRevenueCatHmac('', sign('', SECRET))).not.toThrow();
  });
});

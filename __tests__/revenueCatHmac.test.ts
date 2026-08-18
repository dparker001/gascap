/**
 * Tests for lib/revenueCatHmac.ts — OFF-BY-DEFAULT defense in depth.
 *
 * Scheme under test (per that file's header): header
 * `X-RevenueCat-Webhook-Signature: t=<unix_ts>,v1=<hex hmac>`, signed
 * message `${timestamp}.${rawBody}`, HMAC-SHA256. This was reported by an
 * independent review that checked RevenueCat's current documentation, not
 * independently re-browsed from this environment — see the file header for
 * the verification steps required before enabling in production. These
 * tests verify the module correctly implements the scheme it claims to
 * implement.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { verifyRevenueCatHmac } from '../lib/revenueCatHmac';

const SECRET = 'test-hmac-secret';
const BODY = JSON.stringify({ event: { id: 'evt_1', type: 'INITIAL_PURCHASE' } });

function sign(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${sig}`;
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

  it('malformed header (no t=/v1= structure) → checked and invalid, not a thrown exception', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    const res = verifyRevenueCatHmac(BODY, 'not-a-valid-header-!!!zz');
    expect(res).toMatchObject({ checked: true, valid: false, reason: 'malformed-header' });
  });

  it('malformed v1 (not valid hex) → checked and invalid, not a thrown exception', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    const ts = Math.floor(Date.now() / 1000);
    const res = verifyRevenueCatHmac(BODY, `t=${ts},v1=not-hex-!!!zz`);
    expect(res.checked).toBe(true);
    expect((res as { valid: boolean }).valid).toBe(false);
  });

  it('a timestamp far in the past is rejected as stale (replay protection)', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    const staleTs = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const res = verifyRevenueCatHmac(BODY, sign(BODY, SECRET, staleTs));
    expect(res).toMatchObject({ checked: true, valid: false, reason: 'stale-timestamp' });
  });

  it('a timestamp within tolerance is accepted', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    const recentTs = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
    const res = verifyRevenueCatHmac(BODY, sign(BODY, SECRET, recentTs));
    expect(res).toEqual({ checked: true, valid: true });
  });

  it('a tampered body fails even with an otherwise-correctly-formed signature', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    const sig = sign(BODY, SECRET);
    const tamperedBody = BODY.replace('INITIAL_PURCHASE', 'REFUND');
    const res = verifyRevenueCatHmac(tamperedBody, sig);
    expect(res).toMatchObject({ checked: true, valid: false, reason: 'mismatch' });
  });

  it('a tampered timestamp fails even if the original signature is reused (can\'t just replay with a new claimed time)', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    const ts = Math.floor(Date.now() / 1000);
    const realSig = sign(BODY, SECRET, ts).split(',v1=')[1];
    const forged = `t=${ts + 1},v1=${realSig}`;
    const res = verifyRevenueCatHmac(BODY, forged);
    expect(res).toMatchObject({ checked: true, valid: false, reason: 'mismatch' });
  });

  it('does not throw on an empty body', () => {
    process.env.REVENUECAT_HMAC_SECRET = SECRET;
    expect(() => verifyRevenueCatHmac('', sign('', SECRET))).not.toThrow();
  });
});

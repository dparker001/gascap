/**
 * Sprint 2 hardening — RevenueCat webhook HMAC verification. OPTIONAL and
 * OFF BY DEFAULT until REVENUECAT_HMAC_SECRET is configured in production.
 *
 * ============================================================================
 * SCHEME — confirmed against RevenueCat's current official documentation
 * ============================================================================
 * Post-Sprint-2 Revision 1 rewrote this against a REPORTED spec (not yet
 * independently checked from this environment at the time). Independent
 * review (ChatGPT, Sprint 2 preflight round) has since directly verified
 * RevenueCat's current official documentation and CONFIRMED this
 * implementation matches the real, current contract:
 *
 *   Header:        X-RevenueCat-Webhook-Signature
 *   Header format:  t=<unix_timestamp>,v1=<hmac_sha256_hex>
 *   Signed message: <unix_timestamp>.<raw_request_body>
 *   Algorithm:      HMAC-SHA256, hex-encoded
 *   Comparison:     constant-time (see crypto.timingSafeEqual below)
 *   Timestamp tolerance: an optional window (this implementation uses 5
 *                        minutes) to bound replay/clock-skew — RevenueCat's
 *                        docs note a tolerance is expected but don't mandate
 *                        an exact value.
 *
 * The SPECIFICATION itself is no longer an open question. What remains
 * unverified is a LIVE SIGNED DELIVERY — this code has not yet processed a
 * real webhook RevenueCat actually signed, only synthetic test data. Spec
 * research and live-delivery validation are different kinds of evidence;
 * confirming the former does not substitute for the latter.
 *
 * REVENUECAT_HMAC_SECRET MUST remain unset in production until Don (or
 * whoever configures it) has:
 *   1. Confirmed in the RevenueCat dashboard that webhook signing is enabled
 *      and generated a signing secret.
 *   2. Set REVENUECAT_HMAC_SECRET in Railway — this step is unavoidable
 *      before step 3 can mean anything: `verifyRevenueCatHmac` returns
 *      `{ checked: false }` (a complete no-op) whenever the secret is
 *      unset, so a delivery CANNOT be validated while it remains unset. Do
 *      not read "test before enabling" as "the secret can stay unset during
 *      the test" — it cannot.
 *   3. Immediately sent a real test webhook delivery (RevenueCat's
 *      dashboard can resend a past event) and confirmed this code accepts
 *      it (`{ checked: true, valid: true }` in logs, and the request not
 *      rejected).
 *   4. If step 3 fails, unset REVENUECAT_HMAC_SECRET again immediately —
 *      reverting to the no-op state — rather than leaving a broken
 *      enforcement path live in production while debugging it.
 *
 * Until REVENUECAT_HMAC_SECRET is set (or after it's unset again per step
 * 4), this module is a complete no-op — the existing Authorization-header
 * check (Sprint 1) remains the sole auth mechanism, unchanged and
 * unaffected. HMAC here is additive defense in depth, never a replacement
 * for it.
 * ============================================================================
 */

import crypto from 'crypto';

export const HMAC_SIGNATURE_HEADER = 'x-revenuecat-webhook-signature';

/**
 * How far a signed timestamp may drift from "now" before being rejected as
 * stale — basic replay protection, evaluated once per request against the
 * time the SIGNATURE claims to have been generated. This is NOT a claim
 * about RevenueCat's total webhook retry window/schedule — a retried
 * delivery can legitimately arrive well after 5 minutes have passed since
 * the ORIGINAL event occurred, and that's fine, because RevenueCat is
 * expected to re-sign each retry with a fresh, current timestamp — this
 * tolerance only bounds clock skew and network delivery latency for a
 * single signed request, not how long RevenueCat may keep retrying the
 * underlying event overall. Do not conflate the two.
 */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export type HmacCheckResult =
  | { checked: false }                     // not configured — no-op, caller proceeds as before
  | { checked: true; valid: true }
  | { checked: true; valid: false; reason: 'missing-header' | 'malformed-header' | 'stale-timestamp' | 'mismatch' };

/**
 * Verify the HMAC signature on a RevenueCat webhook body, IF configured.
 *
 * @param rawBody   The exact raw request body bytes/string — the signed
 *                  message is `${timestamp}.${rawBody}`, so this MUST be the
 *                  untouched original payload, not a re-stringified
 *                  JSON.parse(...) round-trip (whitespace/key-order
 *                  differences would silently invalidate every signature).
 */
export function verifyRevenueCatHmac(rawBody: string, signatureHeader: string | null): HmacCheckResult {
  const secret = process.env.REVENUECAT_HMAC_SECRET;
  if (!secret) return { checked: false };

  if (!signatureHeader) return { checked: true, valid: false, reason: 'missing-header' };

  // Header format: `t=<unix_timestamp>,v1=<hex signature>` — same shape as
  // Stripe's Stripe-Signature header, per the documented RevenueCat scheme.
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const idx = kv.indexOf('=');
      return idx === -1 ? [kv, ''] : [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
    return { checked: true, valid: false, reason: 'malformed-header' };
  }

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > TIMESTAMP_TOLERANCE_MS) {
    return { checked: true, valid: false, reason: 'stale-timestamp' };
  }

  const signedMessage = `${timestamp}.${rawBody}`;

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = crypto.createHmac('sha256', secret).update(signedMessage, 'utf8').digest();
    provided = Buffer.from(signature, 'hex');
  } catch {
    return { checked: true, valid: false, reason: 'malformed-header' };
  }

  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return { checked: true, valid: false, reason: 'mismatch' };
  }
  return { checked: true, valid: true };
}

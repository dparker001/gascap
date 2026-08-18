/**
 * Sprint 2 hardening — RevenueCat webhook HMAC verification. OPTIONAL and
 * OFF BY DEFAULT until REVENUECAT_HMAC_SECRET is configured in production.
 *
 * ============================================================================
 * SCHEME — per RevenueCat's current documented webhook signing protocol
 * ============================================================================
 * Post-Sprint-2 Revision 1: the original implementation here (plain
 * `X-RevenueCat-Signature: HMAC-SHA256(rawBody)` hex, modeled on Stripe/
 * GitHub's simpler pattern) was an assumption, not a confirmed spec, and the
 * independent review that caught the entitlement-provenance bugs
 * (docs/reviews/) separately checked RevenueCat's current documentation and
 * found it does NOT match. Rewritten against the reported spec:
 *
 *   Header:        X-RevenueCat-Webhook-Signature
 *   Header format:  t=<unix_timestamp>,v1=<signature>
 *   Signed message: <unix_timestamp>.<raw_request_body>
 *   Algorithm:      HMAC-SHA256, hex-encoded
 *
 * This still was not independently re-confirmed against RevenueCat's live
 * dashboard/docs FROM THIS ENVIRONMENT — this file implements what was
 * reported, not something browsed and verified firsthand here. Per the
 * standing rule (do not merge fixes to a codebase this security-sensitive
 * on secondhand claims without a chance to verify), REVENUECAT_HMAC_SECRET
 * MUST remain unset in production until Don (or whoever configures it) has:
 *   1. Confirmed in the RevenueCat dashboard that webhook signing is enabled
 *      and generated a signing secret.
 *   2. Sent a real test webhook delivery (RevenueCat's dashboard can resend
 *      a past event) and confirmed this code accepts it.
 *   3. Only then set the env var in Railway.
 *
 * Until REVENUECAT_HMAC_SECRET is set, this module is a complete no-op — the
 * existing Authorization-header check (Sprint 1) remains the sole auth
 * mechanism, unchanged and unaffected. HMAC here is additive defense in
 * depth, never a replacement for it.
 * ============================================================================
 */

import crypto from 'crypto';

export const HMAC_SIGNATURE_HEADER = 'x-revenuecat-webhook-signature';

/**
 * How far a signed timestamp may drift from "now" before being rejected as
 * stale — basic replay protection. RevenueCat's own retry window (up to 5
 * attempts) is well under this; 5 minutes leaves generous headroom for
 * legitimate clock skew and delivery latency without meaningfully weakening
 * the replay defense.
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

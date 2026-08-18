/**
 * Sprint 2 hardening — RevenueCat webhook HMAC verification. OPTIONAL,
 * OFF BY DEFAULT, and NOT INDEPENDENTLY VERIFIED against RevenueCat's
 * current live documentation from this environment.
 *
 * ============================================================================
 * IMPORTANT — READ BEFORE ENABLING
 * ============================================================================
 * This implements the conventional HMAC-SHA256-over-the-raw-body scheme used
 * by most webhook providers (Stripe, GitHub, etc.), with the signature
 * expected in an `X-RevenueCat-Signature` header as a hex-encoded digest.
 * That shape was NOT confirmed against RevenueCat's current dashboard/docs
 * as part of this change — the sprint brief was explicit that field names
 * and cryptographic format must not be assumed, and this environment could
 * not browse RevenueCat's live documentation to confirm them.
 *
 * BEFORE setting REVENUECAT_HMAC_SECRET in production:
 *   1. In the RevenueCat dashboard, under the webhook's configuration, find
 *      whether it offers a signing secret / HMAC option at all (as of this
 *      writing, RevenueCat's primary documented webhook auth is the static
 *      Authorization header this app already verifies — HMAC signing may or
 *      may not be a currently-offered feature; confirm this first).
 *   2. If it exists, confirm: the exact header name, the exact algorithm
 *      (SHA-256 is assumed here), the exact encoding (hex is assumed here),
 *      and whether the signed payload is the raw body bytes or something
 *      else (a canonicalized/re-serialized form would silently break this).
 *   3. Update this file to match EXACTLY what RevenueCat documents, not what
 *      is guessed here.
 *   4. Test against a real webhook delivery (RevenueCat's dashboard can
 *      resend a past event) before relying on it in production.
 *
 * Until REVENUECAT_HMAC_SECRET is set, this module is a complete no-op — the
 * existing Authorization-header check (Sprint 1) remains the sole auth
 * mechanism, unchanged and unaffected. HMAC here is additive defense in
 * depth, never a replacement for it.
 * ============================================================================
 */

import crypto from 'crypto';

export const HMAC_SIGNATURE_HEADER = 'x-revenuecat-signature';

export type HmacCheckResult =
  | { checked: false }                     // not configured — no-op, caller proceeds as before
  | { checked: true; valid: true }
  | { checked: true; valid: false; reason: 'missing-header' | 'malformed-signature' | 'mismatch' };

/**
 * Verify the HMAC signature on a RevenueCat webhook body, IF configured.
 *
 * @param rawBody   The exact raw request body bytes/string — HMAC schemes
 *                  generally require the byte-for-byte original payload, not
 *                  a re-stringified JSON.parse(...) round-trip, which can
 *                  differ in whitespace/key order and silently invalidate
 *                  every signature. Callers must pass the untouched body.
 */
export function verifyRevenueCatHmac(rawBody: string, signatureHeader: string | null): HmacCheckResult {
  const secret = process.env.REVENUECAT_HMAC_SECRET;
  if (!secret) return { checked: false };

  if (!signatureHeader) return { checked: true, valid: false, reason: 'missing-header' };

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest();
    provided = Buffer.from(signatureHeader, 'hex');
  } catch {
    return { checked: true, valid: false, reason: 'malformed-signature' };
  }

  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return { checked: true, valid: false, reason: 'mismatch' };
  }
  return { checked: true, valid: true };
}

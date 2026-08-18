/**
 * Post-Sprint-2 Revision 1 fix — trusted client IP resolution for
 * rate-limiting keys.
 *
 * The original OTP-send and password-reset rate limiters preferred
 * `X-Forwarded-For` over `X-Real-IP`. Per Railway's current documentation,
 * `X-Real-IP` is the platform-set, trusted client remote-IP header;
 * `X-Forwarded-For` is not guaranteed to be similarly trustworthy — a
 * caller-supplied value can end up in that header depending on the proxy
 * chain, which would let an attacker rotate their apparent IP at will and
 * defeat the per-IP layer of a rate limit entirely. `X-Real-IP` is now
 * preferred; `X-Forwarded-For` is used only as a fallback when `X-Real-IP`
 * is absent (still better than nothing, but callers should not treat it as
 * equally trustworthy).
 */
export function getTrustedClientIp(req: Request): string | null {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return null;
}

/**
 * In-memory OTP store for passwordless email sign-in.
 *
 * Single Railway instance → in-memory is fine. Codes expire in 10 minutes.
 * Rate limit: 3 sends per email per 15 minutes (prevents abuse).
 */

interface OtpEntry {
  code:      string;
  name:      string;  // captured at signup so we can create the account on verify
  expiresAt: number;
  used:      boolean;
}

interface RateEntry {
  count:     number;
  windowEnd: number;
}

const store: Map<string, OtpEntry>   = new Map();
const rates: Map<string, RateEntry>  = new Map();

const OTP_TTL_MS    = 10 * 60 * 1000;  // 10 minutes
const RATE_MAX      = 3;
const RATE_WINDOW   = 15 * 60 * 1000;  // 15 minutes

/** Generate a cryptographically random 6-digit code. */
function generateCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, '0');
}

/** Check rate limit. Returns true if the send is allowed. */
export function checkOtpRate(email: string): boolean {
  const key = email.toLowerCase();
  const now  = Date.now();
  const r    = rates.get(key);

  if (!r || now > r.windowEnd) {
    rates.set(key, { count: 1, windowEnd: now + RATE_WINDOW });
    return true;
  }
  if (r.count >= RATE_MAX) return false;
  r.count += 1;
  return true;
}

/** Store a new OTP and return the 6-digit code. Replaces any existing code for the email. */
export function createOtp(email: string, name: string): string {
  const code = generateCode();
  store.set(email.toLowerCase(), {
    code,
    name,
    expiresAt: Date.now() + OTP_TTL_MS,
    used:      false,
  });
  return code;
}

/** Verify a code. Returns the stored name on success, null on failure. */
export function verifyOtp(email: string, code: string): string | null {
  const key   = email.toLowerCase();
  const entry = store.get(key);
  if (!entry)                          return null;
  if (entry.used)                      return null;
  if (Date.now() > entry.expiresAt)    return null;
  if (entry.code !== code.trim())      return null;

  entry.used = true;  // one-time use
  store.delete(key);
  return entry.name;
}

/** Peek at remaining TTL in seconds (for UI countdown). Returns 0 if expired/missing. */
export function otpTtlSeconds(email: string): number {
  const entry = store.get(email.toLowerCase());
  if (!entry) return 0;
  return Math.max(0, Math.round((entry.expiresAt - Date.now()) / 1000));
}

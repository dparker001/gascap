/**
 * In-memory OTP store for new users (no DB row exists yet).
 * Shared between app/api/otp/send (writes) and lib/auth (reads+deletes).
 * Kept in lib/ to avoid circular imports between app/api/ and lib/.
 */
export const newUserOtps = new Map<string, { code: string; name: string; expires: number }>();

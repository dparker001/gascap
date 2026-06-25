/**
 * Short-lived one-time session tokens issued after OTP verification.
 * The verify route creates them; the credentials-otp NextAuth provider consumes them.
 * Kept in a separate lib file to avoid circular imports between lib/auth.ts and app/api/.
 */

interface PendingToken {
  userId:    string;
  expiresAt: number;
}

const pendingTokens = new Map<string, PendingToken>();

export function createOtpSessionToken(userId: string): string {
  const token = crypto.randomUUID();
  pendingTokens.set(token, { userId, expiresAt: Date.now() + 2 * 60 * 1000 });
  return token;
}

export function consumeOtpSessionToken(token: string): string | null {
  const entry = pendingTokens.get(token);
  if (!entry || Date.now() > entry.expiresAt) {
    pendingTokens.delete(token);
    return null;
  }
  pendingTokens.delete(token);
  return entry.userId;
}

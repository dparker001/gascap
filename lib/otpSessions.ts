/**
 * Short-lived one-time session tokens issued after OTP verification.
 * Stored in the DB so they survive across serverless function instances.
 * TTL: 2 minutes — just long enough for signIn() to complete.
 */

import { prisma } from '@/lib/prisma';

export async function createOtpSessionToken(userId: string): Promise<string> {
  const token   = crypto.randomUUID();
  const expires = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  await prisma.user.update({
    where: { id: userId },
    data:  { otpSessionToken: token, otpSessionExpires: expires },
  });
  return token;
}

export async function consumeOtpSessionToken(token: string): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { otpSessionToken: token },
    select: { id: true, otpSessionExpires: true },
  });
  if (!user) return null;
  if (!user.otpSessionExpires || new Date(user.otpSessionExpires) < new Date()) return null;

  // Clear the token immediately (one-time use)
  await prisma.user.update({
    where: { id: user.id },
    data:  { otpSessionToken: null, otpSessionExpires: null },
  });
  return user.id;
}

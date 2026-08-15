/**
 * Server-side plan resolution for paid gates.
 *
 * Reads the plan from the DATABASE, not the JWT. NextAuth here is stateless —
 * the plan is baked into the token at sign-in, so a user who upgrades keeps a
 * 'free' token until it refreshes, and a user whose trial expired keeps a
 * 'pro' token. /api/ai/chat already worked around this by hand; anything that
 * gates real money should do the same, so it lives here once.
 *
 * Client-side isPro checks stay as they are — they drive UI affordances. This
 * is the check that actually decides.
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { findById, findByEmail } from '@/lib/users';

export interface LivePlan {
  userId: string | null;
  plan: string;
  isPro: boolean;
}

export async function getLivePlan(): Promise<LivePlan> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { userId: null, plan: 'free', isPro: false };

  const sessionUserId = (session.user as { id?: string }).id;
  const email = session.user.email ?? undefined;
  const stored = sessionUserId ? await findById(sessionUserId) : (email ? await findByEmail(email) : undefined);

  // Widened to string: the stored union is 'free'|'pro'|'fleet', but
  // 'lifetime' shows up as a plan string in some older records alongside the
  // stripeInterval='lifetime' representation. Treat all three as Pro.
  const plan: string = stored?.plan ?? 'free';
  const isPro = plan === 'pro' || plan === 'fleet' || plan === 'lifetime';

  return { userId: stored?.id ?? sessionUserId ?? null, plan, isPro };
}

/** Free-tier fill-up allowance, per calendar month. */
export const FREE_MONTHLY_FILLUP_LIMIT = 5;

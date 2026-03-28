/**
 * GET /api/referral — get the signed-in user's referral code and stats
 * Returns: { code, referralUrl, referralCount, proMonthsEarned, referredBy,
 *            maxReferrals, reachedCap, redeemableMonths, userPlan }
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { ensureReferralCode, findById } from '@/lib/users';

const MAX_REFERRAL_REWARDS = 10;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const code   = ensureReferralCode(userId);
  const user   = findById(userId);

  const baseUrl      = process.env.NEXTAUTH_URL ?? 'https://gascap.app';
  const referralUrl  = `${baseUrl}/signup?ref=${code}`;
  const plan         = user?.plan ?? 'free';
  const isPaid       = plan === 'pro' || plan === 'fleet';
  const monthsEarned = user?.referralProMonthsEarned ?? 0;

  return NextResponse.json({
    code,
    referralUrl,
    referralCount:    user?.referralCount          ?? 0,
    proMonthsEarned:  monthsEarned,
    referredBy:       user?.referredBy             ?? null,
    maxReferrals:     MAX_REFERRAL_REWARDS,
    reachedCap:       (user?.referralCount ?? 0) >= MAX_REFERRAL_REWARDS,
    // Only Pro / Fleet subscribers can share a referral link
    canRefer:         isPaid,
    // Months are only redeemable against a paid subscription
    redeemableMonths: isPaid ? monthsEarned : 0,
    userPlan:         plan,
  });
}

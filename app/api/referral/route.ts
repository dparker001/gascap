/**
 * GET /api/referral — get the signed-in user's referral code and stats
 * Returns: { code, referralUrl, referralCount, proMonthsEarned, referredBy,
 *            maxReferrals, reachedCap, canRefer, redeemableMonths, activeCredits,
 *            nextExpiryDate, userPlan }
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { ensureReferralCode, findById, getActiveCredits, getRedeemableMonths } from '@/lib/users';

const MAX_REFERRAL_REWARDS = 10;
const MAX_REDEEM_AT_ONCE   = 3;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const code   = ensureReferralCode(userId);
  const user   = findById(userId);

  const baseUrl      = process.env.NEXTAUTH_URL ?? 'https://www.gascap.app';
  const referralUrl  = `${baseUrl}/signup?ref=${code}`;
  const plan         = user?.plan ?? 'free';
  const isPaid       = plan === 'pro' || plan === 'fleet';
  const monthsEarned = user?.referralProMonthsEarned ?? 0;

  const activeCredits    = user ? getActiveCredits(user) : [];
  const redeemableMonths = user ? getRedeemableMonths(user) : 0;

  // Next expiry date — earliest expiring active credit
  const nextExpiryDate = activeCredits.length > 0
    ? activeCredits.sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())[0].expiresAt
    : null;

  const isBeta = user?.isBetaTester ?? false;
  const betaReferralUrl = isBeta ? `${baseUrl}/signup?ref=${code}&beta=1` : null;

  return NextResponse.json({
    code,
    referralUrl,
    betaReferralUrl,               // only set for beta testers
    isBeta,
    referralCount:    user?.referralCount ?? 0,
    proMonthsEarned:  monthsEarned,
    referredBy:       user?.referredBy    ?? null,
    maxReferrals:     MAX_REFERRAL_REWARDS,
    maxRedeemAtOnce:  MAX_REDEEM_AT_ONCE,
    reachedCap:       (user?.referralCount ?? 0) >= MAX_REFERRAL_REWARDS,
    canRefer:         true,            // all plans can refer
    activeCredits:    activeCredits.length,
    redeemableMonths,                  // capped at MAX_REDEEM_AT_ONCE, only if on Pro/Fleet
    nextExpiryDate,                    // ISO string of soonest-expiring credit
    userPlan:         plan,
    isPaid,
  });
}

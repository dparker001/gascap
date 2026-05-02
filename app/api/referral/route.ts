/**
 * GET /api/referral — get the signed-in user's referral code and stats
 * Returns: { code, referralUrl, referralCount, proMonthsEarned, referredBy,
 *            ambassadorTier, entryMultiplier, ambassadorProForLife, thresholds,
 *            canRefer, redeemableMonths, activeCredits, nextExpiryDate, userPlan }
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { ensureReferralCode, findById, findByReferralCode, getActiveCredits, getRedeemableMonths, getAllUsers } from '@/lib/users';
import { getAmbassadorTier, ambassadorEntryMultiplier, AMBASSADOR_THRESHOLDS } from '@/lib/ambassador';

const MAX_REDEEM_AT_ONCE = 3;

/** "John Doe" → "John D."  |  "John" → "John" */
function formatReferrerName(name: string | undefined | null): string | null {
  if (!name?.trim()) return null;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const [code, user] = await Promise.all([ensureReferralCode(userId), findById(userId)]);

  const baseUrl      = process.env.NEXTAUTH_URL ?? 'https://www.gascap.app';
  const referralUrl  = `${baseUrl}/signup?ref=${code}`;
  const plan         = user?.plan ?? 'free';
  const isPaid         = plan === 'pro' || plan === 'fleet';
  const monthsEarned   = user?.referralProMonthsEarned ?? 0;
  const refCount       = user?.referralCount ?? 0;
  const tier           = getAmbassadorTier(refCount);
  const multiplier     = ambassadorEntryMultiplier(refCount);

  const activeCredits    = user ? getActiveCredits(user) : [];
  const redeemableMonths = user ? getRedeemableMonths(user) : 0;

  // Next expiry date — earliest expiring active credit
  const nextExpiryDate = activeCredits.length > 0
    ? activeCredits.sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())[0].expiresAt
    : null;

  const isBeta = user?.isBetaTester ?? false;
  const betaReferralUrl = isBeta ? `${baseUrl}/signup?ref=${code}&beta=1` : null;

  // Look up the name of whoever referred this user (via their referral code)
  const referrer = user?.referredBy
    ? await findByReferralCode(user.referredBy)
    : undefined;
  const referredByName = formatReferrerName(referrer?.name);

  // Get list of users this person referred
  const allUsers    = await getAllUsers();
  const referredUsers = code
    ? allUsers
        .filter((u) => u.referredBy?.toUpperCase() === code.toUpperCase())
        .map((u) => ({
          name:      u.name,
          email:     u.email,
          joinedAt:  u.createdAt,
          verified:  u.emailVerified ?? false,
          credited:  u.referralRewardCredited ?? false,
        }))
    : [];

  return NextResponse.json({
    code,
    referralUrl,
    betaReferralUrl,
    isBeta,
    referralCount:       refCount,
    proMonthsEarned:     monthsEarned,
    referredBy:          user?.referredBy   ?? null,
    referredByName:      referredByName      ?? null,
    ambassadorTier:      tier,                        // 'supporter'|'ambassador'|'elite'|null
    entryMultiplier:     multiplier,                  // 1|2|3|5
    ambassadorProForLife: user?.ambassadorProForLife ?? false,
    thresholds:          AMBASSADOR_THRESHOLDS,       // expose for UI progress bars
    maxRedeemAtOnce:     MAX_REDEEM_AT_ONCE,
    canRefer:            true,
    activeCredits:       activeCredits.length,
    redeemableMonths,
    nextExpiryDate,
    userPlan:            plan,
    isPaid,
    referredUsers,
  });
}

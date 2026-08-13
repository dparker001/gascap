/**
 * POST /api/activity   — record a user action, evaluate badges, return new ones
 * GET  /api/activity   — return the current user's badge + streak summary
 */
import { NextResponse }    from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }     from '@/lib/auth';
import { findById, recordActivity, calcStreak, STREAK_MILESTONES, type ActivityEvent } from '@/lib/users';
import { prisma } from '@/lib/prisma';
import { BADGES, evaluateEarned, type BadgeDef } from '@/lib/badges';
import { getVehiclesForUser }     from '@/lib/savedVehicles';
import { streakBonusEntries }     from '@/lib/giveaway';
import { sendMail, streakMilestoneEmailHtml } from '@/lib/email';
import { sendApns, apnsConfigured } from '@/lib/apns';
import { sendDiningVoucher, sendHotelSavingsCard } from '@/lib/marketingBoost';

/** One-time Marketing Boost reward for streak milestones — 30/60/120/365 days only (7/14 are email-only nudges). */
const STREAK_VOUCHER_REWARD: Record<number, { kind: 'dining' | 'hotel'; amount: number; label: string }> = {
  30:  { kind: 'dining', amount: 25,  label: '$25 Dining Voucher' },
  60:  { kind: 'dining', amount: 50,  label: '$50 Dining Voucher' },
  120: { kind: 'hotel',  amount: 100, label: '$100 Hotel Savings Card' },
  365: { kind: 'hotel',  amount: 500, label: '$500 Hotel Savings Card' },
};

// ── GET — current badge state ─────────────────────────────────────────────
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const [user, vehicles] = await Promise.all([findById(userId), getVehiclesForUser(userId)]);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Accept ?localDate=YYYY-MM-DD so calcStreak uses the viewer's local day boundary
  const { searchParams } = new URL(req.url);
  const localDate = searchParams.get('localDate') ?? undefined;

  const vehicleCount = vehicles.length;
  const earned = user.badges ?? [];
  const now    = new Date();

  // Active (non-expired, non-redeemed) streak credits
  const activeStreakCredits = (user.streakCredits ?? []).filter(
    (c) => !c.redeemedAt && new Date(c.expiresAt) > now,
  );

  return NextResponse.json({
    badges:  earned,
    streak:  calcStreak(user.activeDays ?? [], localDate),
    stats: {
      calcCount:       user.calcCount       ?? 0,
      budgetCalcCount: user.budgetCalcCount ?? 0,
      locationLookups: user.locationLookups ?? 0,
      daysActive:      (user.activeDays ?? []).length,
      vehicleCount,
    },
    // Full catalogue with earned flag, so the client can render all badges
    catalogue: BADGES.map((b) => ({ ...b, earned: earned.includes(b.id) })),
    // Streak reward data
    streakMilestonesHit: user.streakMilestonesHit ?? [],
    streakCredits:       activeStreakCredits,
    streakMilestones:    STREAK_MILESTONES,
  });
}

// ── POST — record an event ────────────────────────────────────────────────
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  // Silently succeed for guests — no badges for unauthenticated users
  if (!session?.user) return NextResponse.json({ newBadges: [], badges: [], streak: 0 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';

  let event: ActivityEvent = 'visit';
  let localDate: string | undefined;
  let nativePlatform: 'ios' | 'android' | undefined;
  try {
    const body = await req.json() as { event?: string; localDate?: string; nativePlatform?: string };
    if (['calc', 'budget_calc', 'location_lookup', 'visit'].includes(body.event ?? '')) {
      event = body.event as ActivityEvent;
    }
    if (typeof body.localDate === 'string') localDate = body.localDate;
    if (body.nativePlatform === 'ios' || body.nativePlatform === 'android') {
      nativePlatform = body.nativePlatform;
    }
  } catch { /* empty body is fine */ }

  // Separate from signupPlatform (set once, at signup, never updated) — this is
  // how a user who signed up on web and later downloads the app becomes visible.
  // Non-blocking: a failure here shouldn't break streak/badge recording below.
  if (nativePlatform) {
    prisma.user.update({
      where: { id: userId },
      data:  { lastNativePlatform: nativePlatform, lastNativeAt: new Date().toISOString() },
    }).catch((e) => console.error('[activity] lastNativePlatform update failed:', e));
  }

  const result = await recordActivity(userId, event, localDate);

  // Resolve full badge objects for any newly earned badges
  const newBadgeDefs = result.newBadges.map((id) => BADGES.find((b) => b.id === id)).filter((b): b is BadgeDef => b !== undefined);

  // ── Streak milestone celebration emails ─────────────────────────────────
  // Fires non-blocking for each newly crossed milestone (rare — once per milestone per lifetime).
  if (result.newMilestonesHit.length > 0 && !result.emailOptOut && result.userEmail) {
    const milestoneDaysSorted = STREAK_MILESTONES.map((m) => m.days);
    void (async () => {
      // Native iOS push: fetch the stored token once for direct-APNs sends alongside each email.
      const userRecord = await findById(userId);
      const iosToken = (userRecord as { iosPushToken?: string | null } | undefined)?.iosPushToken;
      for (const days of result.newMilestonesHit) {
        try {
          const bonusEntries      = streakBonusEntries(days);
          const nextMilestoneDays = milestoneDaysSorted.find((d) => d > days) ?? null;
          const nextBonusEntries  = nextMilestoneDays ? streakBonusEntries(nextMilestoneDays) : null;

          const dayLabel = days >= 365 ? '1-year' : days >= 120 ? '120-day' : days >= 60 ? '60-day' : days >= 30 ? '30-day' : `${days}-day`;
          await sendMail({
            to:      result.userEmail,
            subject: `${days >= 30 ? '🏆' : '📅'} You hit a ${dayLabel} streak on GasCap™!`,
            html:    streakMilestoneEmailHtml(
              result.userName,
              days,
              bonusEntries,
              nextMilestoneDays,
              nextBonusEntries,
              result.plan === 'free' ? 'trial' : result.plan,
            ),
            text: `Congrats on your ${dayLabel} streak, ${result.userName}! You now earn +${bonusEntries} bonus draw entries every month you keep the streak alive. Keep going — open GasCap™ daily to protect it. gascap.app`,
          });
          console.log(`[Activity] Milestone email sent → ${result.userEmail} (${days} days)`);
          // Direct-APNs push to native iOS users (non-blocking, like the email).
          if (iosToken && apnsConfigured()) {
            void sendApns(iosToken, `📅 ${days}-day streak!`, `You hit a ${days}-day GasCap™ streak — keep it going for bonus giveaway entries!`).catch(() => {});
          }

          // ── One-time Marketing Boost voucher reward (30/90/180/365-day tiers only) ──
          // Pro/Fleet only (trial counts — trial users have plan='pro') — matches the
          // existing giveaway-entries eligibility gate. Free users never get a real
          // paid voucher: streak tracking itself is universal, but the real-money
          // reward should not be farmable via free accounts that never convert.
          // Safe from duplicate sends: streakMilestonesHit (persisted on the user)
          // guarantees `days` only ever appears in newMilestonesHit once per user.
          const voucherReward = (result.plan === 'pro' || result.plan === 'fleet') ? STREAK_VOUCHER_REWARD[days] : undefined;
          if (voucherReward) {
            const voucherResult = voucherReward.kind === 'dining'
              ? await sendDiningVoucher({ fullName: result.userName, email: result.userEmail, amount: voucherReward.amount as 25 | 50 | 100 | 200, message: `Congrats on your ${dayLabel} GasCap™ streak!` })
              : await sendHotelSavingsCard({ fullName: result.userName, email: result.userEmail, amount: voucherReward.amount as 100 | 200 | 300 | 500, message: `Congrats on your ${dayLabel} GasCap™ streak!` });
            if (voucherResult.ok) {
              await sendMail({
                to:      result.userEmail,
                subject: `🎁 Your ${dayLabel} streak reward: ${voucherReward.label}!`,
                html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
                  <p style="font-size:20px;margin:0 0 8px;">🎁 Congratulations, ${result.userName}!</p>
                  <p style="font-size:15px;color:#334155;margin:0 0 12px;">Your <strong>${dayLabel} streak</strong> just earned you a <strong>${voucherReward.label}</strong> — check your inbox (and spam folder) over the next 24 hours for an email from Parker Select Rewards.</p>
                  <p style="font-size:13px;color:#64748b;margin:0;">Questions? Reply to this email.</p>
                </div>`,
                text: `Congrats, ${result.userName}! Your ${dayLabel} streak earned you a ${voucherReward.label} — on its way from Parker Select Rewards within 24 hours.`,
              }).catch((e) => console.error(`[Activity] streak voucher confirmation email failed for ${result.userEmail}:`, e));
              console.log(`[Activity] Streak voucher sent → ${result.userEmail} (${days} days, ${voucherReward.label})`);
            } else {
              console.error(`[Activity] Streak voucher send failed for ${result.userEmail} (${days} days):`, voucherResult.error);
            }
          }
        } catch (err) {
          console.error(`[Activity] Milestone email failed for ${result.userEmail} (${days} days):`, err);
        }
      }
    })();
  }

  return NextResponse.json({
    newBadges:        newBadgeDefs,
    badges:           result.badges,
    streak:           result.streak,
    newMilestonesHit: result.newMilestonesHit,
    firstCalcBonusGranted: result.firstCalcBonusGranted ?? false,
  });
}

/**
 * GET /api/cron/first-fillup-nudge
 *
 * Re-engagement for the sharpest drop-off in the funnel: users who saved a
 * vehicle but have never logged a fill-up.
 *
 * Why this group. Of 237 users, 78 saved a vehicle and only 7 ever logged a
 * fill-up. Saving a vehicle is real intent — they typed in their car — so these
 * aren't idle signups, they're people who set up and then didn't come back.
 * Every other retention job we run requires prior engagement to fire (a streak
 * to remind about, a logging cadence to nudge, 45 days of a paid subscription),
 * so nothing spoke to them at all.
 *
 * Email + push, once per user, ever. Push is the point — it's free, and it only
 * started working on Android after the 2026-08-05 Dockerfile fix, so most of
 * this group has never actually been reachable that way.
 *
 * Secured with CRON_SECRET. ?dryRun=true previews the audience without sending
 * and without marking anyone as nudged.
 */
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/prisma';
import { sendMail }     from '@/lib/email';
import { sendUserPush } from '@/lib/userPush';
import { firstFillupNudgeEmailHtml, firstFillupNudgeEmailText } from '@/lib/emailCampaign';

/** Give people a few days to log one on their own before nudging. */
const MIN_AGE_DAYS = 3;

/**
 * Cap per run. Sends are sequential and GitHub Actions calls this with
 * `curl --max-time 30`; an unbounded run would time out and report failure
 * while the server kept going. Also keeps send volume from spiking on a
 * domain that normally sends very little. Remainder rolls to tomorrow.
 */
const MAX_PER_RUN = 40;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!process.env.CRON_SECRET || searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dryRun = searchParams.get('dryRun') === 'true';

  const cutoff = new Date(Date.now() - MIN_AGE_DAYS * 86_400_000).toISOString();

  // Fillup has no Prisma relation to User — only a raw userId column — so the
  // "never logged one" half can't be expressed as a nested filter. Adding the
  // relation would mean a foreign-key migration for no functional gain, so
  // exclude by id instead. The set is small (7 users have ever logged a
  // fill-up) and this runs once a day.
  const loggers = await prisma.fillup.findMany({
    distinct: ['userId'],
    select:   { userId: true },
  });
  const loggerIds = loggers.map((f) => f.userId);

  const candidates = await prisma.user.findMany({
    where: {
      emailOptOut:          false,
      firstFillupNudgedAt:  null,              // once per user, ever
      createdAt:            { lte: cutoff },
      vehicles:             { some: {} },      // showed intent
      id:                   { notIn: loggerIds },
    },
    select: { id: true, email: true, name: true, displayName: true },
    take: dryRun ? 500 : MAX_PER_RUN,
  });

  if (dryRun) {
    return NextResponse.json({
      ok: true, dryRun: true,
      audience: candidates.length,
      sample:   candidates.slice(0, 8).map((u) => u.email),
      ranAt:    new Date().toISOString(),
    });
  }

  let sent = 0, failed = 0;

  for (const u of candidates) {
    const firstName = (u.displayName || u.name || 'there').split(' ')[0];
    try {
      await sendMail({
        to:             u.email,
        subject:        `${firstName}, your GasCap™ garage is set up — here's the payoff`,
        html:           firstFillupNudgeEmailHtml(firstName, u.id),
        text:           firstFillupNudgeEmailText(firstName),
        unsubscribeUrl: `https://www.gascap.app/api/email/unsubscribe?id=${u.id}`,
      });
      sent++;

      // Fire-and-forget by design: a push failure must never cost us the email
      // send or leave the user un-marked and eligible again tomorrow. Awaiting
      // it would also add a round-trip per user, and at MAX_PER_RUN on top of
      // the email sends that risks the 30s cron timeout. Deliberately not
      // counted in the response — the promise resolves after we've replied, so
      // any tally here would be misleading. Delivery is visible in OneSignal.
      void sendUserPush(
        u.id,
        '⛽ Log your first fill-up',
        'Takes 20 seconds and unlocks your MPG, cost per mile, and spending trends.',
        '/?log=1',
      ).catch(() => {});

      await prisma.user.update({
        where: { id: u.id },
        data:  { firstFillupNudgedAt: new Date().toISOString() },
      });
    } catch (err) {
      failed++;
      console.error(`[first-fillup-nudge] failed for ${u.email}:`, err);
    }
  }

  console.log(`[first-fillup-nudge] sent=${sent} failed=${failed}`);
  return NextResponse.json({ ok: true, sent, failed, ranAt: new Date().toISOString() });
}

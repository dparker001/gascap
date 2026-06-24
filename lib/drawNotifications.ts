/**
 * fireDrawNotifications — shared by admin sweepstakes route and the auto-draw cron.
 *
 * Fires four side-effects for a recorded giveaway draw:
 *  1. Branded winner notification email
 *  2. Non-winner results emails (to all eligible entrants)
 *  3. GHL contact upsert (winner tagged for CRM follow-up)
 *  4. GHL webhook POST (VA follow-up workflow trigger)
 *
 * Tremendous card delivery is intentionally NOT here — it runs separately
 * (PATCH in admin, or auto-confirm step in the draw cron) so the card is only
 * issued once we're confident the winner is real and reachable.
 */
import { getEligibleEntrants, formatPeriodLabel, nextPeriodLabel } from '@/lib/giveaway';
import { sendMail, winnerNotificationEmailHtml, nonWinnerNotificationEmailHtml } from '@/lib/email';
import { findById } from '@/lib/users';
import { sendApns, apnsConfigured } from '@/lib/apns';
import { prisma } from '@/lib/prisma';

export async function fireDrawNotifications(opts: {
  period:       string;   // draw period key, e.g. "2026-W27" or "2026-06"
  winner:       { userId: string; name: string; email: string; entryCount: number };
  totalEntries: number;
  drawnAt:      string;
  notes:        string | null;
  prize:        string;   // e.g. "$25"
  suppressSms:  boolean;
}): Promise<void> {
  const { period, winner, totalEntries, drawnAt, notes, prize, suppressSms } = opts;
  const periodLabel   = formatPeriodLabel(period);
  const nextDrawLabel = nextPeriodLabel(period);
  const webhookUrl    = process.env.GHL_WINNER_WEBHOOK_URL;

  // Anonymised winner label for non-winner emails: "Madlon P."
  const [wFirst, ...wRest] = winner.name.trim().split(' ');
  const wLastInitial = wRest.length > 0 ? ` ${wRest[wRest.length - 1][0]}.` : '';
  const winnerLabel  = `${wFirst}${wLastInitial}`;

  const allEntrants = await getEligibleEntrants(period);
  const nonWinners  = allEntrants.filter((e) => e.userId !== winner.userId);

  const winnerUser     = await findById(winner.userId).catch(() => null);
  const winnerPhone    = winnerUser?.phone?.trim() || '';
  const winnerSmsOptIn = winnerUser?.smsOptIn === true;

  await Promise.allSettled([
    // 1. Branded winner email
    sendMail({
      to:      winner.email,
      subject: `🏆 You won the ${periodLabel} GasCap™ Gas Card!`,
      html:    winnerNotificationEmailHtml(winner.name, period, winner.entryCount, totalEntries, prize),
      text: [
        `Congratulations ${winner.name}!`,
        `You won the ${periodLabel} GasCap™ Gas Card Giveaway (${prize}).`,
        `Your ${prize} Visa prepaid card will be sent within 7 days.`,
        `Reply to confirm receipt or email support@gascap.app with questions.`,
        `You must respond within 3 days to claim your prize.`,
      ].join('\n\n'),
    }).catch((err) => console.error('[draw] winner email failed:', err)),

    // 1b. iOS push to winner only
    (async () => {
      if (!apnsConfigured()) return;
      const wu = await prisma.user.findUnique({
        where:  { email: winner.email },
        select: { iosPushToken: true },
      }).catch(() => null);
      const iosToken = wu?.iosPushToken;
      if (iosToken) {
        await sendApns(
          iosToken,
          '🎉 You won!',
          `Congrats — you won this week's GasCap™ gas-card giveaway! Check your email to claim your prize.`,
        ).catch(() => {});
      }
    })(),

    // 2. Non-winner results emails — staggered to avoid burst limits
    (async () => {
      for (const entrant of nonWinners) {
        await sendMail({
          to:      entrant.email,
          subject: `${periodLabel} Drawing Results — GasCap™`,
          html:    nonWinnerNotificationEmailHtml(
                     entrant.name.split(' ')[0] ?? entrant.name,
                     winnerLabel, period, entrant.entryCount, totalEntries,
                     nextDrawLabel, entrant.plan, prize,
                   ),
          text: [
            `Hi ${entrant.name.split(' ')[0] ?? entrant.name},`,
            `The ${periodLabel} GasCap™ drawing just wrapped — congratulations to ${winnerLabel} who won the ${prize} Visa prepaid card!`,
            `You had ${entrant.entryCount} ${entrant.entryCount === 1 ? 'entry' : 'entries'}.`,
            `To earn more entries: open GasCap™ every day (1 entry/day) and build your streak for bonus entries.`,
            `Open the app: https://gascap.app`,
          ].join('\n\n'),
        }).catch((err) =>
          console.error(`[draw] non-winner email failed for ${entrant.email}:`, err),
        );
        await new Promise((r) => setTimeout(r, 200));
      }
    })(),

    // 3. GHL — upsert winner contact
    (() => {
      const ghlKey     = process.env.GHL_API_KEY;
      const locationId = process.env.GHL_LOCATION_ID ?? 'CvoeirX6lIeXP021VqmY';
      if (!ghlKey) {
        console.warn('[draw] GHL_API_KEY not set — skipping GHL contact upsert');
        return Promise.resolve();
      }
      const [wFn, ...wLn]  = winner.name.trim().split(' ');
      const winnerTagName  = `gascap-sweepstakes-winner-${periodLabel.toLowerCase().replace(/[\s–—]+/g, '-')}`;
      return fetch('https://services.leadconnectorhq.com/contacts/upsert', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${ghlKey}`,
          'Content-Type':  'application/json',
          'Version':       '2021-07-28',
        },
        body: JSON.stringify({
          locationId,
          email:     winner.email,
          firstName: wFn,
          lastName:  wLn.join(' '),
          ...(winnerPhone ? { phone: winnerPhone } : {}),
          tags: [
            'giveaway-winner',
            winnerTagName,
            ...(winnerSmsOptIn ? ['gascap-sms-optin'] : []),
          ],
          source: 'GasCap Sweepstakes',
        }),
      })
        .then(async (r) => {
          if (!r.ok) console.error('[draw] GHL contact upsert failed:', await r.text());
          else       console.log(`[draw] GHL contact upserted for winner ${winner.email}`);
        })
        .catch((err) => console.error('[draw] GHL contact upsert fetch failed:', err));
    })(),

    // 4. GHL webhook → VA follow-up workflow
    webhookUrl
      ? fetch(webhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName:    winner.name.split(' ')[0] ?? winner.name,
            lastName:     winner.name.split(' ').slice(1).join(' ') ?? '',
            email:        winner.email,
            phone:        winnerPhone,
            smsOptIn:     winnerSmsOptIn,
            period,
            periodLabel,
            entryCount:   winner.entryCount,
            totalEntries,
            prize,
            drawnAt,
            notes:        notes ?? '',
            winnerTag:    `gascap-sweepstakes-winner-${periodLabel.toLowerCase().replace(/[\s–—]+/g, '-')}`,
            alternateTag: `gascap-sweepstakes-alternate-${periodLabel.toLowerCase().replace(/[\s–—]+/g, '-')}`,
            sendSms:      !suppressSms,
          }),
        }).catch((err) => console.error('[draw] GHL webhook failed:', err))
      : Promise.resolve(),
  ]);
}

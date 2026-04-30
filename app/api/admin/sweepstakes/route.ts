/**
 * Admin Sweepstakes API — protected by ADMIN_PASSWORD
 * GET  /api/admin/sweepstakes?month=YYYY-MM  — preview entrants
 * GET  /api/admin/sweepstakes?history=1      — past draw results
 * POST /api/admin/sweepstakes                — run draw { month, notes?, dryRun?, suppressWinnerEmail? }
 *
 * After a successful draw the route fires four fire-and-forget side-effects:
 *  1. Winner notification email  (via lib/email.ts → SMTP or Resend)
 *     Skipped if suppressWinnerEmail = true
 *  2. Non-winner results email   (sent to all eligible entrants who didn't win)
 *  3. Tremendous API             (TREMENDOUS_API_KEY + TREMENDOUS_CAMPAIGN_ID env vars)
 *     → delivers a Visa prepaid card directly to the winner's email
 *     Skipped if suppressWinnerEmail = true
 *  4. GHL webhook POST           (GHL_WINNER_WEBHOOK_URL env var)
 *     → triggers a GHL workflow for any additional VA follow-up tasks
 */
import { NextResponse } from 'next/server';
import {
  getEligibleEntrants,
  runWeightedDraw,
  recordDraw,
  getDrawHistory,
  currentMonth,
  getCurrentPrizeTier,
} from '@/lib/giveaway';
import { sendMail, winnerNotificationEmailHtml, nonWinnerNotificationEmailHtml } from '@/lib/email';

/** "YYYY-MM" → "April 2026" */
function fmtMonth(m: string): string {
  const [y, mo] = m.split('-');
  const names = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  return `${names[parseInt(mo, 10) - 1]} ${y}`;
}

function auth(req: Request): 'ok' | 'no-env' | 'wrong' {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return 'no-env';
  return req.headers.get('x-admin-password') === pw ? 'ok' : 'wrong';
}

export async function GET(req: Request) {
  const _auth = auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized'  }, { status: 401 });

  const url = new URL(req.url);

  // History mode
  if (url.searchParams.get('history') === '1') {
    const draws = await getDrawHistory();
    return NextResponse.json({ draws });
  }

  // Entrant preview
  const month = url.searchParams.get('month') ?? currentMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM.' }, { status: 400 });
  }

  const [entrants, tierInfo] = await Promise.all([
    getEligibleEntrants(month),
    getCurrentPrizeTier(),
  ]);
  const totalEntries = entrants.reduce((s, e) => s + e.entryCount, 0);
  return NextResponse.json({
    month,
    entrants,
    totalEntries,
    entrantCount:    entrants.length,
    prize:           tierInfo.currentTier.prize,
    subscriberCount: tierInfo.subscriberCount,
    currentTier:     tierInfo.currentTier,
    nextTier:        tierInfo.nextTier,
  });
}

export async function POST(req: Request) {
  const _auth = auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized'  }, { status: 401 });

  const body                = await req.json() as { month?: string; notes?: string; dryRun?: boolean; suppressWinnerEmail?: boolean };
  const month               = body.month ?? currentMonth();
  const dryRun              = body.dryRun === true;
  const suppressWinnerEmail = body.suppressWinnerEmail === true;

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM.' }, { status: 400 });
  }

  try {
    const result = await runWeightedDraw(month);

    // ── Dry run — return the simulated winner without saving or notifying ─
    if (dryRun) {
      const { currentTier } = await getCurrentPrizeTier();
      return NextResponse.json({
        ok:     true,
        dryRun: true,
        winner: {
          name:         result.winner.name,
          email:        result.winner.email,
          entryCount:   result.winner.entryCount,
          totalEntries: result.totalEntries,
          prize:        currentTier.prize,
          month,
        },
      });
    }
    // ─────────────────────────────────────────────────────────────────────

    const draw   = await recordDraw(result, body.notes);

    // ── Fire-and-forget notifications ────────────────────────────────────
    // Neither failure should roll back or block the draw response.
    const monthLabel  = fmtMonth(month);
    const { currentTier } = await getCurrentPrizeTier();
    const prize       = currentTier.prize;   // scales automatically with subscriber count
    const webhookUrl  = process.env.GHL_WINNER_WEBHOOK_URL;

    // Build the anonymised winner label for non-winner emails:
    // "Madlon P. — Orlando, FL"  (first name + last initial — city comes from
    // the notes field if provided, otherwise omitted)
    const [wFirst, ...wRest] = result.winner.name.trim().split(' ');
    const wLastInitial = wRest.length > 0 ? ` ${wRest[wRest.length - 1][0]}.` : '';
    const winnerLabel = `${wFirst}${wLastInitial}`;

    // "May 2026" → next month label for the "next drawing" prompt
    const [mYear, mMo] = month.split('-').map(Number);
    const nextMo   = mMo === 12 ? 1 : mMo + 1;
    const nextYear = mMo === 12 ? mYear + 1 : mYear;
    const MONTH_NAMES = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December',
    ];
    const nextDrawMonth = `${MONTH_NAMES[nextMo - 1]} ${nextYear}`;

    // Fetch all entrants for the non-winner batch (already computed in draw)
    const allEntrants = await getEligibleEntrants(month);
    const nonWinners  = allEntrants.filter((e) => e.userId !== result.winner.userId);

    void Promise.allSettled([
      // 1. Branded winner email (skipped if suppressWinnerEmail is true)
      suppressWinnerEmail
        ? Promise.resolve()
        : sendMail({
        to:      result.winner.email,
        subject: `🏆 You won the ${monthLabel} GasCap™ Gas Card!`,
        html:    winnerNotificationEmailHtml(
                   result.winner.name,
                   month,
                   result.winner.entryCount,
                   result.totalEntries,
                   prize,
                 ),
        text: [
          `Congratulations ${result.winner.name}!`,
          `You won the ${monthLabel} GasCap™ Gas Card Giveaway (${prize}).`,
          `Your ${prize} Visa prepaid card — use it at the pump or anywhere Visa is accepted — will be sent within 7 days.`,
          `Reply to confirm receipt or email support@gascap.app with questions.`,
          `You must respond within 14 days to claim your prize.`,
        ].join('\n\n'),
      }).catch((err) => console.error('[sweepstakes] winner email failed:', err)),

      // 2. Non-winner results emails — staggered 200 ms apart to avoid burst limits
      (async () => {
        for (const entrant of nonWinners) {
          await sendMail({
            to:      entrant.email,
            subject: `${monthLabel} Drawing Results — GasCap™`,
            html:    nonWinnerNotificationEmailHtml(
                       entrant.name.split(' ')[0] ?? entrant.name,
                       winnerLabel,
                       month,
                       entrant.entryCount,
                       result.totalEntries,
                       nextDrawMonth,
                       entrant.plan,
                       prize,
                     ),
            text: [
              `Hi ${entrant.name.split(' ')[0] ?? entrant.name},`,
              `The ${monthLabel} GasCap™ drawing just wrapped — congratulations to ${winnerLabel} who won the ${prize} Visa prepaid card!`,
              `You had ${entrant.entryCount} ${entrant.entryCount === 1 ? 'entry' : 'entries'} this month.`,
              `To earn more entries for ${nextDrawMonth}: open GasCap™ every day (1 entry/day, up to 31), and build your streak for bonus entries (7 days = +2, 30 days = +5, 90 days = +10).`,
              `Next drawing is on or about the 5th of ${nextDrawMonth}.`,
              `Open the app: https://gascap.app`,
            ].join('\n\n'),
          }).catch((err) =>
            console.error(`[sweepstakes] non-winner email failed for ${entrant.email}:`, err),
          );
          await new Promise((r) => setTimeout(r, 200));
        }
      })(),

      // 3. Tremendous API — deliver Visa prepaid card directly to winner
      //    Skipped if suppressWinnerEmail is true (manual fulfillment mode)
      //    Prize string is "$25", "$50", etc. — parse the number for the API
      (() => {
        if (suppressWinnerEmail) return Promise.resolve();
        const tremendousKey        = process.env.TREMENDOUS_API_KEY;
        const tremendousCampaignId = process.env.TREMENDOUS_CAMPAIGN_ID;
        if (!tremendousKey || !tremendousCampaignId) {
          console.warn('[sweepstakes] Tremendous env vars not set — skipping reward delivery');
          return Promise.resolve();
        }
        const denomination = parseFloat(prize.replace(/[^0-9.]/g, ''));
        if (isNaN(denomination) || denomination <= 0) {
          console.warn('[sweepstakes] Could not parse prize amount from:', prize);
          return Promise.resolve();
        }
        return fetch('https://www.tremendous.com/api/v2/orders', {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${tremendousKey}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            payment: { funding_source_id: 'BALANCE' },
            rewards: [{
              campaign_id: tremendousCampaignId,
              recipient: {
                name:  result.winner.name,
                email: result.winner.email,
              },
              value: {
                denomination,
                currency_code: 'USD',
              },
            }],
          }),
        })
          .then(async (r) => {
            if (!r.ok) {
              const err = await r.text();
              console.error('[sweepstakes] Tremendous API error:', err);
            } else {
              console.log(`[sweepstakes] Tremendous reward sent to ${result.winner.email} (${prize})`);
            }
          })
          .catch((err) => console.error('[sweepstakes] Tremendous fetch failed:', err));
      })(),

      // 4. GHL webhook → VA follow-up workflow
      webhookUrl
        ? fetch(webhookUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              firstName:    result.winner.name.split(' ')[0] ?? result.winner.name,
              lastName:     result.winner.name.split(' ').slice(1).join(' ') ?? '',
              email:        result.winner.email,
              phone:        '',        // not stored — VA can follow up
              month,
              monthLabel,
              entryCount:   result.winner.entryCount,
              totalEntries: result.totalEntries,
              prize,
              drawnAt:      draw.drawnAt,
              notes:        draw.notes ?? '',
              // GHL tag fields — use these directly in your workflow
              // Primary winner tag, e.g. "gascap-sweepstakes-winner-april-2026"
              winnerTag:    `gascap-sweepstakes-winner-${monthLabel.toLowerCase().replace(' ', '-')}`,
              // Alternate winner tag if primary forfeits within 14 days
              alternateTag: `gascap-sweepstakes-alternate-${monthLabel.toLowerCase().replace(' ', '-')}`,
            }),
          }).catch((err) => console.error('[sweepstakes] GHL webhook failed:', err))
        : Promise.resolve(),
    ]);
    // ─────────────────────────────────────────────────────────────────────

    return NextResponse.json({ ok: true, draw });
  } catch (err) {
    const msg = String(err);
    // Unique constraint = draw already run for this month
    if (msg.includes('Unique constraint')) {
      const history = await getDrawHistory();
      const existing = history.find((d) => d.month === month);
      return NextResponse.json(
        { error: `Draw already run for ${month}.`, existing },
        { status: 409 },
      );
    }
    if (msg.includes('No eligible entrants')) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    console.error('[sweepstakes] draw error:', err);
    return NextResponse.json({ error: 'Draw failed.' }, { status: 500 });
  }
}

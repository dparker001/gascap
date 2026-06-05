/**
 * Admin Sweepstakes API — protected by ADMIN_PASSWORD
 * GET   /api/admin/sweepstakes?month=YYYY-MM  — preview entrants
 * GET   /api/admin/sweepstakes?history=1      — past draw results
 * POST  /api/admin/sweepstakes                — run draw { month, notes?, dryRun?, suppressWinnerEmail?, suppressSms? }
 * PUT   /api/admin/sweepstakes?month=YYYY-MM  — alternate draw after forfeiture
 * PATCH /api/admin/sweepstakes?month=YYYY-MM  — mark winner confirmed → fires Tremendous card delivery
 *
 * After a successful draw (POST/PUT) the route fires four fire-and-forget side-effects:
 *  1. Winner notification email  (via lib/email.ts → SMTP or Resend)
 *     Skipped if suppressWinnerEmail = true
 *  2. Non-winner results email   (sent to all eligible entrants who didn't win)
 *  3. GHL contact upsert         (GHL_API_KEY env var)
 *     → creates/updates the winner as a GHL contact with winner tags
 *     → ensures GHL workflows and VA follow-up can fire automatically
 *  4. GHL webhook POST           (GHL_WINNER_WEBHOOK_URL env var)
 *     → triggers a GHL workflow for any additional VA follow-up tasks
 *
 * Tremendous card delivery fires on PATCH (mark winner confirmed), NOT at draw time.
 * This prevents unredeemed rewards from being issued to winners who forfeit or are
 * unreachable — cancellation within Tremendous is not guaranteed once a reward is sent.
 */
import { NextResponse } from 'next/server';
import {
  getEligibleEntrants,
  runWeightedDraw,
  runAlternateWeightedDraw,
  recordDraw,
  updateDrawWinner,
  getDrawHistory,
  currentMonth,
  getCurrentPrizeTier,
  markWinnerClaimed,
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
    trialCount:      tierInfo.trialCount,
    currentTier:     tierInfo.currentTier,
    nextTier:        tierInfo.nextTier,
  });
}

export async function POST(req: Request) {
  const _auth = auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized'  }, { status: 401 });

  const body                = await req.json() as { month?: string; notes?: string; dryRun?: boolean; suppressWinnerEmail?: boolean; suppressSms?: boolean };
  const month               = body.month ?? currentMonth();
  const dryRun              = body.dryRun === true;
  const suppressWinnerEmail = body.suppressWinnerEmail === true;
  const suppressSms         = body.suppressSms === true;

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
          loginCount:   result.winner.loginCount,
          lastLoginAt:  result.winner.lastLoginAt,
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
          `You must respond within 3 days to claim your prize.`,
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

      // 3. Tremendous — intentionally NOT fired here.
      //    Card delivery is deferred to PATCH (mark winner confirmed) so we never
      //    issue a reward to a winner who forfeits or cannot be reached.
      //    See PATCH handler below.
      Promise.resolve(),

      // 4. GHL — upsert winner as a contact so workflows & follow-up can fire
      //    Uses the same PIT token stored in GHL_API_KEY.
      //    Idempotent: if the contact already exists it is updated, not duplicated.
      (() => {
        const ghlKey    = process.env.GHL_API_KEY;
        const locationId = process.env.GHL_LOCATION_ID ?? 'CvoeirX6lIeXP021VqmY';
        if (!ghlKey) {
          console.warn('[sweepstakes] GHL_API_KEY not set — skipping GHL contact upsert');
          return Promise.resolve();
        }
        const [wFn, ...wLn] = result.winner.name.trim().split(' ');
        const winnerTagName = `gascap-sweepstakes-winner-${monthLabel.toLowerCase().replace(/\s+/g, '-')}`;
        return fetch('https://services.leadconnectorhq.com/contacts/upsert', {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${ghlKey}`,
            'Content-Type':  'application/json',
            'Version':       '2021-07-28',
          },
          body: JSON.stringify({
            locationId,
            email:     result.winner.email,
            firstName: wFn,
            lastName:  wLn.join(' '),
            tags:      ['giveaway-winner', winnerTagName],
            source:    'GasCap Sweepstakes',
          }),
        })
          .then(async (r) => {
            if (!r.ok) {
              const err = await r.text();
              console.error('[sweepstakes] GHL contact upsert failed:', err);
            } else {
              console.log(`[sweepstakes] GHL contact upserted for winner ${result.winner.email}`);
            }
          })
          .catch((err) => console.error('[sweepstakes] GHL contact upsert fetch failed:', err));
      })(),

      // 5. GHL webhook → VA follow-up workflow
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
              // Alternate winner tag if primary forfeits within 3 days
              alternateTag: `gascap-sweepstakes-alternate-${monthLabel.toLowerCase().replace(' ', '-')}`,
              // SMS flag — GHL workflow should only send winner SMS when this is true
              sendSms:      !suppressSms,
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

/**
 * PUT /api/admin/sweepstakes?month=YYYY-MM — alternate winner draw after forfeiture
 *
 * Fires when the original winner fails to claim within 3 days.
 * Excludes the forfeited winner, re-draws from remaining eligible entrants,
 * updates the DB record, and fires all standard notifications for the new winner.
 *
 * Optional body: { suppressWinnerEmail?: boolean, suppressSms?: boolean, notes?: string }
 */
export async function PUT(req: Request) {
  const _auth = auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized'  }, { status: 401 });

  const month = new URL(req.url).searchParams.get('month');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Valid month required (YYYY-MM)' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({})) as {
    suppressWinnerEmail?: boolean;
    suppressSms?:         boolean;
    notes?:               string;
  };
  const suppressWinnerEmail = body.suppressWinnerEmail === true;
  const suppressSms         = body.suppressSms         === true;

  // Load existing draw — must exist to have a forfeited winner to exclude
  const history    = await getDrawHistory();
  const existingDraw = history.find((d) => d.month === month);
  if (!existingDraw) {
    return NextResponse.json(
      { error: `No existing draw found for ${month}. Run the initial draw first.` },
      { status: 404 },
    );
  }
  if (existingDraw.claimedAt) {
    return NextResponse.json(
      { error: `The ${month} winner already claimed their prize — alternate draw not allowed.` },
      { status: 409 },
    );
  }

  try {
    const result = await runAlternateWeightedDraw(month, existingDraw.winnerId);

    const draw = await updateDrawWinner(
      month,
      result,
      { name: existingDraw.winnerName, email: existingDraw.winnerEmail },
      body.notes,
    );

    // ── Fire-and-forget notifications (same as initial draw) ─────────────
    const monthLabel  = fmtMonth(month);
    const { currentTier } = await getCurrentPrizeTier();
    const prize       = currentTier.prize;
    const webhookUrl  = process.env.GHL_WINNER_WEBHOOK_URL;

    const [wFirst, ...wRest] = result.winner.name.trim().split(' ');
    const wLastInitial = wRest.length > 0 ? ` ${wRest[wRest.length - 1][0]}.` : '';
    const winnerLabel  = `${wFirst}${wLastInitial}`;

    const [mYear, mMo] = month.split('-').map(Number);
    const nextMo   = mMo === 12 ? 1 : mMo + 1;
    const nextYear = mMo === 12 ? mYear + 1 : mYear;
    const MONTH_NAMES = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December',
    ];
    const nextDrawMonth = `${MONTH_NAMES[nextMo - 1]} ${nextYear}`;

    const allEntrants = await getEligibleEntrants(month);
    const nonWinners  = allEntrants.filter(
      (e) => e.userId !== result.winner.userId && e.userId !== existingDraw.winnerId,
    );

    void Promise.allSettled([
      // 1. Winner email
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
              `Your ${prize} Visa prepaid card will be sent within 7 days.`,
              `Reply to confirm receipt or email support@gascap.app with questions.`,
              `You must respond within 3 days to claim your prize.`,
            ].join('\n\n'),
          }).catch((err) => console.error('[sweepstakes/alternate] winner email failed:', err)),

      // 2. Non-winner emails (skip the forfeited winner too)
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
              `The ${monthLabel} GasCap™ drawing has a new winner — congratulations to ${winnerLabel} who won the ${prize} Visa prepaid card!`,
              `You had ${entrant.entryCount} ${entrant.entryCount === 1 ? 'entry' : 'entries'} this month.`,
              `Next drawing is on or about the 5th of ${nextDrawMonth}. Open the app: https://gascap.app`,
            ].join('\n\n'),
          }).catch((err) =>
            console.error(`[sweepstakes/alternate] non-winner email failed for ${entrant.email}:`, err),
          );
          await new Promise((r) => setTimeout(r, 200));
        }
      })(),

      // 3. Tremendous — intentionally NOT fired here.
      //    Card delivery is deferred to PATCH (mark winner confirmed).
      //    See PATCH handler below.
      Promise.resolve(),

      // 4. GHL contact upsert for new winner
      (() => {
        const ghlKey     = process.env.GHL_API_KEY;
        const locationId = process.env.GHL_LOCATION_ID ?? 'CvoeirX6lIeXP021VqmY';
        if (!ghlKey) return Promise.resolve();
        const [wFn, ...wLn] = result.winner.name.trim().split(' ');
        const winnerTagName = `gascap-sweepstakes-winner-${monthLabel.toLowerCase().replace(/\s+/g, '-')}`;
        return fetch('https://services.leadconnectorhq.com/contacts/upsert', {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${ghlKey}`,
            'Content-Type':  'application/json',
            'Version':       '2021-07-28',
          },
          body: JSON.stringify({
            locationId,
            email:     result.winner.email,
            firstName: wFn,
            lastName:  wLn.join(' '),
            tags:      ['giveaway-winner', winnerTagName],
            source:    'GasCap Sweepstakes',
          }),
        })
          .then(async (r) => {
            if (!r.ok) console.error('[sweepstakes/alternate] GHL upsert failed:', await r.text());
            else console.log(`[sweepstakes/alternate] GHL contact upserted for ${result.winner.email}`);
          })
          .catch((err) => console.error('[sweepstakes/alternate] GHL upsert fetch failed:', err));
      })(),

      // 5. GHL webhook
      webhookUrl
        ? fetch(webhookUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              firstName:        result.winner.name.split(' ')[0] ?? result.winner.name,
              lastName:         result.winner.name.split(' ').slice(1).join(' ') ?? '',
              email:            result.winner.email,
              phone:            '',
              month,
              monthLabel,
              entryCount:       result.winner.entryCount,
              totalEntries:     result.totalEntries,
              prize,
              drawnAt:          draw.drawnAt,
              notes:            draw.notes ?? '',
              isAlternateDraw:  true,
              forfeitedWinner:  existingDraw.winnerName,
              winnerTag:        `gascap-sweepstakes-winner-${monthLabel.toLowerCase().replace(/\s+/g, '-')}`,
              alternateTag:     `gascap-sweepstakes-alternate-${monthLabel.toLowerCase().replace(/\s+/g, '-')}`,
              sendSms:          !suppressSms,
            }),
          }).catch((err) => console.error('[sweepstakes/alternate] GHL webhook failed:', err))
        : Promise.resolve(),
    ]);

    return NextResponse.json({
      ok:              true,
      alternateDraw:   true,
      forfeitedWinner: { name: existingDraw.winnerName, email: existingDraw.winnerEmail },
      newWinner: {
        name:         result.winner.name,
        email:        result.winner.email,
        entryCount:   result.winner.entryCount,
        totalEntries: result.totalEntries,
        prize,
        month,
      },
      draw,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('No remaining') || msg.includes('No eligible')) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    console.error('[sweepstakes/alternate] error:', err);
    return NextResponse.json({ error: 'Alternate draw failed.' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/sweepstakes?month=YYYY-MM — mark winner confirmed + fire Tremendous card
 *
 * Two things happen when the admin clicks "Mark Confirmed":
 *  1. The draw record is stamped with claimedAt (idempotent — safe to call again).
 *  2. Tremendous order is created to deliver the Visa prepaid card to the winner's email.
 *     Fired here (not at draw time) so we never issue a reward before confirmation —
 *     unredeemed Tremendous rewards can only be cancelled within 7 days and are not
 *     guaranteed reversible (learned from Matt Beals incident, May 2026).
 *
 * Returns: { ok, claimedAt, tremendousSent, tremendousOrderId? }
 */
export async function PATCH(req: Request) {
  const _auth = auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized'  }, { status: 401 });

  const month = new URL(req.url).searchParams.get('month');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Valid month required (YYYY-MM)' }, { status: 400 });
  }

  try {
    const draw = await markWinnerClaimed(month);

    // ── Tremendous card delivery ─────────────────────────────────────────────
    // Fetch the prize amount from the tier engine (not stored on the draw record).
    let tremendousSent    = false;
    let tremendousOrderId: string | undefined;
    let tremendousError:   string | undefined;

    const tremendousKey        = process.env.TREMENDOUS_API_KEY;
    const tremendousCampaignId = process.env.TREMENDOUS_CAMPAIGN_ID;

    if (!tremendousKey || !tremendousCampaignId) {
      console.warn('[sweepstakes/confirm] Tremendous env vars not set — skipping card delivery');
      tremendousError = 'TREMENDOUS_API_KEY or TREMENDOUS_CAMPAIGN_ID not configured';
    } else {
      try {
        const { currentTier } = await getCurrentPrizeTier();
        const prize       = currentTier.prize;   // e.g. "$25"
        const denomination = parseFloat(prize.replace(/[^0-9.]/g, ''));

        if (isNaN(denomination) || denomination <= 0) {
          console.warn('[sweepstakes/confirm] Could not parse prize amount from:', prize);
          tremendousError = `Could not parse prize amount: ${prize}`;
        } else {
          const tRes = await fetch('https://www.tremendous.com/api/v2/orders', {
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
                  name:  draw.winnerName,
                  email: draw.winnerEmail,
                },
                value: {
                  denomination,
                  currency_code: 'USD',
                },
              }],
            }),
          });

          if (!tRes.ok) {
            const errText = await tRes.text();
            console.error('[sweepstakes/confirm] Tremendous API error:', tRes.status, errText);
            tremendousError = `Tremendous API ${tRes.status}: ${errText}`;
          } else {
            const tData = await tRes.json() as { order?: { id?: string } };
            tremendousOrderId = tData.order?.id;
            tremendousSent    = true;
            console.log(
              `[sweepstakes/confirm] Tremendous card sent to ${draw.winnerEmail}` +
              ` (${prize}) — order ${tremendousOrderId ?? 'unknown'}`,
            );
          }
        }
      } catch (tErr) {
        console.error('[sweepstakes/confirm] Tremendous fetch threw:', tErr);
        tremendousError = String(tErr);
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    return NextResponse.json({
      ok:              true,
      claimedAt:       draw.claimedAt,
      tremendousSent,
      ...(tremendousOrderId ? { tremendousOrderId }       : {}),
      ...(tremendousError   ? { tremendousError }         : {}),
    });
  } catch {
    return NextResponse.json({ error: 'Draw not found or already confirmed' }, { status: 404 });
  }
}

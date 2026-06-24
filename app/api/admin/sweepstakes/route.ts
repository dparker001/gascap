/**
 * Admin Sweepstakes API — protected by ADMIN_PASSWORD
 * GET   /api/admin/sweepstakes?month=YYYY-MM  — preview entrants
 * GET   /api/admin/sweepstakes?history=1      — past draw results
 * POST  /api/admin/sweepstakes                — run draw { month, notes?, dryRun?, holdEmails?, suppressSms? }
 *                                              OR release held emails { month, action:'send-winner-email', suppressSms? }
 * PUT   /api/admin/sweepstakes?month=YYYY-MM  — alternate draw after forfeiture
 * PATCH /api/admin/sweepstakes?month=YYYY-MM  — mark winner confirmed → fires Tremendous card delivery
 *
 * Hold-and-verify: by default a draw RECORDS the winner but sends nothing
 * (holdEmails defaults true). The admin verifies the winner in the panel, then
 * releases all emails via the `send-winner-email` action. Pass holdEmails:false
 * to auto-send at draw time (legacy one-step behaviour).
 *
 * When emails are released, fireDrawNotifications() fires four side-effects:
 *  1. Winner notification email  (via lib/email.ts → SMTP or Resend)
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
  formatPeriodLabel,
} from '@/lib/giveaway';
import { fireDrawNotifications } from '@/lib/drawNotifications';
import { sendMail, winnerNotificationEmailHtml, nonWinnerNotificationEmailHtml } from '@/lib/email';
import { findById } from '@/lib/users';
import { sendApns, apnsConfigured } from '@/lib/apns';
import { prisma } from '@/lib/prisma';

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

  const body        = await req.json() as {
    month?: string; notes?: string; dryRun?: boolean;
    holdEmails?: boolean; suppressWinnerEmail?: boolean; suppressSms?: boolean;
    action?: 'send-winner-email';
  };
  const month       = body.month ?? currentMonth();
  const dryRun      = body.dryRun === true;
  const suppressSms = body.suppressSms === true;
  // Hold-and-verify is the default: record the winner, send nothing, and wait
  // for the admin to release the emails via the `send-winner-email` action.
  // (suppressWinnerEmail kept for backward compatibility — it also holds.)
  const holdEmails  = body.holdEmails !== false && body.suppressWinnerEmail !== false;

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM.' }, { status: 400 });
  }

  // ── Action: release the held winner + results emails for an already-recorded
  //    draw, after the admin has verified the winner in the panel. ──────────────
  if (body.action === 'send-winner-email') {
    const history = await getDrawHistory();
    const draw    = history.find((d) => d.month === month);
    if (!draw) {
      return NextResponse.json({ error: `No recorded draw for ${month}.` }, { status: 404 });
    }
    const { currentTier: releaseTier } = await getCurrentPrizeTier();
    void fireDrawNotifications({
      period:       month,
      prize:        releaseTier.prize,
      winner:       { userId: draw.winnerId, name: draw.winnerName, email: draw.winnerEmail, entryCount: draw.entryCount },
      totalEntries: draw.totalEntries,
      drawnAt:      draw.drawnAt,
      notes:        draw.notes ?? null,
      suppressSms,
    });
    return NextResponse.json({ ok: true, sent: true });
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

    // Hold-and-verify (default): record the winner, send nothing, and wait for
    // the admin to release the emails via the `send-winner-email` action after
    // verifying the winner. Pass holdEmails:false to auto-send at draw time.
    if (!holdEmails) {
      const { currentTier: drawTier } = await getCurrentPrizeTier();
      void fireDrawNotifications({
        period:       month,
        prize:        drawTier.prize,
        winner:       result.winner,
        totalEntries: result.totalEntries,
        drawnAt:      draw.drawnAt,
        notes:        draw.notes ?? null,
        suppressSms,
      });
    }

    return NextResponse.json({ ok: true, draw, held: holdEmails });
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
    const monthLabel  = formatPeriodLabel(month);
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

      // 1b. Native iOS push to the WINNER ONLY — only when the winner email is
      //     actually sent (mirrors the suppress gating; non-winners never pushed).
      suppressWinnerEmail
        ? Promise.resolve()
        : (async () => {
            if (!apnsConfigured()) return;
            const wu = await prisma.user.findUnique({
              where:  { email: result.winner.email },
              select: { iosPushToken: true },
            }).catch(() => null);
            if (wu?.iosPushToken) {
              await sendApns(
                wu.iosPushToken,
                '🎉 You won!',
                'Congrats — you won this month’s GasCap™ gas-card giveaway! Check your email to claim your prize.',
              ).catch(() => {});
            }
          })(),

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
    // Load the draw WITHOUT marking it yet — we only mark it claimed if the card
    // actually goes out (or Tremendous isn't configured / manual fulfillment).
    const history  = await getDrawHistory();
    const existing = history.find((d) => d.month === month);
    if (!existing) {
      return NextResponse.json({ error: `No recorded draw for ${month}.` }, { status: 404 });
    }
    // Idempotency guard: already confirmed → do NOT re-issue a card.
    if (existing.claimedAt) {
      return NextResponse.json({ ok: true, alreadyConfirmed: true, claimedAt: existing.claimedAt });
    }

    // ── Tremendous card delivery ─────────────────────────────────────────────
    // Fetch the prize amount from the tier engine (not stored on the draw record).
    let tremendousSent    = false;
    let tremendousOrderId: string | undefined;
    let tremendousError:   string | undefined;

    const tremendousKey        = process.env.TREMENDOUS_API_KEY;
    const tremendousCampaignId = process.env.TREMENDOUS_CAMPAIGN_ID;
    const tremendousConfigured = Boolean(tremendousKey && tremendousCampaignId);

    if (!tremendousConfigured) {
      console.warn('[sweepstakes/confirm] Tremendous env vars not set — skipping card delivery (manual fulfillment)');
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
                  name:  existing.winnerName,
                  email: existing.winnerEmail,
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
              `[sweepstakes/confirm] Tremendous card sent to ${existing.winnerEmail}` +
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

    // Card failed while Tremendous IS configured → do NOT mark claimed, so the
    // admin can fix the issue (e.g. funding/campaign) and retry the button.
    if (tremendousConfigured && !tremendousSent) {
      return NextResponse.json(
        { ok: false, confirmed: false, tremendousSent: false, tremendousError },
        { status: 502 },
      );
    }

    // Card sent (or Tremendous not configured → manual fulfillment): mark claimed.
    const draw = await markWinnerClaimed(month);
    return NextResponse.json({
      ok:                  true,
      claimedAt:           draw.claimedAt,
      tremendousConfigured,
      tremendousSent,
      ...(tremendousOrderId ? { tremendousOrderId } : {}),
      ...(tremendousError   ? { tremendousError }   : {}),
    });
  } catch {
    return NextResponse.json({ error: 'Draw not found or update failed.' }, { status: 404 });
  }
}

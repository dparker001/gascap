/**
 * Admin Sweepstakes API — protected by ADMIN_PASSWORD
 * GET  /api/admin/sweepstakes?month=YYYY-MM  — preview entrants
 * GET  /api/admin/sweepstakes?history=1      — past draw results
 * POST /api/admin/sweepstakes                — run draw { month, notes? }
 *
 * After a successful draw the route fires two fire-and-forget side-effects:
 *  1. Winner notification email  (via lib/email.ts → SMTP or Resend)
 *  2. GHL webhook POST           (GHL_WINNER_WEBHOOK_URL env var)
 *     → triggers a GHL workflow that creates the VA task + sends the gas card
 */
import { NextResponse } from 'next/server';
import {
  getEligibleEntrants,
  runWeightedDraw,
  recordDraw,
  getDrawHistory,
  currentMonth,
} from '@/lib/giveaway';
import { sendMail, winnerNotificationEmailHtml } from '@/lib/email';

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

  const entrants     = await getEligibleEntrants(month);
  const totalEntries = entrants.reduce((s, e) => s + e.entryCount, 0);
  return NextResponse.json({ month, entrants, totalEntries, entrantCount: entrants.length });
}

export async function POST(req: Request) {
  const _auth = auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized'  }, { status: 401 });

  const body  = await req.json() as { month?: string; notes?: string };
  const month = body.month ?? currentMonth();

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM.' }, { status: 400 });
  }

  try {
    const result = await runWeightedDraw(month);
    const draw   = await recordDraw(result, body.notes);

    // ── Fire-and-forget notifications ────────────────────────────────────
    // Neither failure should roll back or block the draw response.
    const monthLabel  = fmtMonth(month);
    const prize       = process.env.SWEEPSTAKES_PRIZE ?? '$25';
    const webhookUrl  = process.env.GHL_WINNER_WEBHOOK_URL;

    void Promise.allSettled([
      // 1. Branded winner email
      sendMail({
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
          `Your ${prize} prepaid gas card will be sent within 7 days.`,
          `Reply to confirm receipt or email support@gascap.app with questions.`,
          `You must respond within 14 days to claim your prize.`,
        ].join('\n\n'),
      }).catch((err) => console.error('[sweepstakes] winner email failed:', err)),

      // 2. GHL webhook → triggers VA workflow for gas card fulfillment
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

/**
 * GET /api/cron/giveaway-draw
 *
 * Automatic monthly draw. Scheduled daily (.github/workflows/crons.yml,
 * "50 23 * * *" = 7:50 PM EDT / 6:50 PM EST); it records a month only when
 * every safeguard below allows it, and is a no-op otherwise.
 *
 * Safeguards (docs/reviews/2026-10-05-drawing-integrity-rev4.md Part 1, as
 * amended by docs/reviews/2026-10-05-drawing-integrity-rev5.md Part 1):
 *  1. FAIL-CLOSED SWITCH — nothing runs unless GIVEAWAY_AUTO_DRAW is exactly
 *     "on". Unset, empty, "off" or any other value skips. There is no force
 *     override: the old ?force=1 bypass is gone.
 *  2. ET CLOSE — the only candidate is the latest Entry Month whose published
 *     11:59:59 PM Eastern deadline has passed (lib/giveawayPeriod.ts). The
 *     open month can never be drawn, however late or early the job runs.
 *  3. 72-HOUR WINDOW — a month is drawn automatically only within 72 hours of
 *     its close. After that the cron skips and the integrity check reports
 *     the missing draw; a late draw needs Don's written approval and the
 *     admin recovery path. Older months are never drawn here.
 *  4. ONE DRAW PER MONTH — commitDraw() inserts the draw and resets the
 *     period counters in one transaction. A request that loses a race gets
 *     `already_drawn`, resets nothing and sends nothing.
 *  5. Notifications fire only after this request's own commit.
 *
 * The Tremendous card is intentionally NEVER sent from this cron. It's only
 * ever issued once the winner explicitly certifies 18+/eligibility via the
 * public claim link (app/api/giveaway/claim), or an admin manually confirms
 * via the admin panel (PATCH /api/admin/sweepstakes) as a fallback. This
 * cron auto-sending the card immediately, with no confirmation step, was the
 * exact gap that motivated building the claim flow — see lib/tremendous.ts.
 *
 * Prize is fixed at $50 for monthly draws (WEEKLY_PRIZE env to override — kept
 * the original env var name to avoid a Railway config change).
 * Secured with CRON_SECRET query param.
 */
import { NextResponse } from 'next/server';
import {
  runWeightedDraw,
  commitDraw,
  getDrawHistory,
  formatPeriodLabel,
  GIVEAWAY_CADENCE,
  CLAIM_WINDOW_DAYS,
} from '@/lib/giveaway';
import { latestClosedEntryMonthET, assertRecordableEntryMonth } from '@/lib/giveawayPeriod';
import { fireDrawNotifications } from '@/lib/drawNotifications';
import { sendMail } from '@/lib/email';

const ADMIN_EMAIL  = process.env.ADMIN_EMAIL  ?? 'admin@gascap.app';
const WEEKLY_PRIZE = process.env.WEEKLY_PRIZE ?? '$50';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!process.env.CRON_SECRET || searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 1. Fail-closed switch — checked before anything else ──────────────────
  if (process.env.GIVEAWAY_AUTO_DRAW !== 'on') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'auto-draw disabled' });
  }
  // The Official Rules describe a monthly drawing; any other cadence setting
  // is refused here rather than drawn on a schedule the rules don't state.
  if (GIVEAWAY_CADENCE !== 'monthly') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'unsupported cadence' });
  }

  // ── 2–3. ET close + 72-hour window ────────────────────────────────────────
  const now         = new Date();
  const period      = latestClosedEntryMonthET(now);
  const periodLabel = formatPeriodLabel(period);
  const history     = await getDrawHistory();
  const check       = assertRecordableEntryMonth(period, now, history.map((d) => d.month), { mode: 'auto' });
  if (!check.ok) {
    if (check.code === 'already_drawn') {
      console.log(`[giveaway-draw] Draw already exists for ${period} — skipping.`);
    }
    return NextResponse.json({ ok: true, skipped: true, period, reason: check.code });
  }

  // ── Run the weighted draw ─────────────────────────────────────────────────
  let result;
  try {
    result = await runWeightedDraw(period);
  } catch (err) {
    const msg = String(err);
    console.error('[giveaway-draw] Draw failed:', msg);
    // Alert admin if no eligible entrants
    await sendMail({
      to:      ADMIN_EMAIL,
      subject: `⚠️ GasCap™ auto-draw failed — ${periodLabel}`,
      html:    `<p style="font-family:system-ui,sans-serif;padding:24px;">${msg}</p>`,
      text:    msg,
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: msg }, { status: 422 });
  }

  // ── 4. Record the draw + reset counters atomically (generates a claim token)
  const committed = await commitDraw(result, 'Auto-draw via cron');
  if (!committed.inserted) {
    // Lost a race to a concurrent cron/admin request: that request owns the
    // reset and the notifications. This one does neither.
    console.log(`[giveaway-draw] Concurrent draw already recorded ${period} — skipping.`);
    return NextResponse.json({ ok: true, skipped: true, period, reason: 'already_drawn' });
  }
  const draw = committed.draw;

  // ── Fire emails + GHL notifications (fire-and-forget) ─────────────────────
  // The winner email includes a self-serve claim link (claimToken) — the
  // Tremendous card only ships once they confirm eligibility through it.
  void fireDrawNotifications({
    period,
    prize:        WEEKLY_PRIZE,
    winner:       result.winner,
    totalEntries: result.totalEntries,
    drawnAt:      draw.drawnAt,
    notes:        draw.notes ?? null,
    suppressSms:  false,
    claimToken:   draw.claimToken,
  });

  // ── Notify Don with draw summary ───────────────────────────────────────────
  await sendMail({
    to:      ADMIN_EMAIL,
    subject: `🏆 GasCap™ Monthly Draw Complete — ${periodLabel}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <p style="font-size:22px;font-weight:900;color:#1e2d4a;margin:0 0 16px;">
          🏆 Monthly Draw Complete — ${periodLabel}
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#334155;">
          <tr><td style="padding:6px 0;color:#64748b;">Winner</td>
              <td style="padding:6px 0;font-weight:700;">${result.winner.name}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Email</td>
              <td style="padding:6px 0;">${result.winner.email}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Entries</td>
              <td style="padding:6px 0;">${result.winner.entryCount} of ${result.totalEntries} total</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Prize</td>
              <td style="padding:6px 0;">${WEEKLY_PRIZE} Visa prepaid card</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Card delivery</td>
              <td style="padding:6px 0;">⏳ Winner notified — card ships once they confirm eligibility (link expires in ${CLAIM_WINDOW_DAYS} days)</td></tr>
        </table>
        <p style="margin:20px 0 0;">
          <a href="https://www.gascap.app/admin/sweepstakes"
             style="display:inline-block;background:#005f4a;color:#fff;font-weight:700;
                    font-size:13px;padding:10px 20px;border-radius:8px;text-decoration:none;">
            View in Admin Panel →
          </a>
        </p>
        <p style="font-size:12px;color:#94a3b8;margin-top:20px;">
          GasCap™ auto-draw cron · <a href="https://gascap.app/sweepstakes-rules" style="color:#94a3b8;">Official Rules</a>
        </p>
      </div>`,
    text: [
      `GasCap™ Monthly Draw Complete — ${periodLabel}`,
      `Winner: ${result.winner.name} (${result.winner.email})`,
      `Entries: ${result.winner.entryCount} of ${result.totalEntries} total`,
      `Prize: ${WEEKLY_PRIZE} Visa prepaid card`,
      `Card delivery: Winner notified — card ships once they confirm eligibility (link expires in ${CLAIM_WINDOW_DAYS} days)`,
      `Admin panel: https://www.gascap.app/admin/sweepstakes`,
    ].join('\n'),
  }).catch((err) => console.error('[giveaway-draw] admin notification failed:', err));

  console.log(`[giveaway-draw] Draw complete for ${period}: winner=${result.winner.email}, awaiting claim`);

  return NextResponse.json({
    ok:           true,
    period,
    periodLabel,
    winner:       result.winner.email,
    entryCount:   result.winner.entryCount,
    totalEntries: result.totalEntries,
    prize:        WEEKLY_PRIZE,
    awaitingClaim: true,
  });
}

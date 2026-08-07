/**
 * GET /api/cron/giveaway-draw
 *
 * Auto-draw cron — intended to run daily (Railway scheduler); only actually
 * executes a draw on the last calendar day of the month for monthly cadence
 * (see isLastDayOfMonth below). Recommended schedule: "55 23 * * *" (11:55 PM
 * UTC daily) — the guard makes it a no-op on every day but the last.
 *
 * Behavior per run:
 *  1. Cadence guard: for monthly cadence, skip unless today is the last day of the month.
 *  2. Idempotency: skip if a draw already exists for the current period.
 *  3. Run the weighted draw for the current period.
 *  4. Record the draw in the DB (generates a claim token).
 *  5. Fire winner + non-winner emails and GHL notifications (fire-and-forget)
 *     — the winner email includes a self-serve claim link, not a card.
 *  6. Email Don a draw summary noting the winner has been notified and is
 *     awaiting their own claim confirmation.
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
  currentPeriod,
  runWeightedDraw,
  recordDraw,
  resetPeriodBonusEntries,
  getDrawHistory,
  formatPeriodLabel,
  GIVEAWAY_CADENCE,
  CLAIM_WINDOW_DAYS,
} from '@/lib/giveaway';
import { fireDrawNotifications } from '@/lib/drawNotifications';
import { sendMail } from '@/lib/email';

const ADMIN_EMAIL  = process.env.ADMIN_EMAIL  ?? 'admin@gascap.app';
const WEEKLY_PRIZE = process.env.WEEKLY_PRIZE ?? '$50';

/** True if tomorrow (UTC) rolls over into a new month — i.e. today is the last day. */
function isLastDayOfMonth(d = new Date()): boolean {
  const tomorrow = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return tomorrow.getUTCDate() === 1;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!process.env.CRON_SECRET || searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Monthly cadence only draws once, on the last calendar day — a daily-scheduled
  // cron would otherwise fire the draw on day 1 and cut the month's entries short.
  // ?force=1 bypasses this for manual/admin testing.
  if (GIVEAWAY_CADENCE === 'monthly' && !isLastDayOfMonth() && searchParams.get('force') !== '1') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Not the last day of the month yet.' });
  }

  const period      = currentPeriod();
  const periodLabel = formatPeriodLabel(period);

  // ── Idempotency: skip if draw already ran for this period ─────────────────
  const history  = await getDrawHistory();
  const existing = history.find((d) => d.month === period);
  if (existing) {
    console.log(`[giveaway-draw] Draw already exists for ${period} — skipping.`);
    return NextResponse.json({ ok: true, skipped: true, period, existingDraw: existing });
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

  // ── Record the draw (generates a claim token) ──────────────────────────────
  const draw = await recordDraw(result, 'Auto-draw via cron');

  // ── Reset per-period achievement bonus counters for the new period ────────
  await resetPeriodBonusEntries().catch((err) =>
    console.error('[giveaway-draw] resetPeriodBonusEntries failed:', err));

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

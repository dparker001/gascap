/**
 * GET /api/cron/giveaway-draw
 *
 * Auto-draw cron — runs Friday evenings (Railway scheduler).
 * Recommended schedule: "0 21 * * 5" (9 PM UTC ≈ 5 PM ET on Fridays).
 *
 * Behavior per run:
 *  1. Idempotency: skip if a draw already exists for the current period.
 *  2. Run the weighted draw for the current period.
 *  3. Record the draw in the DB.
 *  4. Fire winner + non-winner emails and GHL notifications (fire-and-forget).
 *  5. Auto-confirm: send the $25 Tremendous card immediately (no admin click needed).
 *  6. Mark the draw as claimed.
 *  7. Email Don with a draw summary + Tremendous status.
 *
 * Prize is fixed at $25 for weekly draws (WEEKLY_PRIZE env to override).
 * Secured with CRON_SECRET query param.
 */
import { NextResponse } from 'next/server';
import {
  currentPeriod,
  runWeightedDraw,
  recordDraw,
  getDrawHistory,
  markWinnerClaimed,
  formatPeriodLabel,
} from '@/lib/giveaway';
import { fireDrawNotifications } from '@/lib/drawNotifications';
import { sendMail } from '@/lib/email';

const ADMIN_EMAIL  = process.env.ADMIN_EMAIL  ?? 'admin@gascap.app';
const WEEKLY_PRIZE = process.env.WEEKLY_PRIZE ?? '$25';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!process.env.CRON_SECRET || searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

  // ── Record the draw ────────────────────────────────────────────────────────
  const draw = await recordDraw(result, 'Auto-draw via cron');

  // ── Fire emails + GHL notifications (fire-and-forget) ─────────────────────
  void fireDrawNotifications({
    period,
    prize:        WEEKLY_PRIZE,
    winner:       result.winner,
    totalEntries: result.totalEntries,
    drawnAt:      draw.drawnAt,
    notes:        draw.notes ?? null,
    suppressSms:  false,
  });

  // ── Auto-confirm: send Tremendous card immediately ────────────────────────
  let tremendousSent    = false;
  let tremendousOrderId: string | undefined;
  let tremendousError:   string | undefined;

  const tremendousKey        = process.env.TREMENDOUS_API_KEY;
  const tremendousCampaignId = process.env.TREMENDOUS_CAMPAIGN_ID;
  const tremendousConfigured = Boolean(tremendousKey && tremendousCampaignId);

  if (!tremendousConfigured) {
    tremendousError = 'TREMENDOUS_API_KEY or TREMENDOUS_CAMPAIGN_ID not configured — manual fulfillment required';
    console.warn('[giveaway-draw]', tremendousError);
  } else {
    try {
      const denomination = parseFloat(WEEKLY_PRIZE.replace(/[^0-9.]/g, ''));
      if (isNaN(denomination) || denomination <= 0) {
        tremendousError = `Could not parse WEEKLY_PRIZE: ${WEEKLY_PRIZE}`;
        console.warn('[giveaway-draw]', tremendousError);
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
                name:  result.winner.name,
                email: result.winner.email,
              },
              value: { denomination, currency_code: 'USD' },
            }],
          }),
        });

        if (!tRes.ok) {
          const errText = await tRes.text();
          tremendousError = `Tremendous API ${tRes.status}: ${errText}`;
          console.error('[giveaway-draw] Tremendous error:', tremendousError);
        } else {
          const tData = await tRes.json() as { order?: { id?: string } };
          tremendousOrderId = tData.order?.id;
          tremendousSent    = true;
          console.log(
            `[giveaway-draw] Tremendous ${WEEKLY_PRIZE} card sent to ${result.winner.email}` +
            ` — order ${tremendousOrderId ?? 'unknown'}`,
          );
        }
      }
    } catch (tErr) {
      tremendousError = String(tErr);
      console.error('[giveaway-draw] Tremendous threw:', tremendousError);
    }
  }

  // Mark claimed if Tremendous sent (or if Tremendous isn't configured, mark anyway
  // so the admin panel shows it as "sent" pending manual fulfillment).
  if (tremendousSent || !tremendousConfigured) {
    await markWinnerClaimed(period);
  }

  // ── Notify Don with draw summary ───────────────────────────────────────────
  const cardStatus = tremendousSent
    ? `✅ Tremendous ${WEEKLY_PRIZE} card sent (order ${tremendousOrderId ?? 'unknown'})`
    : tremendousConfigured
      ? `⚠️ Tremendous FAILED — ${tremendousError}\n\nManual fulfillment needed.`
      : `ℹ️ Tremendous not configured — manual fulfillment needed.`;

  await sendMail({
    to:      ADMIN_EMAIL,
    subject: `🏆 GasCap™ Weekly Draw Complete — ${periodLabel}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <p style="font-size:22px;font-weight:900;color:#1e2d4a;margin:0 0 16px;">
          🏆 Weekly Draw Complete — ${periodLabel}
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
              <td style="padding:6px 0;">${cardStatus}</td></tr>
        </table>
        ${tremendousSent ? '' : `
        <div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:10px;padding:14px;margin:16px 0;">
          <p style="margin:0;font-weight:700;color:#92400e;">Action needed: manual card fulfillment</p>
          <p style="margin:6px 0 0;font-size:13px;color:#92400e;">${tremendousError ?? ''}</p>
        </div>`}
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
      `GasCap™ Weekly Draw Complete — ${periodLabel}`,
      `Winner: ${result.winner.name} (${result.winner.email})`,
      `Entries: ${result.winner.entryCount} of ${result.totalEntries} total`,
      `Prize: ${WEEKLY_PRIZE} Visa prepaid card`,
      `Card delivery: ${cardStatus}`,
      `Admin panel: https://www.gascap.app/admin/sweepstakes`,
    ].join('\n'),
  }).catch((err) => console.error('[giveaway-draw] admin notification failed:', err));

  console.log(`[giveaway-draw] Draw complete for ${period}: winner=${result.winner.email}, tremendousSent=${tremendousSent}`);

  return NextResponse.json({
    ok:               true,
    period,
    periodLabel,
    winner:           result.winner.email,
    entryCount:       result.winner.entryCount,
    totalEntries:     result.totalEntries,
    prize:            WEEKLY_PRIZE,
    tremendousSent,
    tremendousOrderId,
    tremendousError,
  });
}

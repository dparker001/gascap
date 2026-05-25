/**
 * GET /api/cron/winner-claim-check
 *
 * Runs daily. Finds any draw where:
 *   - The winner has not confirmed receipt (claimedAt is null)
 *   - The draw was more than 3 days ago
 *
 * Sends a single admin alert email listing all unclaimed draws so
 * the admin can follow up or select an alternate winner.
 *
 * Secured with CRON_SECRET. Schedule daily in Railway (e.g. 9:00 AM ET).
 */
import { NextResponse }        from 'next/server';
import { getUnclaimedDraws }   from '@/lib/giveaway';
import { sendMail }            from '@/lib/email';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@gascap.app';

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-');
  const names = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  return `${names[parseInt(mo, 10) - 1]} ${y}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!process.env.CRON_SECRET || searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const unclaimed = await getUnclaimedDraws();

  if (unclaimed.length === 0) {
    return NextResponse.json({ ok: true, unclaimed: 0 });
  }

  const rows = unclaimed.map((d) => {
    const daysSince = Math.floor((Date.now() - new Date(d.drawnAt).getTime()) / (1000 * 60 * 60 * 24));
    const deadline  = new Date(new Date(d.drawnAt).getTime() + 3 * 24 * 60 * 60 * 1000)
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return { draw: d, daysSince, deadline };
  });

  const bodyLines = rows.map(({ draw, daysSince, deadline }) =>
    `• ${fmtMonth(draw.month)} winner: ${draw.winnerName} (${draw.winnerEmail})\n` +
    `  Drawn ${daysSince} days ago — claim deadline ${deadline}\n` +
    `  → https://www.gascap.app/admin/sweepstakes`,
  );

  await sendMail({
    to:      ADMIN_EMAIL,
    subject: `⚠️ ${unclaimed.length} GasCap™ prize${unclaimed.length > 1 ? 's' : ''} unclaimed — action needed`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <p style="font-size:20px;font-weight:900;color:#1e2d4a;margin:0 0 8px;">
          ⚠️ Unclaimed Prize${unclaimed.length > 1 ? 's' : ''}
        </p>
        <p style="font-size:14px;color:#475569;margin:0 0 20px;">
          The following winner${unclaimed.length > 1 ? 's have' : ' has'} not confirmed receipt of
          their GasCap™ Visa prepaid card. Per the official rules, you may select an alternate
          winner if no response is received within 3 days of the drawing.
        </p>
        ${rows.map(({ draw, daysSince, deadline }) => `
        <div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:12px;padding:16px;margin:0 0 12px;">
          <p style="margin:0 0 4px;font-size:16px;font-weight:900;color:#1e2d4a;">
            ${fmtMonth(draw.month)} — ${draw.winnerName}
          </p>
          <p style="margin:0 0 4px;font-size:13px;color:#475569;">${draw.winnerEmail}</p>
          <p style="margin:0 0 12px;font-size:12px;color:#92400e;">
            Drawn ${daysSince} days ago · Claim deadline: ${deadline}
          </p>
          <a href="https://www.gascap.app/admin/sweepstakes"
             style="display:inline-block;background:#005f4a;color:#fff;font-weight:700;
                    font-size:13px;padding:8px 18px;border-radius:8px;text-decoration:none;">
            Mark Confirmed in Admin →
          </a>
        </div>`).join('')}
        <p style="font-size:12px;color:#94a3b8;margin-top:16px;">
          GasCap™ · <a href="https://gascap.app/sweepstakes-rules" style="color:#94a3b8;">Official Rules</a>
        </p>
      </div>`,
    text: [
      `⚠️ Unclaimed GasCap™ prize${unclaimed.length > 1 ? 's' : ''}:`,
      ...bodyLines,
      `Mark confirmed at: https://www.gascap.app/admin/sweepstakes`,
    ].join('\n\n'),
  });

  console.log(`[winner-claim-check] Alert sent for ${unclaimed.length} unclaimed draw(s): ${unclaimed.map((d) => d.month).join(', ')}`);

  return NextResponse.json({ ok: true, unclaimed: unclaimed.length, months: unclaimed.map((d) => d.month) });
}

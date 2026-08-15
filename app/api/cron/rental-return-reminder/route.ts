/**
 * GET /api/cron/rental-return-reminder
 *
 * Reminds renters with an active Rental Return Assistant session to check
 * their fuel level before returning the vehicle.
 *
 * SCOPE NOTE: the pilot spec's ideal is a 24h / 3h / 90min tiered reminder
 * schedule, but every GasCap cron in this repo runs once daily (see
 * .github/workflows/crons.yml) — there's no existing hourly/minute-level
 * cron infrastructure to build tighter tiers on top of without a real
 * scheduling change. This is the achievable version on today's
 * infrastructure: one daily pass that catches any active session whose
 * return is within the next 36 hours and hasn't been reminded yet. If
 * tighter timing becomes a real product need, this cron would need to move
 * to an hourly schedule (a small crons.yml change) rather than being
 * rebuilt.
 *
 * Secured with CRON_SECRET, same pattern as every other cron.
 */
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/prisma';
import { sendMail }     from '@/lib/email';
import { sendUserPush } from '@/lib/userPush';
import { logEmail, logEmailError } from '@/lib/emailLog';

const BASE_URL = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';
const REMINDER_WINDOW_HOURS = 36;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const windowEnd = new Date(now + REMINDER_WINDOW_HOURS * 3_600_000).toISOString();
  const nowIso = new Date(now).toISOString();

  let sessions;
  try {
    sessions = await prisma.rentalSession.findMany({
      where: {
        status:          'active',
        returnDateTime:  { not: null, gte: nowIso, lte: windowEnd },
        reminderSentAt:  null,
      },
      include: { user: { select: { id: true, email: true, name: true, locale: true } } },
    });
  } catch (err) {
    console.error('[rental-return-reminder] DB query failed:', err);
    return NextResponse.json({ ok: false, error: 'DB query failed', ran: new Date().toISOString() }, { status: 500 });
  }

  let sent = 0, errors = 0;

  for (const s of sessions) {
    try {
      const user = s.user;
      const locale: 'en' | 'es' = user.locale === 'es' ? 'es' : 'en';
      const firstName = user.name?.split(' ')[0] || (locale === 'es' ? 'ahí' : 'there');
      const url = `${BASE_URL}/rental-return/${s.id}`;

      const subject = locale === 'es'
        ? '⛽ Revisa tu combustible antes de devolver el auto de alquiler'
        : '⛽ Rental Return Fuel Check';
      const bodyText = locale === 'es'
        ? 'Tu alquiler vence pronto. Abre GasCap para ver si necesitas combustible antes de devolver tu vehículo.'
        : 'Your rental is due soon. Open GasCap to see whether you need fuel before returning your vehicle.';

      const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#005F4A,#1EB68F);border-radius:16px 16px 0 0;padding:24px;text-align:center;">
          <p style="font-size:24px;margin:0;color:#fff;font-weight:800;">⛽ ${subject}</p>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px;">
          <p style="font-size:15px;color:#334155;margin:0 0 12px;">Hi ${firstName}, ${bodyText}</p>
          <a href="${url}" style="display:inline-block;background:#FF8300;color:#fff;font-weight:800;font-size:14px;padding:12px 24px;border-radius:12px;text-decoration:none;">Open Rental Return Assistant →</a>
          <p style="font-size:12px;color:#94a3b8;margin:16px 0 0;">Questions? Just reply to this email.</p>
        </div>
      </div>`;
      const text = `Hi ${firstName}, your rental return is coming up — open GasCap to check your fuel level: ${url}`;

      const logEntry = { userId: user.id, userEmail: user.email, userName: user.name ?? '', type: 'rental-return-reminder', subject };

      await sendMail({ to: user.email, subject, html, text });
      await sendUserPush(user.id, subject, bodyText, `/rental-return/${s.id}`).catch(() => {});
      await prisma.rentalSession.update({ where: { id: s.id }, data: { reminderSentAt: new Date().toISOString() } });
      await logEmail(logEntry);
      sent++;
    } catch (err) {
      console.error(`[rental-return-reminder] Failed for session ${s.id}:`, err);
      await logEmailError(
        { userId: s.user.id, userEmail: s.user.email, userName: s.user.name ?? '', type: 'rental-return-reminder', subject: 'rental-return-reminder' },
        err,
      );
      errors++;
    }
  }

  console.log(`[rental-return-reminder] ${sent} sent, ${errors} errors, ${sessions.length} candidates`);
  return NextResponse.json({ ok: true, sent, errors, candidates: sessions.length, ran: new Date().toISOString() });
}

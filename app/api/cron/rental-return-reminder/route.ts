/**
 * GET /api/cron/rental-return-reminder
 *
 * Two jobs, one hourly pass:
 *
 *  1. PICKUP reminders — for rentals entered ahead of time. Nudges the renter
 *     24h and again 2h before pickup to fill in the details that can only be
 *     known at the counter, above all the pickup FUEL LEVEL (without it the
 *     whole return calculation has nothing to work from).
 *  2. RETURN reminder — the original job: check your fuel before dropping off.
 *
 * SCHEDULING NOTE: this used to run once daily like every other cron here,
 * which made a "2 hours before" tier impossible. It now runs hourly (see
 * .github/workflows/crons.yml) so the tighter tiers are achievable. Two
 * consequences worth knowing:
 *   - GitHub Actions cron is best-effort and can drift 5–30 min under load,
 *     so treat "2h before" as approximate, not precise.
 *   - Running 24x more often is only safe because every tier has its own
 *     dedup column; a session can never be reminded twice for the same tier.
 *
 * Secured with CRON_SECRET, same pattern as every other cron.
 */
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/prisma';
import { sendMail }     from '@/lib/email';
import { sendUserPush } from '@/lib/userPush';
import { logEmail, logEmailError } from '@/lib/emailLog';

const BASE_URL = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';

// Return reminder keeps its generous window — it only ever fires once, and a
// renter benefits from lead time to find gas near the drop-off.
const RETURN_WINDOW_HOURS = 36;
// Pickup tiers. Each spans one hour wider than its nominal target so an
// hourly pass (plus Actions drift) can't skip a session entirely.
const PICKUP_24H = { lowerHours: 20, upperHours: 26 };
const PICKUP_2H  = { lowerHours: 0,  upperHours: 3  };

interface Recipient { id: string; email: string; name: string | null; locale: string | null }

function shell(title: string, greeting: string, body: string, cta: string, url: string) {
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#005F4A,#1EB68F);border-radius:16px 16px 0 0;padding:24px;text-align:center;">
      <p style="font-size:24px;margin:0;color:#fff;font-weight:800;">${title}</p>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px;">
      <p style="font-size:15px;color:#334155;margin:0 0 12px;">${greeting} ${body}</p>
      <a href="${url}" style="display:inline-block;background:#FF8300;color:#fff;font-weight:800;font-size:14px;padding:12px 24px;border-radius:12px;text-decoration:none;">${cta}</a>
      <p style="font-size:12px;color:#94a3b8;margin:16px 0 0;">Questions? Just reply to this email.</p>
    </div>
  </div>`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now    = Date.now();
  const nowIso = new Date(now).toISOString();
  const iso    = (hours: number) => new Date(now + hours * 3_600_000).toISOString();

  let returnDue: Array<{ id: string; user: Recipient }> = [];
  let pickup24:  Array<{ id: string; user: Recipient }> = [];
  let pickup2:   Array<{ id: string; user: Recipient }> = [];

  const userSelect = { user: { select: { id: true, email: true, name: true, locale: true } } };

  try {
    [returnDue, pickup24, pickup2] = await Promise.all([
      prisma.rentalSession.findMany({
        where: {
          status: 'active',
          returnDateTime: { not: null, gte: nowIso, lte: iso(RETURN_WINDOW_HOURS) },
          reminderSentAt: null,
        },
        include: userSelect,
      }),
      prisma.rentalSession.findMany({
        where: {
          status: 'active',
          pickupDateTime: { not: null, gte: iso(PICKUP_24H.lowerHours), lte: iso(PICKUP_24H.upperHours) },
          pickupReminder24SentAt: null,
        },
        include: userSelect,
      }),
      prisma.rentalSession.findMany({
        where: {
          status: 'active',
          pickupDateTime: { not: null, gte: iso(PICKUP_2H.lowerHours), lte: iso(PICKUP_2H.upperHours) },
          pickupReminder2SentAt: null,
        },
        include: userSelect,
      }),
    ]);
  } catch (err) {
    console.error('[rental-return-reminder] DB query failed:', err);
    return NextResponse.json({ ok: false, error: 'DB query failed', ran: new Date().toISOString() }, { status: 500 });
  }

  let sent = 0, errors = 0;

  type Job = {
    kind:      'return' | 'pickup24' | 'pickup2';
    sessionId: string;
    user:      Recipient;
  };

  const jobs: Job[] = [
    ...pickup24.map((s)  => ({ kind: 'pickup24' as const, sessionId: s.id, user: s.user })),
    ...pickup2.map((s)   => ({ kind: 'pickup2'  as const, sessionId: s.id, user: s.user })),
    ...returnDue.map((s) => ({ kind: 'return'   as const, sessionId: s.id, user: s.user })),
  ];

  for (const job of jobs) {
    const { user } = job;
    try {
      const locale: 'en' | 'es' = user.locale === 'es' ? 'es' : 'en';
      const firstName = user.name?.split(' ')[0] || (locale === 'es' ? 'ahí' : 'there');
      const url = `${BASE_URL}/rental-return/${job.sessionId}`;
      const greeting = locale === 'es' ? `Hola ${firstName},` : `Hi ${firstName},`;

      let subject: string, pushBody: string, emailBody: string, cta: string;

      if (job.kind === 'pickup24') {
        subject = locale === 'es' ? '🗓 Tu alquiler comienza mañana' : '🗓 Your rental starts tomorrow';
        pushBody = locale === 'es'
          ? 'Recoges tu auto de alquiler mañana. Abre GasCap para tener listos los detalles.'
          : 'You pick up your rental tomorrow. Open GasCap to get your details ready.';
        emailBody = locale === 'es'
          ? 'recoges tu auto de alquiler mañana. Cuando lo tengas, anota el nivel de combustible de recogida en GasCap — es el número del que depende todo el cálculo de devolución.'
          : "you pick up your rental tomorrow. Once you have the car, record the pickup fuel level in GasCap — it's the number the entire return calculation depends on.";
        cta = locale === 'es' ? 'Abrir mi alquiler →' : 'Open my rental →';
      } else if (job.kind === 'pickup2') {
        subject = locale === 'es' ? '🚗 Recogida de alquiler en ~2 horas' : '🚗 Rental pickup in about 2 hours';
        pushBody = locale === 'es'
          ? 'Al recibir el auto, anota el nivel de combustible de recogida y el odómetro en GasCap.'
          : 'When you get the car, record the pickup fuel level in GasCap.';
        emailBody = locale === 'es'
          ? 'tu recogida es pronto. En el mostrador, revisa el indicador de combustible antes de salir y regístralo en GasCap — también puedes tomarle una foto como respaldo.'
          : "your pickup is coming up. At the counter, check the fuel gauge before you drive off and record it in GasCap — you can snap a photo of it as backup too.";
        cta = locale === 'es' ? 'Registrar nivel de combustible →' : 'Record pickup fuel →';
      } else {
        subject = locale === 'es'
          ? '⛽ Revisa tu combustible antes de devolver el auto de alquiler'
          : '⛽ Rental Return Fuel Check';
        pushBody = locale === 'es'
          ? 'Tu alquiler vence pronto. Abre GasCap para ver si necesitas combustible antes de devolver tu vehículo.'
          : 'Your rental is due soon. Open GasCap to see whether you need fuel before returning your vehicle.';
        emailBody = pushBody;
        cta = locale === 'es' ? 'Abrir el Asistente →' : 'Open Rental Return Assistant →';
      }

      const logEntry = {
        userId: user.id, userEmail: user.email, userName: user.name ?? '',
        type: `rental-${job.kind}-reminder`, subject,
      };

      await sendMail({
        to: user.email,
        subject,
        html: shell(subject, greeting, emailBody, cta, url),
        text: `${greeting} ${emailBody} ${url}`,
      });
      await sendUserPush(user.id, subject, pushBody, `/rental-return/${job.sessionId}`).catch(() => {});

      await prisma.rentalSession.update({
        where: { id: job.sessionId },
        data:
          job.kind === 'pickup24' ? { pickupReminder24SentAt: new Date().toISOString() }
          : job.kind === 'pickup2' ? { pickupReminder2SentAt: new Date().toISOString() }
          : { reminderSentAt: new Date().toISOString() },
      });
      await logEmail(logEntry);
      sent++;
    } catch (err) {
      console.error(`[rental-return-reminder] Failed ${job.kind} for session ${job.sessionId}:`, err);
      await logEmailError(
        { userId: user.id, userEmail: user.email, userName: user.name ?? '', type: `rental-${job.kind}-reminder`, subject: 'rental-reminder' },
        err,
      );
      errors++;
    }
  }

  console.log(`[rental-return-reminder] ${sent} sent, ${errors} errors (pickup24=${pickup24.length}, pickup2=${pickup2.length}, return=${returnDue.length})`);
  return NextResponse.json({
    ok: true, sent, errors,
    candidates: { pickup24: pickup24.length, pickup2: pickup2.length, return: returnDue.length },
    ran: new Date().toISOString(),
  });
}

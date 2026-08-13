/**
 * GET /api/cron/getaway-reminder
 *
 * One-time email nudge for Lifetime members who bought during the getaway
 * promo but never chose a destination in the app.
 *
 * IMPORTANT SCOPE NOTE: this only detects "never picked a destination in our
 * app" — it cannot detect "picked a destination but never paid the
 * destination taxes/fees on Marketing Boost's site," since that activation
 * step happens entirely off-platform and GasCap has no visibility into it.
 * If Marketing Boost confirms they track real activation and can expose it
 * (webhook or API), this cron should be extended to also catch that group —
 * right now it's blind to them.
 *
 * Also only covers purchases made AFTER lifetimePurchasedAt started being
 * recorded — existing Lifetime members from before that shipped have it
 * null and are excluded rather than guessed at with a fallback date.
 *
 * Logic:
 *  - Lifetime members, lifetimePurchasedAt 3–30 days ago, no destination
 *    chosen yet, no reminder sent yet.
 *  - Send a friendly nudge pointing to /getaway.
 *  - Record the send time so they're never nudged a second time.
 *
 * Run once daily via the shared cron schedule. Secured with CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/prisma';
import { sendMail }     from '@/lib/email';
import { logEmail, logEmailError } from '@/lib/emailLog';

const BASE_URL = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';
const MIN_DAYS_OLD = 3;
const MAX_DAYS_OLD = 30; // beyond this, treat as a lost cause rather than nudge indefinitely

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now      = Date.now();
  const minCutoff = new Date(now - MIN_DAYS_OLD * 86_400_000).toISOString();
  const maxCutoff = new Date(now - MAX_DAYS_OLD * 86_400_000).toISOString();

  let users;
  try {
    users = await prisma.user.findMany({
      where: {
        stripeInterval:             'lifetime',
        lifetimePurchasedAt:        { not: null, lte: minCutoff, gte: maxCutoff },
        getawayDestinationChosenAt: null,
        getawayReminderSentAt:      null,
        isTestAccount:              false,
      },
      select: { id: true, email: true, name: true, locale: true },
    });
  } catch (err) {
    console.error('[getaway-reminder] DB query failed:', err);
    return NextResponse.json({ ok: false, error: 'DB query failed', ran: new Date().toISOString() }, { status: 500 });
  }

  let sent = 0, errors = 0;

  for (const user of users) {
    try {
      const locale: 'en' | 'es' = user.locale === 'es' ? 'es' : 'en';
      const firstName = user.name?.split(' ')[0] || 'there';
      const subject = locale === 'es'
        ? '🏝️ No olvides elegir tu escapada gratuita de GasCap™'
        : "🏝️ Don't forget to pick your free GasCap™ getaway";

      const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#005F4A,#1EB68F);border-radius:16px 16px 0 0;padding:24px;text-align:center;">
          <p style="font-size:26px;margin:0;color:#fff;font-weight:800;">🏝️ Your getaway is waiting</p>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px;">
          <p style="font-size:15px;color:#334155;margin:0 0 12px;">Hi ${firstName}, your Pro Lifetime purchase included a complimentary resort getaway certificate — but it looks like you haven't picked a destination yet.</p>
          <p style="font-size:13px;color:#64748b;margin:0 0 16px;">Pick from 100+ destinations across the U.S. and worldwide, including Las Vegas, Miami, Cancún, and Bali. It takes about a minute.</p>
          <a href="${BASE_URL}/getaway" style="display:inline-block;background:#FF8300;color:#fff;font-weight:800;font-size:14px;padding:12px 24px;border-radius:12px;text-decoration:none;">Choose My Getaway →</a>
          <p style="font-size:12px;color:#94a3b8;margin:16px 0 0;">Questions? Just reply to this email.</p>
        </div>
      </div>`;
      const text = `Hi ${firstName}, your GasCap™ Pro Lifetime purchase included a complimentary resort getaway — pick your destination at ${BASE_URL}/getaway. Questions? Reply to this email.`;

      const logEntry = { userId: user.id, userEmail: user.email, userName: user.name ?? '', type: 'getaway-reminder', subject };

      await sendMail({ to: user.email, subject, html, text });
      await prisma.user.update({ where: { id: user.id }, data: { getawayReminderSentAt: new Date().toISOString() } });
      await logEmail(logEntry);
      sent++;
    } catch (err) {
      console.error(`[getaway-reminder] Failed for ${user.email}:`, err);
      await logEmailError(
        { userId: user.id, userEmail: user.email, userName: user.name ?? '', type: 'getaway-reminder', subject: 'getaway-reminder' },
        err,
      );
      errors++;
    }
  }

  console.log(`[getaway-reminder] ${sent} sent, ${errors} errors, ${users.length} candidates`);
  return NextResponse.json({ ok: true, sent, errors, candidates: users.length, ran: new Date().toISOString() });
}

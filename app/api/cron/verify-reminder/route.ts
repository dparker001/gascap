/**
 * GET /api/cron/verify-reminder
 *
 * One-time email nudge for users who signed up 3+ days ago and still
 * haven't verified their email address.
 *
 * Logic:
 *  - Find unverified users with no prior reminder (verifyReminderSentAt = null)
 *    whose account is between 3 and 30 days old.
 *  - Send them a friendly re-verification email with a fresh 7-day token.
 *  - Record the send time so they're never nudged a second time.
 *
 * Run once daily (e.g. 10:00 AM ET) via Railway cron or external scheduler.
 * Secured with CRON_SECRET.
 */
import { NextResponse }           from 'next/server';
import { getUnverifiedUsersForReminder, markVerifyReminderSent } from '@/lib/users';
import { createEmailVerifyToken }  from '@/lib/users';
import { sendMail, verificationEmailHtml } from '@/lib/email';

const BASE_URL = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const users = await getUnverifiedUsersForReminder();
  let sent = 0, errors = 0;

  for (const user of users) {
    try {
      // Generate a fresh verification token (7-day expiry set inside createEmailVerifyToken)
      const token     = await createEmailVerifyToken(user.id);
      const verifyUrl = `${BASE_URL}/verify-email?token=${token}`;

      const locale: 'en' | 'es' = user.locale === 'es' ? 'es' : 'en';
      const subject = locale === 'es'
        ? 'Recuerda verificar tu correo de GasCap™'
        : 'Reminder: please verify your GasCap™ email';

      await sendMail({
        to:      user.email,
        subject,
        html:    verificationEmailHtml(user.name, verifyUrl, locale),
        text:    locale === 'es'
          ? `Hola ${user.name}, todavía no has verificado tu cuenta de GasCap™. Haz clic aquí: ${verifyUrl}`
          : `Hi ${user.name}, you haven't verified your GasCap™ email yet. Click here: ${verifyUrl}`,
      });

      await markVerifyReminderSent(user.id);
      sent++;
    } catch (err) {
      console.error(`[verify-reminder] Failed for ${user.email}:`, err);
      errors++;
    }
  }

  console.log(`[verify-reminder] sent=${sent} errors=${errors}`);
  return NextResponse.json({ ok: true, ran: new Date().toISOString(), sent, errors });
}

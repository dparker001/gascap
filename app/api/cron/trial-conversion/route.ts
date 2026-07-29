/**
 * GET /api/cron/trial-conversion?secret=X&step=1|2|3
 *
 * Sends one of three conversion emails to all active Pro trial users.
 * Fired manually (or by GitHub Actions) on specific dates in the trial expiration window:
 *
 *   step=1  — soft value reminder ("what you're getting")
 *   step=2  — savings math + price anchor
 *   step=3  — hard deadline urgency
 *
 * Idempotent: skips users who already received the email for this step.
 * Skips users with emailOptOut = true.
 */
import { NextResponse }          from 'next/server';
import { prisma }                from '@/lib/prisma';
import { sendConversionEmail }   from '@/lib/emailTrialConversion';
import { hasEmailBeenSent, logEmailError } from '@/lib/emailLog';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // Auth
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step validation
  const stepParam = searchParams.get('step');
  const step = Number(stepParam) as 1 | 2 | 3 | 4;
  if (![1, 2, 3, 4].includes(step)) {
    return NextResponse.json({ error: 'Invalid step — must be 1, 2, 3, or 4' }, { status: 400 });
  }

  const emailType = `trial-c${step}`;

  // C4 targets only engaged users (≥2 calcs OR streak ≥3) — soft offer to likely converters.
  // Steps 1–3 go to all active trial users.
  const where = step === 4
    ? {
        plan:          'pro' as const,
        isProTrial:    true,
        emailOptOut:   false,
        isTestAccount: { not: true },
        OR: [{ calcCount: { gte: 2 } }, { streak: { gte: 3 } }],
      }
    : {
        plan:          'pro' as const,
        isProTrial:    true,
        emailOptOut:   false,
        isTestAccount: { not: true },
      };

  // Fetch qualifying trial users
  const users = await prisma.user.findMany({
    where,
    select: { id: true, name: true, email: true },
  });

  let sent = 0, skipped = 0, errors = 0;

  for (const user of users) {
    // Idempotency — skip if already sent this step
    const alreadySent = await hasEmailBeenSent(user.id, emailType);
    if (alreadySent) {
      skipped++;
      continue;
    }

    try {
      await sendConversionEmail(step, { id: user.id, name: user.name, email: user.email });
      sent++;
      await new Promise((r) => setTimeout(r, 250)); // stay under Resend 5 req/sec limit
    } catch (err) {
      console.error(`[TrialConversion] C${step} failed for ${user.email}:`, err);
      errors++;
      await logEmailError(
        { userId: user.id, userEmail: user.email, userName: user.name,
          type: emailType, subject: '' },
        err,
      );
    }
  }

  console.log(`[TrialConversion] C${step}: sent=${sent} skipped=${skipped} errors=${errors}`);
  return NextResponse.json({ ok: true, step, sent, skipped, errors, ran: new Date().toISOString() });
}

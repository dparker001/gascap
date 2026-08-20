/**
 * GET /api/cron/trial-conversion?secret=X&step=1|2|3|4
 *
 * Sends one of four conversion emails to Pro trial users. Fired manually —
 * there is currently no automated schedule that fires this per user
 * relative to their individual trialExpiresAt (each signup gets its own
 * 30-day trial, so "day N of the campaign" isn't the same as "day N of any
 * given user's trial").
 *
 *   step=1  — soft value reminder ("what you're getting"), all active trials
 *   step=2  — savings math + price anchor, all active trials
 *   step=3  — hard deadline urgency, all active trials
 *   step=4  — "own it forever" / trial-ending copy, engaged users
 *             (calcCount ≥ 2 OR streak ≥ 3) ONLY, further restricted to
 *             trialExpiresAt within the next 48 hours — C4's copy states
 *             the user's trial is ending soon, so eligibility enforces
 *             that claim is actually true rather than trusting the caller
 *             to only invoke step=4 near the right time.
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

  // C4 targets only engaged users (≥2 calcs OR streak ≥3) whose trial is
  // ACTUALLY ending soon — not just any active trial. C4's copy states
  // outright that "your trial is ending soon"; without a recipient-side
  // expiration window, a manual step=4 invocation could send that claim to
  // a user whose 30-day trial has, say, three weeks left, since isProTrial
  // stays true for the whole trial and this cron isn't (yet) scheduled per
  // user relative to their individual trialExpiresAt. Window matches C3's
  // established "48 hours left" campaign semantics.
  // Steps 1–3 go to all active trial users, no expiration-window filter.
  const now = new Date();
  const C4_WINDOW_HOURS = 48;
  const c4Cutoff = new Date(now.getTime() + C4_WINDOW_HOURS * 60 * 60 * 1000);
  const where = step === 4
    ? {
        plan:          'pro' as const,
        isProTrial:    true,
        emailOptOut:   false,
        isTestAccount: { not: true },
        OR: [{ calcCount: { gte: 2 } }, { streak: { gte: 3 } }],
        trialExpiresAt: {
          not: null,
          gt:  now.toISOString(),
          lte: c4Cutoff.toISOString(),
        },
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

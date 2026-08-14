/**
 * GET /api/cron/winback
 *
 * "Come back to Pro" win-back campaign for lapsed free users (expired trial).
 * 3-step email sequence offering Pro Lifetime at 50% off ($9.99), spaced
 * WINBACK_GAP_DAYS apart, one per user, that stops automatically once the user
 * is no longer eligible (i.e. they upgraded — winbackEligible returns false).
 *
 * Secured with CRON_SECRET (append ?secret=<value>).
 * Add ?dryRun=true to preview the audience + per-step counts WITHOUT sending.
 *
 * Schedule daily; each user only advances one step per WINBACK_GAP_DAYS window.
 */

import { NextResponse }                  from 'next/server';
import { getAllUsers }                    from '@/lib/users';
import { sendMail, winbackEmailHtml }     from '@/lib/email';
import { prisma }                         from '@/lib/prisma';
import { getawayPromoActive }              from '@/lib/getawayPromo';
import { winbackEligible, winbackOfferActive, winbackDeadlineLabel, winbackStalled, WINBACK_RESUME_STALLED, WINBACK_STEPS, WINBACK_GAP_DAYS } from '@/lib/winbackOffer';

// Subjects are personalized with the recipient's first name and always name the
// offer as "Lifetime" (so $9.99 is never mistaken for a monthly price). They
// reference the campaign-wide deadline (WINBACK_END_DATE) rather than relative
// days — the old "expires in 2 days" / "ends tomorrow" copy was only accurate
// when the deadline was a rolling 3-day per-user window.
const DEADLINE = winbackDeadlineLabel();
const SUBJECTS: Record<1 | 2 | 3, (firstName: string) => string> = {
  1: (n) => `${n}, your GasCap™ garage is still here — Pro for life, $9.99`,
  2: (n) => `${n}, $9.99 once vs $2.99 every month`,
  3: (n) => `Last call, ${n}: $9.99 GasCap™ Lifetime ends ${DEADLINE}`,
};

const UNSUB = 'https://www.gascap.app/settings';

/**
 * Max emails per run. Two reasons, both real:
 *
 * 1. Timeout. GitHub Actions calls this with `curl --max-time 30`. Sends are
 *    sequential at roughly 200-500ms each, so an unbounded run over 210 users
 *    would take 40-100s — the action reports failure while the server quietly
 *    keeps going, which is exactly the bug the GHL backfill had.
 * 2. Deliverability. This domain normally sends a handful of messages a day.
 *    A sudden 210-message burst is the pattern spam filters punish.
 *
 * Whatever doesn't fit rolls into the next daily run — progress is durable
 * because each user is stamped as they're sent.
 */
const MAX_PER_RUN = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dryRun = searchParams.get('dryRun') === 'true';
  // Lifetime currently also earns a free resort getaway (auto-drops once the
  // promo ends, so the email never promises a cert that won't be issued).
  const withGetaway = getawayPromoActive();

  // ?testEmail=<addr>&step=<1-3> — send a single preview email to one address
  // (does NOT touch any user's winbackStep). For reviewing the email before a blast.
  const testEmail = searchParams.get('testEmail');
  if (testEmail) {
    const step = Math.min(3, Math.max(1, parseInt(searchParams.get('step') ?? '1', 10))) as 1 | 2 | 3;
    try {
      await sendMail({
        to:             testEmail,
        subject:        `[TEST] ${SUBJECTS[step]('Don')}`,
        html:           winbackEmailHtml('Don', step, withGetaway),
        text:           `Win-back test (step ${step}). Get Pro Lifetime for $9.99: https://www.gascap.app/upgrade?wb=1`,
        unsubscribeUrl: UNSUB,
      });
      return NextResponse.json({ ok: true, test: true, sentTo: testEmail, step });
    } catch (err) {
      return NextResponse.json({ ok: false, test: true, error: String(err) }, { status: 500 });
    }
  }

  const allUsers = await getAllUsers();
  const now = Date.now();

  let sent = 0, skipped = 0, deferred = 0;
  const byStep: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  const sample: string[] = [];

  for (const user of allUsers) {
    // Only lapsed free users (expired trial, not Lifetime). Auto-stops on upgrade.
    if (!winbackEligible(user)) { continue; }
    if (user.emailOptOut || !user.email) { skipped++; continue; }

    const storedStep = (user as { winbackStep?: number }).winbackStep ?? 0;
    const lastSentAt = (user as { winbackLastSentAt?: string | null }).winbackLastSentAt;

    // A sequence that stalled months ago restarts from step 1 rather than
    // resuming mid-thread — the 181 users frozen at step 1 since 2026-06-15
    // won't remember that email, and step 1 is where the current copy and the
    // value stack live. Dropping them straight into the step-2 "here's the
    // math" email would reference a pitch they never really received.
    const restarting = storedStep > 0 && winbackStalled(lastSentAt) && WINBACK_RESUME_STALLED;
    const curStep    = restarting ? 0 : storedStep;

    if (curStep >= WINBACK_STEPS) { continue; } // sequence complete

    // Stop entirely once the campaign deadline has passed — including for users
    // who have never been emailed (curStep === 0). The old `curStep > 0` guard
    // was correct when the deadline was a rolling per-user window (a new
    // entrant's clock hadn't started yet, so the offer was genuinely still
    // open for them). With a fixed campaign-wide deadline that's no longer
    // true: after the end date a first-time entrant would be emailed a $9.99
    // price that checkout would then refuse to honor.
    if (!winbackOfferActive()) { skipped++; continue; }

    // Don't silently resume sequences that stalled months ago — see
    // WINBACK_RESUME_STALLED. Opt in via env to re-engage them (they restart
    // at step 1, per `restarting` above).
    if (storedStep > 0 && winbackStalled(lastSentAt) && !WINBACK_RESUME_STALLED) { skipped++; continue; }

    // Respect the gap between steps. Skipped for restarts — a stalled sequence
    // is by definition well past the gap, and curStep is 0 there anyway.
    if (curStep > 0 && lastSentAt) {
      const daysSince = (now - new Date(lastSentAt).getTime()) / 86_400_000;
      if (daysSince < WINBACK_GAP_DAYS) { skipped++; continue; }
    }

    const nextStep = (curStep + 1) as 1 | 2 | 3;
    byStep[nextStep] = (byStep[nextStep] ?? 0) + 1;
    if (sample.length < 8) sample.push(`${user.email} → step ${nextStep}`);

    if (dryRun) { continue; }

    // Batch cap — the remainder is picked up by tomorrow's run.
    if (sent >= MAX_PER_RUN) { deferred++; continue; }

    const firstName = (user.displayName || user.name || 'there').split(' ')[0];
    try {
      await sendMail({
        to:             user.email,
        subject:        SUBJECTS[nextStep](firstName),
        html:           winbackEmailHtml(firstName, nextStep, withGetaway),
        text:           `Hi ${firstName}, your GasCap™ garage is still here — saved vehicles and fill-up history included. Get Pro Lifetime for $9.99 instead of $19.99 (one payment, no subscription)${withGetaway ? ', plus a complimentary resort getaway certificate' : ''}. Rental Car Return Mode, live station prices, the GasCap Assistant, MPG tracking and +25 monthly giveaway entries all unlock again. Offer ends ${DEADLINE}. The discount applies automatically at checkout: https://www.gascap.app/upgrade?wb=1`,
        unsubscribeUrl: UNSUB,
      });

      // SMS is handled by a GHL workflow now (throttled, respects the daily cap),
      // NOT by this cron — so we don't double-send or burst into GHL's SMS limit.
      // This cron sends EMAIL only; the GHL "gascap-winback" workflow does SMS.

      const nowIso = new Date().toISOString();
      await prisma.user.update({
        where: { id: user.id },
        // Re-stamped on step 1, including restarts, so the record reflects when
        // this run of the sequence actually began.
        data:  {
          winbackStep:       nextStep,
          winbackLastSentAt: nowIso,
          ...(nextStep === 1 ? { winbackStartedAt: nowIso } : {}),
        },
      });
      sent++;
      console.log(`[Winback] ${user.email} → step ${nextStep}${withGetaway ? ' (+getaway)' : ''}`);
    } catch (err) {
      console.error(`[Winback] Failed for ${user.email}:`, err);
    }
  }

  return NextResponse.json({
    ok:        true,
    version:   'wb-email-only-v4',
    dryRun,
    audience:  byStep[1] + byStep[2] + byStep[3],
    byStep,
    sent:      dryRun ? 0 : sent,
    deferred,          // over MAX_PER_RUN this run — picked up tomorrow
    skipped,
    sample,
    ranAt:     new Date().toISOString(),
  });
}

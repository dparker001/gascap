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
import { winbackEligible, WINBACK_STEPS, WINBACK_GAP_DAYS } from '@/lib/winbackOffer';

// Subjects are personalized with the recipient's first name and always name the
// offer as "Lifetime" (so $9.99 is never mistaken for a monthly price).
const SUBJECTS: Record<1 | 2 | 3, (firstName: string) => string> = {
  1: (n) => `${n}, come back to GasCap™ Pro — $9.99 for Lifetime access`,
  2: (n) => `${n}, your $9.99 GasCap™ Lifetime offer expires in 3 days ⏰`,
  3: (n) => `Last call, ${n}: $9.99 GasCap™ Lifetime — ends tonight`,
};

const UNSUB = 'https://www.gascap.app/settings';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dryRun = searchParams.get('dryRun') === 'true';

  // ?testEmail=<addr>&step=<1-3> — send a single preview email to one address
  // (does NOT touch any user's winbackStep). For reviewing the email before a blast.
  const testEmail = searchParams.get('testEmail');
  if (testEmail) {
    const step = Math.min(3, Math.max(1, parseInt(searchParams.get('step') ?? '1', 10))) as 1 | 2 | 3;
    try {
      await sendMail({
        to:             testEmail,
        subject:        `[TEST] ${SUBJECTS[step]('Don')}`,
        html:           winbackEmailHtml('Don', step),
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

  let sent = 0, skipped = 0;
  const byStep: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  const sample: string[] = [];

  for (const user of allUsers) {
    // Only lapsed free users (expired trial, not Lifetime). Auto-stops on upgrade.
    if (!winbackEligible(user)) { continue; }
    if (user.emailOptOut || !user.email) { skipped++; continue; }

    const curStep = (user as { winbackStep?: number }).winbackStep ?? 0;
    if (curStep >= WINBACK_STEPS) { continue; } // sequence complete

    // Respect the gap between steps (step 1 fires immediately for new entrants).
    const lastAt = (user as { winbackLastSentAt?: string | null }).winbackLastSentAt;
    if (curStep > 0 && lastAt) {
      const daysSince = (now - new Date(lastAt).getTime()) / 86_400_000;
      if (daysSince < WINBACK_GAP_DAYS) { skipped++; continue; }
    }

    const nextStep = (curStep + 1) as 1 | 2 | 3;
    byStep[nextStep] = (byStep[nextStep] ?? 0) + 1;
    if (sample.length < 8) sample.push(`${user.email} → step ${nextStep}`);

    if (dryRun) { continue; }

    const firstName = (user.displayName || user.name || 'there').split(' ')[0];
    try {
      await sendMail({
        to:             user.email,
        subject:        SUBJECTS[nextStep](firstName),
        html:           winbackEmailHtml(firstName, nextStep),
        text:           `Hi ${firstName}, come back to GasCap™ Pro — get Pro Lifetime for $9.99 (50% off, limited time). The discount applies automatically at checkout: https://www.gascap.app/upgrade?wb=1`,
        unsubscribeUrl: UNSUB,
      });
      await prisma.user.update({
        where: { id: user.id },
        data:  { winbackStep: nextStep, winbackLastSentAt: new Date().toISOString() },
      });
      sent++;
      console.log(`[Winback] ${user.email} → step ${nextStep}`);
    } catch (err) {
      console.error(`[Winback] Failed for ${user.email}:`, err);
    }
  }

  return NextResponse.json({
    ok:        true,
    dryRun,
    audience:  byStep[1] + byStep[2] + byStep[3],
    byStep,
    sent:      dryRun ? 0 : sent,
    skipped,
    sample,
    ranAt:     new Date().toISOString(),
  });
}

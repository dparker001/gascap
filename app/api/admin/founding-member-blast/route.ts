/**
 * POST /api/admin/founding-member-blast
 *
 * One-time email blast to all active trial users offering Founding Member
 * status (2× permanent giveaway entries) if they convert before their
 * trial expires.
 *
 * Each email is personalised with the recipient's actual trial end date
 * and days remaining so no user sees a deadline that has already passed.
 *
 * Protected by x-admin-password header.
 *
 * Safe to call multiple times — duplicate guard skips any user who already
 * received a 'founding-member-blast' row in EmailLog.
 */

import { NextResponse }       from 'next/server';
import { prisma }             from '@/lib/prisma';
import { sendMail, foundingMemberBlastHtml } from '@/lib/email';
import { logEmail, logEmailError }           from '@/lib/emailLog';

/** ms delay between sends to stay inside Resend rate limits */
const SEND_DELAY_MS = 300;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: Request) {
  /* ── Auth ──────────────────────────────────────────────────────────── */
  const pwd = req.headers.get('x-admin-password');
  if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  /* ── Query active trial users ───────────────────────────────────────
   * Criteria:
   *   isProTrial = true          — on a trial
   *   trialExpiresAt > now       — trial has not yet expired
   *   emailOptOut = false        — respects opt-out
   *   isTestAccount = false      — skip internal accounts
   *   plan ≠ 'pro'               — not already converted
   */
  const trialUsers = await prisma.user.findMany({
    where: {
      isProTrial:    true,
      emailOptOut:   false,
      isTestAccount: false,
      plan:          { not: 'pro' },
      trialExpiresAt: {
        not: null,
        gt:  now.toISOString(),
      },
    },
    select: {
      id:             true,
      email:          true,
      name:           true,
      trialExpiresAt: true,
    },
  });

  /* ── Duplicate guard — fetch already-sent log rows ──────────────── */
  const alreadySentRows = await prisma.emailLog.findMany({
    where: { type: 'founding-member-blast' },
    select: { userEmail: true },
  });
  const alreadySent = new Set(alreadySentRows.map((r) => r.userEmail));

  /* ── Send loop ──────────────────────────────────────────────────── */
  const results = {
    total:      trialUsers.length,
    sent:       0,
    skipped:    0,
    errors:     0,
    recipients: [] as string[],
  };

  for (const user of trialUsers) {
    /* Skip if already blasted */
    if (alreadySent.has(user.email)) {
      results.skipped++;
      continue;
    }

    const trialEnd  = new Date(user.trialExpiresAt!);
    const msLeft    = trialEnd.getTime() - now.getTime();
    const daysLeft  = Math.max(1, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    const endDate   = trialEnd.toLocaleDateString('en-US', {
      month: 'long',
      day:   'numeric',
    });
    const firstName = user.name.trim().split(' ')[0] || user.name;

    const subject = daysLeft === 1
      ? `⏰ Last chance — your GasCap™ trial ends tomorrow`
      : daysLeft <= 3
        ? `Your Founding Member offer expires in ${daysLeft} days`
        : `You're one of our first 200 members — here's your reward`;

    try {
      await sendMail({
        to:      user.email,
        subject,
        html:    foundingMemberBlastHtml(firstName, endDate, daysLeft),
      });

      await logEmail({
        userId:    user.id,
        userEmail: user.email,
        userName:  user.name,
        type:      'founding-member-blast',
        subject,
      });

      results.sent++;
      results.recipients.push(user.email);
    } catch (err) {
      console.error(`[founding-member-blast] Failed for ${user.email}:`, err);
      await logEmailError(
        { userId: user.id, userEmail: user.email, userName: user.name,
          type: 'founding-member-blast', subject },
        err,
      );
      results.errors++;
    }

    /* Rate-limit courtesy delay */
    await sleep(SEND_DELAY_MS);
  }

  console.log(`[founding-member-blast] Done — sent:${results.sent} skipped:${results.skipped} errors:${results.errors}`);

  return NextResponse.json({ ok: true, ...results });
}

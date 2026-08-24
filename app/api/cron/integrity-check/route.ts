/**
 * GET /api/cron/integrity-check
 *
 * Daily data-integrity sweep. Emails ONLY when something looks wrong, so a
 * quiet inbox means a clean bill of health and the report stays worth reading.
 *
 * Every check here corresponds to a bug that actually shipped and was found by
 * stumbling into it rather than by anything watching. They fall into three
 * families:
 *
 *   1. Lifetime members treated as subscribers — four separate bugs (stale
 *      referral credits, unusable streak credits, trial drip after purchase,
 *      "you earned a free month" emails). Lifetime has no subscription, so any
 *      subscription-shaped artifact attached to one is a defect.
 *   2. Silent failures — an upstream returning null forever, a query window so
 *      tight it matched nothing, a counter that never reset. No error, no log,
 *      just a feature quietly doing nothing.
 *   3. Built but not wired — a cron that existed for weeks and was never
 *      scheduled.
 *
 * Add a check here whenever a bug is found by accident. That's the point: the
 * class of bug should only be able to surprise us once.
 *
 * Secured with CRON_SECRET. ?dryRun=true returns findings without emailing.
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { readAmoeEntries, AMOE_DATA_FILE } from '@/lib/amoeEntries';
import { prisma }       from '@/lib/prisma';
import { sendMail }     from '@/lib/email';
import { getDrawHistory, prevMonth, currentPeriod } from '@/lib/giveaway';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@gascap.app';

interface Finding {
  id:       string;
  label:    string;
  count:    number;
  detail:   string;
  /** 'warn' = worth a look; 'error' = something is actively broken for users. */
  severity: 'warn' | 'error';
  sample?:  string[];
}

/** Small helper — only produces a Finding when the count is non-zero. */
function flag(
  id: string, label: string, count: number, detail: string,
  severity: Finding['severity'] = 'warn', sample?: string[],
): Finding | null {
  return count > 0 ? { id, label, count, detail, severity, sample } : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!process.env.CRON_SECRET || searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dryRun = searchParams.get('dryRun') === 'true';

  const findings: (Finding | null)[] = [];

  // ── Family 1: Lifetime members holding subscription-only artifacts ────────
  const lifetimeUsers = await prisma.user.findMany({
    where:  { stripeInterval: 'lifetime' },
    select: { email: true, referralCredits: true, streakCredits: true, isProTrial: true },
  });

  const jsonLen = (v: unknown) => {
    try {
      const arr = typeof v === 'string' ? JSON.parse(v) : v;
      return Array.isArray(arr) ? arr.length : 0;
    } catch { return 0; }
  };

  const withRefCredits    = lifetimeUsers.filter((u) => jsonLen(u.referralCredits) > 0);
  const withStreakCredits = lifetimeUsers.filter((u) => jsonLen(u.streakCredits)   > 0);
  const stillOnTrial      = lifetimeUsers.filter((u) => u.isProTrial);

  findings.push(flag(
    'lifetime-referral-credits', 'Lifetime members holding referral credits',
    withRefCredits.length,
    'Free Pro months are unusable without a subscription. recordReferral should refuse to bank these — if the count is rising, the guard has regressed.',
    'warn', withRefCredits.slice(0, 5).map((u) => u.email),
  ));
  findings.push(flag(
    'lifetime-streak-credits', 'Lifetime members holding streak credits',
    withStreakCredits.length,
    'awardStreakMilestones should grant bonus giveaway entries to Lifetime members instead of a StreakCredit.',
    'warn', withStreakCredits.slice(0, 5).map((u) => u.email),
  ));
  findings.push(flag(
    'lifetime-on-trial', 'Lifetime members still flagged as on trial',
    stillOnTrial.length,
    'isProTrial must clear on purchase, or they stay in the trial drip and get "your trial is ending" emails after paying.',
    'error', stillOnTrial.slice(0, 5).map((u) => u.email),
  ));

  // ── Family 1b: stuck trials (the billing-portal bug) ──────────────────────
  const stuckTrials = await prisma.user.findMany({
    where: {
      isProTrial:     true,
      trialExpiresAt: { lt: new Date().toISOString() },
    },
    select: { email: true },
  });
  findings.push(flag(
    'stuck-trials', 'Expired trials never converted to free',
    stuckTrials.length,
    'trialExpiresAt is in the past but isProTrial is still true — these accounts keep Pro access for free and drop out of the conversion drip. This is the shape of the billing-portal bug from July.',
    'error', stuckTrials.slice(0, 5).map((u) => u.email),
  ));

  // ── Family 2: silent failures ─────────────────────────────────────────────
  // recordLogin regression: activity recorded but no login ever counted.
  const loginlessActive = await prisma.user.count({
    where: { loginCount: 0, activeDays: { isEmpty: false } },
  });
  findings.push(flag(
    'loginless-active-users', 'Users with activity but zero recorded logins',
    loginlessActive,
    'recordLogin should fire on every sign-in. When it does not, these users also miss the giveaway entry for that day.',
  ));

  // Phone verified but the +25 never paid. The award used to also require
  // that no phone was on file, so 145 users completed verification and got
  // nothing while the Rewards nudge kept telling them to verify. Fixed in
  // /api/otp/verify-phone; this catches a regression, and any user who slips
  // through is owed entries.
  const verifiedNoBonus = await prisma.user.count({
    where: { phoneVerifiedAt: { not: null }, phoneBonusEntries: 0, isTestAccount: { not: true } },
  });
  findings.push(flag(
    'phone-verified-no-bonus', 'Phone verified but +25 entries never granted',
    verifiedNoBonus,
    'Verification should always pay the one-time +25 unless it was already paid. A non-zero count here means the award condition regressed and these users are owed entries.',
  ));

  // AMOE store health. The free entry path is a legal requirement, not a
  // feature: if submissions can't be stored, entrants who are entitled to a
  // chance never get one. It went unnoticed for four months that the draw
  // never even read this file, so its health is now asserted daily rather
  // than assumed. Checks readability and that the directory is writable —
  // deliberately does NOT create an entry, since a synthetic row in a live
  // sweepstakes is its own problem.
  let amoeFault = 0;
  let amoeDetail = '';
  try {
    const entries = readAmoeEntries();               // throws on corrupt/unreadable
    fs.accessSync(path.dirname(AMOE_DATA_FILE), fs.constants.W_OK);
    amoeDetail = `${entries.length} free entries stored; store readable and writable.`;
  } catch (err) {
    amoeFault = 1;
    amoeDetail = `Free-entry (AMOE) store is not usable: ${(err as Error).message}. `
      + 'Submissions may be failing, and no-purchase-necessary entrants would be excluded from the draw.';
  }
  findings.push(flag(
    'amoe-store-unhealthy', 'Free-entry (AMOE) store unreadable or not writable',
    amoeFault, amoeDetail, 'error',
  ));

  // Upstream data providers. Both failed silently before — the electricity
  // endpoint returned null for every user for weeks because of a rejected
  // facet name, with no error surfaced anywhere.
  const base = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';
  const probe = async (label: string, path: string) => {
    try {
      const r = await fetch(`${base}${path}`, { cache: 'no-store' });
      if (!r.ok) return `${label}: HTTP ${r.status}`;
      const d = await r.json() as { price?: number | null };
      return d?.price == null ? `${label}: returned null price` : null;
    } catch (e) {
      return `${label}: ${String(e).slice(0, 80)}`;
    }
  };
  const upstream = (await Promise.all([
    probe('gas price (EIA)',         '/api/gas-price?lat=28.54&lng=-81.14'),
    probe('electricity rate (EIA)',  '/api/electricity-price?lat=28.54&lng=-81.14'),
  ])).filter(Boolean) as string[];
  findings.push(flag(
    'upstream-null', 'Upstream price lookups returning nothing',
    upstream.length,
    'These fail silently in the UI — the user just sees a generic "unavailable" message, so nobody reports it.',
    'error', upstream,
  ));

  // ── Family 3: scheduled work not actually running ─────────────────────────
  // A draw should exist for the period that just closed — unless the giveaway
  // is deliberately paused. It was for June and July 2026, and this check
  // reported that as a failure on its first run, which is exactly the kind of
  // false positive that trains people to ignore the report. Set
  // GIVEAWAY_PAUSED=true in Railway while a pause is intentional.
  const giveawayPaused = process.env.GIVEAWAY_PAUSED === 'true';
  const lastPeriod = prevMonth(currentPeriod());
  const draws      = await getDrawHistory();
  const missingDraw = giveawayPaused || draws.some((d) => d.month === lastPeriod) ? 0 : 1;
  findings.push(flag(
    'missing-draw', `No giveaway draw recorded for ${lastPeriod}`,
    missingDraw,
    'The draw is run manually from the admin panel — it is not scheduled. A missing draw also means entry counters never reset, so totals keep compounding across periods. If the pause is intentional, set GIVEAWAY_PAUSED=true.',
    'error',
  ));

  // Getaway fulfillment stuck 'pending' — Marketing Boost's send API has no
  // idempotency key and no lookup endpoint (verified 2026-08-24 — see
  // docs/reviews/2026-08-24-getaway-fulfillment-idempotency.md), so a crash
  // between MB accepting a send and GasCap recording the outcome is a real,
  // unresolvable-in-band window: automatically resending risks a duplicate
  // certificate, so app/api/getaway/choose deliberately never does. This
  // check exists purely to make that ambiguous window operationally
  // visible — it never resends, never changes the destination, and (same as
  // every other finding in this file) re-alerts daily for as long as the
  // row stays stuck, which is correct here: a genuinely stuck fulfillment
  // is not "expected state" the way a quiet inbox would misleadingly imply.
  const stalePendingGetaways = await prisma.user.findMany({
    where: {
      getawayFulfillmentStatus:   'pending',
      getawayDestinationChosenAt: { lt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    },
    select: { email: true, getawayDestinationId: true, getawayDestinationChosenAt: true },
  });
  findings.push(flag(
    'getaway-stale-pending', 'Getaway fulfillment stuck pending for over an hour',
    stalePendingGetaways.length,
    'Marketing Boost has no idempotency key or lookup endpoint, so this is never auto-resent or auto-resolved — verify manually with Marketing Boost whether the certificate was actually sent, then update getawayFulfillmentStatus by hand.',
    'error', stalePendingGetaways.slice(0, 5).map((u) => `${u.email} (${u.getawayDestinationId})`),
  ));

  // Winback: eligible users sitting untouched means the cron is not running.
  const staleWinback = await prisma.user.count({
    where: {
      plan:                'free',
      emailOptOut:         false,
      winbackStep:         0,
      stripeInterval:      { not: 'lifetime' },
      emailCampaignEnrolledAt: { not: null },
      createdAt:           { lt: new Date(Date.now() - 7 * 86_400_000).toISOString() },
    },
  });
  findings.push(flag(
    'winback-not-running', 'Win-back eligible users never contacted',
    staleWinback,
    'Lapsed free users who qualify but have never received step 1 after 7+ days. The winback cron existed for weeks without being scheduled — this is the detector for that.',
  ));

  const hits = findings.filter(Boolean) as Finding[];
  const errors = hits.filter((f) => f.severity === 'error');

  if (!dryRun && hits.length > 0) {
    const row = (f: Finding) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;vertical-align:top;">
          <p style="margin:0 0 3px;font-size:14px;font-weight:800;color:${f.severity === 'error' ? '#b91c1c' : '#92400e'};">
            ${f.severity === 'error' ? '🔴' : '🟠'} ${f.label} — ${f.count}
          </p>
          <p style="margin:0;font-size:12px;color:#475569;line-height:1.5;">${f.detail}</p>
          ${f.sample?.length ? `<p style="margin:4px 0 0;font-size:11px;color:#94a3b8;">${f.sample.join(' · ')}</p>` : ''}
        </td>
      </tr>`;
    await sendMail({
      to:      ADMIN_EMAIL,
      subject: `${errors.length ? '🔴' : '🟠'} GasCap™ integrity check — ${hits.length} finding${hits.length === 1 ? '' : 's'}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
          <p style="font-size:20px;font-weight:900;color:#1e2d4a;margin:0 0 4px;">Integrity check</p>
          <p style="font-size:13px;color:#64748b;margin:0 0 18px;">
            ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET ·
            only sent when something needs attention
          </p>
          <table style="width:100%;border-collapse:collapse;">${hits.map(row).join('')}</table>
        </div>`,
      text: hits.map((f) => `[${f.severity}] ${f.label}: ${f.count} — ${f.detail}`).join('\n\n'),
    }).catch((e) => console.error('[integrity-check] email failed:', e));
  }

  console.log(`[integrity-check] ${hits.length} finding(s), ${errors.length} error(s)`);
  return NextResponse.json({
    ok: true,
    dryRun,
    findings: hits,
    clean:    hits.length === 0,
    ranAt:    new Date().toISOString(),
  });
}

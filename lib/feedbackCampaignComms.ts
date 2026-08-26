/**
 * Phase 5C — Feedback Campaign communications: initial invitation email, one
 * reminder email, one push reminder. All three are no-ops with zero side
 * effects when no Campaign is currently active (getActiveCampaign() returns
 * null) — this file never creates a Campaign, and no row (CampaignParticipation
 * or CampaignCommunication) is ever created for a user this run doesn't
 * actually determine is eligible and about to be contacted.
 *
 * IDEMPOTENCY ARCHITECTURE (2026-08-26 revision, replacing the original
 * EmailLog-based design after an audit found two real correctness bugs in
 * it — see docs history / the audit that preceded this):
 *
 *   Authoritative ledger: CampaignCommunication, one row per
 *   (campaignId, userId, kind). The CLAIM is the `create()` call itself,
 *   relying on the `@@unique([campaignId, userId, kind])` DB constraint —
 *   NOT a findFirst-then-create pattern, which cannot close a race between
 *   two concurrent invocations. A losing concurrent worker gets a P2002 and
 *   skips the provider call entirely; it never reads a stale "not sent yet"
 *   value. Once a row exists in ANY state (claimed/sent/ambiguous/failed/
 *   no_channel), automated code never touches that tuple again — no
 *   auto-retry, ever, per the approved retry policy. This also fixes the
 *   cross-campaign bleed the old design had: EmailLog was global per
 *   (userId, type) with no campaignId, so a past campaign's send could
 *   permanently block a future, unrelated campaign for the same user.
 *
 *   EmailLog is still written (via lib/emailLog.ts) for cross-cutting admin
 *   visibility, but is no longer read for dedup — see lib/emailLog.ts's own
 *   docs for its unrelated, still-current uses elsewhere in the app.
 *
 * STATE SEMANTICS (see lib/feedbackCampaignShared.ts's
 * CAMPAIGN_COMMUNICATION_STATES for the canonical definitions): only 'sent'
 * may ever be reported as sent or trigger *_sent analytics. 'ambiguous' is
 * used whenever sendMail()'s current binary throw/resolve contract cannot
 * safely distinguish "provider queued it, we just didn't hear back" from a
 * real failure — see classifyEmailError() below for the one case (Resend's
 * own `!res.ok` HTTP response) where a definite 'failed' can honestly be
 * asserted instead. This is a real, audited limitation of lib/email.ts's
 * current contract, not solved here — solving it would mean changing that
 * shared contract for every other email family in this codebase, well
 * beyond this phase's scope.
 */
import { prisma } from './prisma';
import { Prisma } from './generated/prisma/client';
import { sendMail } from './email';
import { logEmail, logEmailError } from './emailLog';
import { sendUserPush } from './userPush';
import { recordAnalyticsEvent } from './analyticsEvents';
import { getActiveCampaign, hasMeaningfulUsage, accountAgeDays, ACCOUNT_AGE_DAYS_MIN } from './feedbackCampaign';
import { feedbackInviteEmailHtml, feedbackInviteEmailText, feedbackReminderEmailHtml, feedbackReminderEmailText, formatCampaignDeadline } from './emailFeedbackCampaign';
import type { Locale } from './translations';
import { getTranslations } from './translations';
import type { CampaignCommunicationKind } from './feedbackCampaignShared';

const EMAIL_TYPE_INVITE = 'feedback_invite';
const EMAIL_TYPE_REMINDER = 'feedback_reminder';

/**
 * Cap per run/per phase — same rationale as app/api/cron/first-fillup-nudge:
 * sends are sequential, GitHub Actions calls this cron with
 * `curl --max-time 30`, and this is a low-volume domain where a sudden
 * burst is itself worth avoiding. Remainder rolls to the next run.
 */
const MAX_PER_RUN = 40;

/** Candidate pool multiplier — how many rows to pull per phase before filtering down to MAX_PER_RUN actual sends, since eligibility/dedup filtering happens in application code, not SQL. */
const CANDIDATE_POOL_SIZE = MAX_PER_RUN * 5;

/** Reminder fires this many days after the invite, unless Campaign.config overrides it. */
const DEFAULT_REMINDER_DELAY_DAYS = 6;

function reminderDelayDays(campaignConfig: unknown): number {
  if (campaignConfig && typeof campaignConfig === 'object' && 'reminderDelayDays' in campaignConfig) {
    const v = (campaignConfig as { reminderDelayDays?: unknown }).reminderDelayDays;
    if (typeof v === 'number' && v > 0) return v;
  }
  return DEFAULT_REMINDER_DELAY_DAYS;
}

function resolveLocale(userLocale: string | null | undefined): Locale {
  return userLocale === 'es' ? 'es' : 'en';
}

function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 500);
}

/**
 * Conservative classifier for lib/email.ts's binary throw contract. Only the
 * Resend branch's own `!res.ok` path (a real HTTP response telling us the
 * provider rejected the request) is a genuine, provable 'failed'. Every
 * other exception — a fetch-level network error, an SMTP transport error, a
 * timeout — carries no reliable signal about whether the provider actually
 * queued the message before the exception surfaced, so it is classified
 * 'ambiguous' rather than overstating certainty.
 */
function classifyEmailError(err: unknown): 'failed' | 'ambiguous' {
  if (err instanceof Error && err.message.startsWith('Email send failed:')) return 'failed';
  return 'ambiguous';
}

/**
 * Atomically claims (campaignId, userId, kind). Returns the claimed row, or
 * null if another worker already owns this tuple (in any state) — the
 * P2002 IS the concurrency lock, not a prior findFirst read.
 */
async function claimCommunication(campaignId: string, userId: string, kind: CampaignCommunicationKind, now: Date) {
  try {
    return await prisma.campaignCommunication.create({
      data: { campaignId, userId, kind, state: 'claimed', attemptedAt: now },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
    throw err;
  }
}

export interface CommsRunSummary {
  noop?: 'no_active_campaign';
  campaignKey?: string;
  invitesSent: number;
  remindersSent: number;
  pushSent: number;
}

/**
 * Runs all three communication phases for the currently active Campaign, if
 * any. A clean, side-effect-free no-op when no Campaign is active — this is
 * the safety property Phase 5C depends on (deploying this code must not, by
 * itself, contact anyone while the Campaign table stays empty).
 */
export async function runFeedbackCampaignComms(now: Date = new Date(), dryRun = false): Promise<CommsRunSummary> {
  const campaign = await getActiveCampaign(now);
  if (!campaign) {
    return { noop: 'no_active_campaign', invitesSent: 0, remindersSent: 0, pushSent: 0 };
  }

  const deadlineByLocale: Record<Locale, string | null> = {
    en: campaign.endsAt ? formatCampaignDeadline(campaign.endsAt, campaign.timezone, 'en') : null,
    es: campaign.endsAt ? formatCampaignDeadline(campaign.endsAt, campaign.timezone, 'es') : null,
  };

  const invitesSent = await sendInvites(campaign, now, deadlineByLocale, dryRun);
  const remindersSent = await sendReminders(campaign, now, deadlineByLocale, dryRun);
  const pushSent = await sendPushReminders(campaign, now, deadlineByLocale, dryRun);

  return { campaignKey: campaign.key, invitesSent, remindersSent, pushSent };
}

async function sendInvites(
  campaign: { id: string; endsAt: Date | null; timezone: string },
  now: Date,
  deadlineByLocale: Record<Locale, string | null>,
  dryRun: boolean,
): Promise<number> {
  const cutoff = new Date(now.getTime() - ACCOUNT_AGE_DAYS_MIN * 86_400_000);

  const candidates = await prisma.user.findMany({
    where: { createdAt: { lte: cutoff.toISOString() }, emailOptOut: false },
    orderBy: { createdAt: 'asc' },
    take: CANDIDATE_POOL_SIZE,
    select: { id: true, email: true, name: true, createdAt: true, calcCount: true, activeDays: true, locale: true },
  });

  let sent = 0;
  for (const user of candidates) {
    if (sent >= MAX_PER_RUN) break;
    if (accountAgeDays(user.createdAt, now) < ACCOUNT_AGE_DAYS_MIN) continue;

    const participation = await prisma.campaignParticipation.findUnique({
      where: { campaignId_userId: { campaignId: campaign.id, userId: user.id } },
    });
    if (participation?.submittedAt) continue; // already submitted — never invite again
    if (!(await hasMeaningfulUsage(user.id, user))) continue; // canonical Phase 5A eligibility, not duplicated

    if (dryRun) { sent += 1; continue; }

    const claim = await claimCommunication(campaign.id, user.id, 'invite_email', now);
    if (!claim) continue; // already claimed/sent/ambiguous/failed by a prior or concurrent run — never resend

    const locale = resolveLocale(user.locale);
    const deadline = deadlineByLocale[locale] ?? deadlineByLocale.en ?? '';
    const subject = getTranslations(locale).feedbackCampaignEmail.inviteSubject;
    try {
      await sendMail({
        to: user.email,
        subject,
        html: feedbackInviteEmailHtml(user.name, user.id, deadline, locale),
        text: feedbackInviteEmailText(user.name, deadline, locale),
        unsubscribeUrl: `${process.env.NEXTAUTH_URL ?? 'https://www.gascap.app'}/api/email/unsubscribe?id=${user.id}`,
        tags: [{ name: 'campaign', value: 'feedback-invite' }],
      });

      await prisma.campaignCommunication.update({ where: { id: claim.id }, data: { state: 'sent', sentAt: now } });
      await logEmail({ userId: user.id, userEmail: user.email, userName: user.name, type: EMAIL_TYPE_INVITE, subject });
      await prisma.campaignParticipation.upsert({
        where: { campaignId_userId: { campaignId: campaign.id, userId: user.id } },
        create: { campaignId: campaign.id, userId: user.id, inviteSentAt: now },
        update: { inviteSentAt: now },
      });
      await recordAnalyticsEvent({
        eventType: 'feedback_invite_email_sent',
        originPlatform: 'unknown', emitter: 'server', userId: user.id, source: 'feedback_campaign_cron',
        idempotencyKey: `feedback_invite_email_sent:${campaign.id}:${user.id}`,
      });
      sent += 1;
    } catch (err) {
      const state = classifyEmailError(err);
      await prisma.campaignCommunication.update({ where: { id: claim.id }, data: { state, lastError: sanitizeError(err) } });
      await logEmailError({ userId: user.id, userEmail: user.email, userName: user.name, type: EMAIL_TYPE_INVITE, subject }, err);
      console.error(`[feedback-campaign-comms] invite send ${state}:`, err);
    }
  }
  return sent;
}

async function sendReminders(
  campaign: { id: string; endsAt: Date | null; timezone: string; config: unknown },
  now: Date,
  deadlineByLocale: Record<Locale, string | null>,
  dryRun: boolean,
): Promise<number> {
  const delayDays = reminderDelayDays(campaign.config);
  const reminderCutoff = new Date(now.getTime() - delayDays * 86_400_000);

  // inviteSentAt is only ever stamped on a CONFIRMED-sent invite (see
  // sendInvites above) — the reminder delay anchor is therefore always a
  // real accepted-send timestamp, never an ambiguous/failed attempt.
  const candidates = await prisma.campaignParticipation.findMany({
    where: { campaignId: campaign.id, inviteSentAt: { not: null, lte: reminderCutoff }, submittedAt: null },
    orderBy: { inviteSentAt: 'asc' },
    take: CANDIDATE_POOL_SIZE,
    include: { user: { select: { id: true, email: true, name: true, createdAt: true, calcCount: true, activeDays: true, locale: true } } },
  });

  let sent = 0;
  for (const p of candidates) {
    if (sent >= MAX_PER_RUN) break;
    const user = p.user;
    if (!user) continue; // account deleted since invite (SetNull) — nothing to send to
    if (!(await hasMeaningfulUsage(user.id, user))) continue; // re-check — "remains eligible"

    if (dryRun) { sent += 1; continue; }

    const claim = await claimCommunication(campaign.id, user.id, 'reminder_email', now);
    if (!claim) continue; // one reminder, ever — any existing row blocks resend

    const locale = resolveLocale(user.locale);
    const deadline = deadlineByLocale[locale] ?? deadlineByLocale.en ?? '';
    const subject = getTranslations(locale).feedbackCampaignEmail.reminderSubject;
    try {
      await sendMail({
        to: user.email,
        subject,
        html: feedbackReminderEmailHtml(user.name, user.id, deadline, locale),
        text: feedbackReminderEmailText(user.name, deadline, locale),
        unsubscribeUrl: `${process.env.NEXTAUTH_URL ?? 'https://www.gascap.app'}/api/email/unsubscribe?id=${user.id}`,
        tags: [{ name: 'campaign', value: 'feedback-reminder' }],
      });

      await prisma.campaignCommunication.update({ where: { id: claim.id }, data: { state: 'sent', sentAt: now } });
      await logEmail({ userId: user.id, userEmail: user.email, userName: user.name, type: EMAIL_TYPE_REMINDER, subject });
      await recordAnalyticsEvent({
        eventType: 'feedback_reminder_email_sent',
        originPlatform: 'unknown', emitter: 'server', userId: user.id, source: 'feedback_campaign_cron',
        idempotencyKey: `feedback_reminder_email_sent:${campaign.id}:${user.id}`,
      });
      sent += 1;
    } catch (err) {
      const state = classifyEmailError(err);
      await prisma.campaignCommunication.update({ where: { id: claim.id }, data: { state, lastError: sanitizeError(err) } });
      await logEmailError({ userId: user.id, userEmail: user.email, userName: user.name, type: EMAIL_TYPE_REMINDER, subject }, err);
      console.error(`[feedback-campaign-comms] reminder send ${state}:`, err);
    }
  }
  return sent;
}

async function sendPushReminders(
  campaign: { id: string; endsAt: Date | null; timezone: string; config: unknown },
  now: Date,
  deadlineByLocale: Record<Locale, string | null>,
  dryRun: boolean,
): Promise<number> {
  const delayDays = reminderDelayDays(campaign.config);
  const reminderCutoff = new Date(now.getTime() - delayDays * 86_400_000);

  const candidates = await prisma.campaignParticipation.findMany({
    where: { campaignId: campaign.id, inviteSentAt: { not: null, lte: reminderCutoff }, submittedAt: null, pushSentAt: null },
    orderBy: { inviteSentAt: 'asc' },
    take: CANDIDATE_POOL_SIZE,
    include: { user: { select: { id: true, name: true, createdAt: true, calcCount: true, activeDays: true, locale: true } } },
  });

  let sent = 0;
  for (const p of candidates) {
    if (sent >= MAX_PER_RUN) break;
    const user = p.user;
    if (!user) continue;
    if (!(await hasMeaningfulUsage(user.id, user))) continue;

    if (dryRun) { sent += 1; continue; }

    const claim = await claimCommunication(campaign.id, user.id, 'reminder_push', now);
    if (!claim) continue; // already claimed/sent/ambiguous/failed/no_channel — never resend

    const locale = resolveLocale(user.locale);
    const deadline = deadlineByLocale[locale] ?? deadlineByLocale.en ?? '';
    const t = getTranslations(locale).feedbackCampaignEmail;
    try {
      // sendUserPush is documented never to throw (best-effort across
      // OneSignal/APNs), but this try/catch stays as a defensive backstop —
      // if it ever did throw, that's genuinely ambiguous delivery, not a
      // definite failure.
      const delivered = await sendUserPush(user.id, t.pushTitle, t.pushBody(deadline), '/feedback?source=push');
      if (delivered) {
        await prisma.campaignCommunication.update({ where: { id: claim.id }, data: { state: 'sent', sentAt: now } });
        await prisma.campaignParticipation.update({ where: { id: p.id }, data: { pushSentAt: now } });
        await recordAnalyticsEvent({
          eventType: 'feedback_push_sent',
          originPlatform: 'unknown', emitter: 'server', userId: user.id, source: 'feedback_campaign_cron',
          idempotencyKey: `feedback_push_sent:${campaign.id}:${user.id}`,
        });
        sent += 1;
      } else {
        // Definite, non-error non-delivery — the user simply has no usable
        // OneSignal subscription or APNs token right now. Not retried later
        // even if a channel appears, per the approved at-most-once policy.
        await prisma.campaignCommunication.update({ where: { id: claim.id }, data: { state: 'no_channel' } });
      }
    } catch (err) {
      await prisma.campaignCommunication.update({ where: { id: claim.id }, data: { state: 'ambiguous', lastError: sanitizeError(err) } });
      console.error('[feedback-campaign-comms] push send ambiguous:', err);
    }
  }
  return sent;
}

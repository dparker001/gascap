/**
 * Phase 5A — Feedback Campaign foundation (2026-08-26).
 *
 * Server-authoritative eligibility, invite-state, and atomic submission for
 * the GasCap Feedback Campaign. The client never computes eligibility or
 * expiration itself — everything here is read/written from Postgres, never
 * a client clock or localStorage.
 *
 * Deliberately independent of lib/giveaway.ts — see the schema comment
 * above the Campaign model in prisma/schema.prisma for why the existing
 * monthly-drawing entry math, plan bonuses, Ambassador multipliers, AMOE,
 * and repeat-winner cooldowns are NOT imported here.
 */
import { prisma } from './prisma';
import { Prisma } from './generated/prisma/client';
import { recordAnalyticsEvent } from './analyticsEvents';
import {
  PRIMARY_FEATURE_OPTIONS, PMF_OPTIONS, RENTAL_HELPFULNESS_OPTIONS,
  type PrimaryFeature, type PmfResponse, type RentalHelpfulness,
} from './feedbackCampaignShared';

// Re-exported for existing server-side importers — new client-side code
// (e.g. app/feedback/page.tsx) must import these from
// './feedbackCampaignShared' directly instead (see that file's header).
export { PRIMARY_FEATURE_OPTIONS, PMF_OPTIONS, RENTAL_HELPFULNESS_OPTIONS };
export type { PrimaryFeature, PmfResponse, RentalHelpfulness };

const ACCOUNT_AGE_DAYS_MIN = 7;
const ACTIVE_DAYS_MIN = 3;

export interface FeedbackSubmission {
  overallSatisfaction: number; // 1-5
  primaryFeature: PrimaryFeature;
  likes: string;
  frustrations: string;
  hadIssue: boolean;
  issueDescription?: string | null;
  improvementRequest: string;
  featureRequest: string;
  pmfResponse: PmfResponse;
  // Only valid (and only stored) when the user has RentalSession usage.
  rentalEaseScore?: number | null; // 1-5
  rentalHelpfulness?: RentalHelpfulness | null;
  rentalImprovement?: string | null;
  platform?: string | null;
  appVersion?: string | null;
}

export type SubmitFeedbackResult =
  | { outcome: 'submitted'; responseId: string }
  | { outcome: 'duplicate' }
  | { outcome: 'ineligible' }
  | { outcome: 'campaign_closed' }
  | { outcome: 'invalid'; reason: string };

/** The campaign whose window (startsAt..endsAt) contains `now`, most recently started. Null if none. */
export async function getActiveCampaign(now: Date = new Date()) {
  return prisma.campaign.findFirst({
    where: {
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
    },
    orderBy: { startsAt: 'desc' },
  });
}

async function hasMeaningfulUsage(userId: string, user: { calcCount: number; activeDays: string[] }) {
  if (user.calcCount >= 1) return true;
  if (user.activeDays.length >= ACTIVE_DAYS_MIN) return true;
  const [fillupCount, vehicleCount, rentalCount] = await Promise.all([
    prisma.fillup.count({ where: { userId } }),
    prisma.vehicle.count({ where: { userId } }),
    prisma.rentalSession.count({ where: { userId } }),
  ]);
  return fillupCount > 0 || vehicleCount > 0 || rentalCount > 0;
}

function accountAgeDays(createdAt: string, now: Date): number {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  return (now.getTime() - created) / (1000 * 60 * 60 * 24);
}

export interface FeedbackStatus {
  campaignKey: string | null;
  eligible: boolean;
  alreadySubmitted: boolean;
  hasRentalUsage: boolean;
  inviteShown: boolean;
  campaignEndsAt: string | null;
  campaignTimezone: string | null;
}

/** Server-authoritative status for GET /api/feedback/status. Also lazily stamps eligibleAt/records feedback_invite_eligible on first eligible read. */
export async function getFeedbackStatus(userId: string, now: Date = new Date()): Promise<FeedbackStatus> {
  const campaign = await getActiveCampaign(now);
  if (!campaign) {
    return {
      campaignKey: null, eligible: false, alreadySubmitted: false,
      hasRentalUsage: false, inviteShown: false, campaignEndsAt: null, campaignTimezone: null,
    };
  }

  const [user, rentalCount, participation] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, calcCount: true, activeDays: true } }),
    prisma.rentalSession.count({ where: { userId } }),
    prisma.campaignParticipation.findUnique({ where: { campaignId_userId: { campaignId: campaign.id, userId } } }),
  ]);

  if (!user) {
    return {
      campaignKey: campaign.key, eligible: false, alreadySubmitted: false,
      hasRentalUsage: false, inviteShown: false,
      campaignEndsAt: campaign.endsAt?.toISOString() ?? null, campaignTimezone: campaign.timezone,
    };
  }

  const alreadySubmitted = participation?.submittedAt != null;
  const eligible = !alreadySubmitted
    && accountAgeDays(user.createdAt, now) >= ACCOUNT_AGE_DAYS_MIN
    && await hasMeaningfulUsage(userId, user);

  if (eligible && !participation?.eligibleAt) {
    const row = await prisma.campaignParticipation.upsert({
      where: { campaignId_userId: { campaignId: campaign.id, userId } },
      create: { campaignId: campaign.id, userId, eligibleAt: now },
      update: { eligibleAt: now },
    });
    await recordAnalyticsEvent({
      eventType: 'feedback_invite_eligible',
      originPlatform: 'unknown',
      emitter: 'server',
      userId,
      source: 'feedback_status',
      idempotencyKey: `feedback_invite_eligible:${row.id}`,
    });
  }

  return {
    campaignKey: campaign.key,
    eligible,
    alreadySubmitted,
    hasRentalUsage: rentalCount > 0,
    inviteShown: participation?.inviteShownAt != null,
    campaignEndsAt: campaign.endsAt?.toISOString() ?? null,
    campaignTimezone: campaign.timezone,
  };
}

async function stampParticipationField(
  campaignId: string,
  userId: string,
  field: 'inviteShownAt' | 'openedAt' | 'startedAt',
  eventType: string,
  now: Date,
) {
  const existing = await prisma.campaignParticipation.findUnique({ where: { campaignId_userId: { campaignId, userId } } });
  if (existing?.[field]) return; // already stamped — one-time event
  const row = await prisma.campaignParticipation.upsert({
    where: { campaignId_userId: { campaignId, userId } },
    create: { campaignId, userId, [field]: now },
    update: { [field]: now },
  });
  await recordAnalyticsEvent({
    eventType,
    originPlatform: 'unknown',
    emitter: 'server',
    userId,
    source: 'feedback_campaign',
    idempotencyKey: `${eventType}:${row.id}`,
  });
}

export async function markInviteShown(campaignId: string, userId: string, now: Date = new Date()) {
  return stampParticipationField(campaignId, userId, 'inviteShownAt', 'feedback_invite_shown', now);
}
export async function markInviteOpened(campaignId: string, userId: string, now: Date = new Date()) {
  return stampParticipationField(campaignId, userId, 'openedAt', 'feedback_invite_opened', now);
}
export async function markSurveyStarted(campaignId: string, userId: string, now: Date = new Date()) {
  return stampParticipationField(campaignId, userId, 'startedAt', 'feedback_started', now);
}

function validateSubmission(input: FeedbackSubmission, hasRentalUsage: boolean): string | null {
  if (!Number.isInteger(input.overallSatisfaction) || input.overallSatisfaction < 1 || input.overallSatisfaction > 5) {
    return 'overallSatisfaction must be an integer 1-5';
  }
  if (!PRIMARY_FEATURE_OPTIONS.includes(input.primaryFeature)) return 'invalid primaryFeature';
  if (!input.likes?.trim()) return 'likes is required';
  if (!input.frustrations?.trim()) return 'frustrations is required';
  if (typeof input.hadIssue !== 'boolean') return 'hadIssue must be boolean';
  if (input.hadIssue && !input.issueDescription?.trim()) return 'issueDescription is required when hadIssue is true';
  if (!input.improvementRequest?.trim()) return 'improvementRequest is required';
  if (!input.featureRequest?.trim()) return 'featureRequest is required';
  if (!PMF_OPTIONS.includes(input.pmfResponse)) return 'invalid pmfResponse';

  if (hasRentalUsage) {
    if (input.rentalEaseScore != null && (!Number.isInteger(input.rentalEaseScore) || input.rentalEaseScore < 1 || input.rentalEaseScore > 5)) {
      return 'rentalEaseScore must be an integer 1-5';
    }
    if (input.rentalHelpfulness != null && !RENTAL_HELPFULNESS_OPTIONS.includes(input.rentalHelpfulness)) {
      return 'invalid rentalHelpfulness';
    }
  } else if (input.rentalEaseScore != null || input.rentalHelpfulness != null || input.rentalImprovement != null) {
    // Never make believe rental data — a user with no RentalSession usage
    // cannot have a real answer to a Rental Return question. Reject rather
    // than silently discard, since a client sending this either has a bug
    // or is trying to fabricate data the server never asked for.
    return 'rental questions were not offered to this user';
  }
  return null;
}

/**
 * Atomic first-and-only submission: FeedbackResponse + DrawingEntry +
 * participation.submittedAt/drawingEntryGrantedAt all succeed together or
 * not at all. DB-level unique constraints (campaignId, userId) on both
 * FeedbackResponse and DrawingEntry are the actual defense against a
 * replayed/duplicate submission — a retry after a successful first
 * submission always resolves to {outcome:'duplicate'}, never a second row.
 */
export async function submitFeedback(
  userId: string,
  input: FeedbackSubmission,
  now: Date = new Date(),
): Promise<SubmitFeedbackResult> {
  const campaign = await getActiveCampaign(now);
  if (!campaign) return { outcome: 'campaign_closed' };

  const status = await getFeedbackStatus(userId, now);
  if (status.campaignKey !== campaign.key) return { outcome: 'campaign_closed' };
  if (status.alreadySubmitted) return { outcome: 'duplicate' };
  if (!status.eligible) return { outcome: 'ineligible' };

  const invalidReason = validateSubmission(input, status.hasRentalUsage);
  if (invalidReason) return { outcome: 'invalid', reason: invalidReason };

  try {
    const responseId = await prisma.$transaction(async (tx) => {
      const response = await tx.feedbackResponse.create({
        data: {
          campaignId: campaign.id,
          userId,
          overallSatisfaction: input.overallSatisfaction,
          primaryFeature: input.primaryFeature,
          likes: input.likes.trim(),
          frustrations: input.frustrations.trim(),
          hadIssue: input.hadIssue,
          issueDescription: input.hadIssue ? (input.issueDescription?.trim() || null) : null,
          improvementRequest: input.improvementRequest.trim(),
          featureRequest: input.featureRequest.trim(),
          pmfResponse: input.pmfResponse,
          rentalEaseScore: status.hasRentalUsage ? (input.rentalEaseScore ?? null) : null,
          rentalHelpfulness: status.hasRentalUsage ? (input.rentalHelpfulness ?? null) : null,
          rentalImprovement: status.hasRentalUsage ? (input.rentalImprovement?.trim() || null) : null,
          platform: input.platform ?? null,
          appVersion: input.appVersion ?? null,
          submittedAt: now,
        },
      });

      await tx.drawingEntry.create({
        data: { campaignId: campaign.id, userId, kind: 'feedback_campaign', source: 'feedback_submission' },
      });

      await tx.campaignParticipation.upsert({
        where: { campaignId_userId: { campaignId: campaign.id, userId } },
        create: { campaignId: campaign.id, userId, submittedAt: now, drawingEntryGrantedAt: now },
        update: { submittedAt: now, drawingEntryGrantedAt: now },
      });

      return response.id;
    });

    await recordAnalyticsEvent({
      eventType: 'feedback_submitted',
      originPlatform: 'unknown',
      emitter: 'server',
      userId,
      source: 'feedback_campaign',
      idempotencyKey: `feedback_submitted:${responseId}`,
    });
    await recordAnalyticsEvent({
      eventType: 'feedback_drawing_entry_granted',
      originPlatform: 'unknown',
      emitter: 'server',
      userId,
      source: 'feedback_campaign',
      idempotencyKey: `feedback_drawing_entry_granted:${responseId}`,
    });

    return { outcome: 'submitted', responseId };
  } catch (err) {
    // P2002 = unique constraint violation on (campaignId, userId) for
    // FeedbackResponse or DrawingEntry — a concurrent/replayed request won
    // the race. Treat as the same successful-once outcome, not an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { outcome: 'duplicate' };
    }
    throw err;
  }
}

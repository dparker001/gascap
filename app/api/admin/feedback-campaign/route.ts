/**
 * Admin Feedback Campaign API (Phase 5A) — read-only aggregation.
 * GET /api/admin/feedback-campaign — the active/most-recent Campaign plus
 * funnel counts, satisfaction/PMF/feature-usage breakdowns, and
 * response-level rows for inspection. No winner-selection logic here —
 * deferred to a later phase per the Phase 5A instructions.
 */
import { NextResponse } from 'next/server';
import { sessionHasAdminRole, legacyAdminPasswordOk } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';

async function auth(req: Request): Promise<boolean> {
  const legacyOk = legacyAdminPasswordOk(req, process.env.ADMIN_PASSWORD);
  return legacyOk || await sessionHasAdminRole();
}

function drawingStatus(campaign: { startsAt: Date; endsAt: Date | null; drawingAt: Date | null }, now: Date, hasWinnerData: boolean) {
  if (hasWinnerData) return 'winner_selected';
  if (campaign.startsAt > now) return 'upcoming';
  if (!campaign.endsAt || campaign.endsAt > now) return 'open';
  return 'closed_awaiting_draw';
}

export async function GET(req: Request) {
  if (!await auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  const campaign = key
    ? await prisma.campaign.findUnique({ where: { key } })
    : await prisma.campaign.findFirst({ orderBy: { startsAt: 'desc' } });

  if (!campaign) return NextResponse.json({ campaign: null });

  const [
    eligibleCount, inviteShownCount, startedCount, submittedCount,
    drawingEntryCount, responses, communications,
  ] = await Promise.all([
    prisma.campaignParticipation.count({ where: { campaignId: campaign.id, eligibleAt: { not: null } } }),
    prisma.campaignParticipation.count({ where: { campaignId: campaign.id, inviteShownAt: { not: null } } }),
    prisma.campaignParticipation.count({ where: { campaignId: campaign.id, startedAt: { not: null } } }),
    prisma.campaignParticipation.count({ where: { campaignId: campaign.id, submittedAt: { not: null } } }),
    prisma.drawingEntry.count({ where: { campaignId: campaign.id, kind: 'feedback_campaign' } }),
    prisma.feedbackResponse.findMany({ where: { campaignId: campaign.id }, orderBy: { submittedAt: 'desc' } }),
    // CampaignCommunication is the authoritative, campaign-scoped ledger
    // (see lib/feedbackCampaignComms.ts) — replaces the old global EmailLog
    // count, which had no campaignId column and could not distinguish this
    // campaign's sends from any other campaign's.
    prisma.campaignCommunication.groupBy({ by: ['kind', 'state'], where: { campaignId: campaign.id }, _count: { _all: true } }),
  ]);

  const commsBreakdown: Record<string, Record<string, number>> = { invite_email: {}, reminder_email: {}, reminder_push: {} };
  for (const row of communications) {
    if (!commsBreakdown[row.kind]) commsBreakdown[row.kind] = {};
    commsBreakdown[row.kind][row.state] = row._count._all;
  }

  const avgSatisfaction = responses.length
    ? responses.reduce((sum, r) => sum + r.overallSatisfaction, 0) / responses.length
    : null;

  const featureBreakdown: Record<string, number> = {};
  const pmfBreakdown: Record<string, number> = {};
  let issueCount = 0;
  const rentalResponses = responses.filter((r) => r.rentalEaseScore != null || r.rentalHelpfulness != null);

  for (const r of responses) {
    featureBreakdown[r.primaryFeature] = (featureBreakdown[r.primaryFeature] ?? 0) + 1;
    pmfBreakdown[r.pmfResponse] = (pmfBreakdown[r.pmfResponse] ?? 0) + 1;
    if (r.hadIssue) issueCount += 1;
  }

  const avgRentalEase = rentalResponses.length
    ? rentalResponses.reduce((sum, r) => sum + (r.rentalEaseScore ?? 0), 0) / rentalResponses.filter((r) => r.rentalEaseScore != null).length
    : null;

  return NextResponse.json({
    campaign: {
      key: campaign.key,
      name: campaign.name,
      startsAt: campaign.startsAt.toISOString(),
      endsAt: campaign.endsAt?.toISOString() ?? null,
      drawingAt: campaign.drawingAt?.toISOString() ?? null,
      timezone: campaign.timezone,
      drawingStatus: drawingStatus(campaign, new Date(), false),
    },
    funnel: {
      eligible: eligibleCount,
      inviteShown: inviteShownCount,
      started: startedCount,
      submitted: submittedCount,
      completionRate: inviteShownCount > 0 ? submittedCount / inviteShownCount : null,
      drawingEntries: drawingEntryCount,
    },
    communications: commsBreakdown,
    avgSatisfaction,
    featureBreakdown,
    pmfBreakdown,
    issueCount,
    rentalResponseCount: rentalResponses.length,
    avgRentalEase,
    responses: responses.map((r) => ({
      id: r.id,
      submittedAt: r.submittedAt.toISOString(),
      overallSatisfaction: r.overallSatisfaction,
      primaryFeature: r.primaryFeature,
      likes: r.likes,
      frustrations: r.frustrations,
      hadIssue: r.hadIssue,
      issueDescription: r.issueDescription,
      improvementRequest: r.improvementRequest,
      featureRequest: r.featureRequest,
      pmfResponse: r.pmfResponse,
      rentalEaseScore: r.rentalEaseScore,
      rentalHelpfulness: r.rentalHelpfulness,
      rentalImprovement: r.rentalImprovement,
      platform: r.platform,
    })),
  });
}

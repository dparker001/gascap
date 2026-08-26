/**
 * GET /api/cron/feedback-campaign-comms
 *
 * Phase 5C — Feedback Campaign communications: initial invitation email, one
 * reminder email, one push reminder. A single idempotent cron rather than
 * three separate routes (see lib/feedbackCampaignComms.ts's header for the
 * full idempotency/eligibility/dedup design).
 *
 * SAFETY PROPERTY THIS ROUTE DEPENDS ON: with zero rows in the Campaign
 * table (the production state as of Phase 5C), this is a clean, side-effect-
 * free no-op on every single invocation — it never creates a Campaign, and
 * it sends nothing. Verified in __tests__/feedbackCampaignComms.test.ts.
 *
 * Secured with CRON_SECRET. ?dryRun=true previews counts without sending
 * and without marking anyone as invited/reminded/pushed.
 */
import { NextResponse } from 'next/server';
import { runFeedbackCampaignComms } from '@/lib/feedbackCampaignComms';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!process.env.CRON_SECRET || searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dryRun = searchParams.get('dryRun') === 'true';

  const summary = await runFeedbackCampaignComms(new Date(), dryRun);
  return NextResponse.json({ ok: true, dryRun, ...summary });
}

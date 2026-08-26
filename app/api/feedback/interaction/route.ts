import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getActiveCampaign, markInviteShown, markInviteOpened, markSurveyStarted } from '@/lib/feedbackCampaign';

const HANDLERS = {
  invite_shown: markInviteShown,
  opened: markInviteOpened,
  started: markSurveyStarted,
} as const;
type InteractionType = keyof typeof HANDLERS;

// POST /api/feedback/interaction { type: 'invite_shown' | 'opened' | 'started' }
// One-time, idempotent funnel-stage markers for the active campaign. Each
// stamps its own CampaignParticipation field at most once (no-op on repeat)
// and fires the matching feedback_invite_shown/feedback_invite_opened/
// feedback_started analytics event exactly once via its idempotency key.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';

  const body = await req.json() as { type?: string };
  const type = body.type as InteractionType | undefined;
  if (!type || !(type in HANDLERS)) {
    return NextResponse.json({ error: 'Invalid interaction type.' }, { status: 400 });
  }

  const campaign = await getActiveCampaign();
  if (!campaign) return NextResponse.json({ ok: true }); // no active campaign — nothing to record

  await HANDLERS[type](campaign.id, userId);
  return NextResponse.json({ ok: true });
}

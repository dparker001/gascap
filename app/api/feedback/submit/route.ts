import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { submitFeedback, type FeedbackSubmission } from '@/lib/feedbackCampaign';

// POST /api/feedback/submit — atomic, idempotent Feedback Campaign
// submission. See lib/feedbackCampaign.ts submitFeedback() for the
// transaction/uniqueness guarantees. Eligibility and "already submitted"
// are re-checked server-side here regardless of what the client believes.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';

  const body = await req.json() as FeedbackSubmission & { nativePlatform?: string };

  const platform = body.nativePlatform === 'ios' || body.nativePlatform === 'android'
    ? body.nativePlatform
    : 'web';

  const result = await submitFeedback(userId, { ...body, platform });

  switch (result.outcome) {
    case 'submitted':
      return NextResponse.json({ ok: true, responseId: result.responseId });
    case 'duplicate':
      // Not an error — a retry/replay of an already-successful submission
      // resolves here, and the client should treat it the same as success.
      return NextResponse.json({ ok: true, duplicate: true });
    case 'ineligible':
      return NextResponse.json({ error: 'Not eligible for this campaign.' }, { status: 403 });
    case 'campaign_closed':
      return NextResponse.json({ error: 'This feedback campaign is not currently open.' }, { status: 410 });
    case 'invalid':
      return NextResponse.json({ error: result.reason }, { status: 400 });
  }
}

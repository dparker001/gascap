import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getFeedbackStatus } from '@/lib/feedbackCampaign';

// GET /api/feedback/status — server-authoritative Feedback Campaign
// eligibility/invite state for the signed-in user. The client renders the
// invitation/survey purely off this response; it never computes eligibility,
// "already submitted," or campaign timing itself.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';

  const status = await getFeedbackStatus(userId);
  return NextResponse.json(status);
}

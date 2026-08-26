import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getFeedbackStatus, getLifetimeOfferStatus } from '@/lib/feedbackCampaign';

// GET /api/feedback/status — server-authoritative Feedback Campaign
// eligibility/invite state for the signed-in user, PLUS (Phase 5B) their
// post-submission $9.99 Lifetime offer state. The client renders the
// invitation/survey/offer purely off this response; it never computes
// eligibility, "already submitted," or offer expiration itself.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';

  const [status, lifetimeOffer] = await Promise.all([
    getFeedbackStatus(userId),
    getLifetimeOfferStatus(userId),
  ]);
  return NextResponse.json({ ...status, ...lifetimeOffer });
}

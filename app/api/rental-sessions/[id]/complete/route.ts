/**
 * POST /api/rental-sessions/:id/complete — "Complete Rental" action.
 * Captures return documentation, fuel-dispute tracking (section 24), and
 * optional feedback rating in one step, then marks the session completed
 * and preserved as history.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RENTAL_RETURN_ASSISTANT_ENABLED } from '@/lib/featureFlags';
import { completeRentalSession, type CompleteRentalSessionInput } from '@/lib/rentalSessions';

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return (session.user as { id?: string })?.id ?? null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as CompleteRentalSessionInput;
  if (body.feedbackRating != null && (body.feedbackRating < 1 || body.feedbackRating > 5)) {
    return NextResponse.json({ error: 'feedbackRating must be 1–5.' }, { status: 400 });
  }

  const updated = await completeRentalSession(userId, params.id, body);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ session: updated });
}

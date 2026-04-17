/**
 * GET  /api/reviews — public list of reviews
 * POST /api/reviews — submit/update a review (auth required)
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById }         from '@/lib/users';
import { getPublicReviews, upsertReview } from '@/lib/reviews';

export async function GET() {
  const reviews = getPublicReviews();
  return NextResponse.json({ reviews });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId   = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user     = await findById(userId);
  const userName = session.user.name ?? user?.name ?? 'GasCap User';
  const plan     = (user?.plan ?? 'free') as 'free' | 'pro' | 'fleet';

  const body = await req.json() as { rating?: number; text?: string; vehicleName?: string };

  if (!body.rating || body.rating < 1 || body.rating > 5) {
    return NextResponse.json({ error: 'Rating must be 1–5.' }, { status: 400 });
  }
  if (!body.text?.trim() || body.text.trim().length < 10) {
    return NextResponse.json({ error: 'Review must be at least 10 characters.' }, { status: 400 });
  }

  const review = upsertReview(userId, userName, body.rating, body.text, plan, body.vehicleName);
  return NextResponse.json(review, { status: 201 });
}

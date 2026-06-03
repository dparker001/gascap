/**
 * GET /api/user/new-member-offer
 * Returns whether the signed-in user is inside the 7-day new-member Lifetime
 * window, and how many days remain. Used by the hero offer banner.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById }         from '@/lib/users';
import { newMemberOfferStatus } from '@/lib/newMemberOffer';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ eligible: false, daysLeft: 0 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = await findById(userId);
  if (!user) return NextResponse.json({ eligible: false, daysLeft: 0 });

  return NextResponse.json(newMemberOfferStatus(user));
}

/**
 * GET /api/user/getaway-offer
 * Returns whether the Pro Lifetime + complimentary getaway promo is active and
 * whether the signed-in user can claim it (i.e. not already on Lifetime), plus
 * any days remaining until the deadline. Used by the hero getaway banner.
 */
import { NextResponse }      from 'next/server';
import { getServerSession }  from 'next-auth';
import { authOptions }       from '@/lib/auth';
import { findById }          from '@/lib/users';
import { getawayOfferStatus, getawayPromoActive, getawayDaysLeft } from '@/lib/getawayPromo';

export async function GET() {
  const session = await getServerSession(authOptions);
  // Logged-out: still report whether the promo is active (the banner only renders
  // for signed-in users, but this keeps the contract consistent).
  if (!session?.user) {
    return NextResponse.json({ active: getawayPromoActive(), eligible: false, daysLeft: getawayDaysLeft() });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = await findById(userId);
  if (!user) {
    return NextResponse.json({ active: getawayPromoActive(), eligible: false, daysLeft: getawayDaysLeft() });
  }

  return NextResponse.json(getawayOfferStatus(user));
}

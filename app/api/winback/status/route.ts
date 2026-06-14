/**
 * GET /api/winback/status
 *
 * Returns whether the signed-in user is eligible for the win-back $9.99 Lifetime
 * offer (lapsed free user who completed a Pro trial). Used by the in-app
 * ComebackBanner so the offer is only shown to people it actually applies to.
 */
import { NextResponse }      from 'next/server';
import { getServerSession }  from 'next-auth';
import { authOptions }       from '@/lib/auth';
import { findById }          from '@/lib/users';
import { winbackOfferAvailable, WINBACK_PRICE_USD } from '@/lib/winbackOffer';

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId  = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ eligible: false });

  const user = await findById(userId);
  if (!user) return NextResponse.json({ eligible: false });

  return NextResponse.json({
    eligible: winbackOfferAvailable(user),
    price:    WINBACK_PRICE_USD,
  });
}

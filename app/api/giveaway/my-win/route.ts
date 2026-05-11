/**
 * GET /api/giveaway/my-win
 *
 * Returns the current user's unclaimed draw record, or null.
 * Used by WinnerBanner to show the in-app claim notification.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { prisma }           from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ draw: null });

  const userId = (session.user as { id?: string })?.id;
  if (!userId) return NextResponse.json({ draw: null });

  const draw = await prisma.giveawayDraw.findFirst({
    where: { winnerId: userId, claimedAt: null },
    orderBy: { drawnAt: 'desc' },
  });

  if (!draw) return NextResponse.json({ draw: null });

  // Return safe subset — no full email or internal IDs needed client-side
  return NextResponse.json({
    draw: {
      month:      draw.month,
      winnerName: draw.winnerName,
      drawnAt:    draw.drawnAt,
    },
  });
}

/**
 * GET /api/giveaway/history
 * Public endpoint — returns past draw winners (name + month only, no email).
 * Used by the /giveaway user-facing page.
 */
import { NextResponse }  from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }   from '@/lib/auth';
import { getDrawHistory, maskWinnerName } from '@/lib/giveaway';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const draws = await getDrawHistory();

  // Strip email and mask name to "First L." — protects winner privacy
  const safe = draws.map((d) => ({
    id:         d.id,
    month:      d.month,
    winnerName: maskWinnerName(d.winnerName),
    drawnAt:    d.drawnAt,
  }));

  return NextResponse.json({ draws: safe });
}

/**
 * GET /api/giveaway/history
 * Public endpoint — returns past draw winners (name + month only, no email).
 * Used by the /giveaway user-facing page.
 */
import { NextResponse }  from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }   from '@/lib/auth';
import { getDrawHistory } from '@/lib/giveaway';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const draws = await getDrawHistory();

  // Strip email — only expose name, month, and drawnAt for the user-facing view
  const safe = draws.map((d) => ({
    id:         d.id,
    month:      d.month,
    winnerName: d.winnerName,
    drawnAt:    d.drawnAt,
  }));

  return NextResponse.json({ draws: safe });
}

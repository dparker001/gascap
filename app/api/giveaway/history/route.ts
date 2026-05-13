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

  // Strip email and truncate name to "First L." — protects winner privacy
  const safe = draws.map((d) => {
    const parts = d.winnerName.trim().split(/\s+/);
    const masked = parts.length >= 2
      ? `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`
      : parts[0] ?? d.winnerName;
    return {
      id:         d.id,
      month:      d.month,
      winnerName: masked,
      drawnAt:    d.drawnAt,
    };
  });

  return NextResponse.json({ draws: safe });
}

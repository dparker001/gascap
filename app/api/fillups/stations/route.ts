/**
 * GET /api/fillups/stations
 * Returns the authenticated user's recently used gas station names,
 * newest-first, deduplicated. Used to populate the station picker
 * in the fill-up logger.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import type { Session }     from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { getRecentStations } from '@/lib/fillups';

function userId(session: Session | null) {
  return session?.user?.id ?? session?.user?.email ?? '';
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const stations = getRecentStations(userId(session));
  return NextResponse.json({ stations });
}

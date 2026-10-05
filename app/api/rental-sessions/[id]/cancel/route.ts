/**
 * POST /api/rental-sessions/:id/cancel — the renter says they never took (or
 * no longer need) this rental. Owner-scoped, idempotent, NOT Pro-gated (it
 * finishes a rental, like complete; only STARTING one requires Pro).
 * 200 {session}            cancelled (also when it already was)
 * 404                      not found / not this user's
 * 409 already_completed    a returned rental can't be cancelled
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RENTAL_RETURN_ASSISTANT_ENABLED } from '@/lib/featureFlags';
import { cancelRentalSession } from '@/lib/rentalSessions';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await cancelRentalSession(userId, params.id);
  if (result.kind === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (result.kind === 'completed') return NextResponse.json({ error: 'already_completed' }, { status: 409 });
  return NextResponse.json({ session: result.session });
}

/**
 * POST /api/favorite-addresses/:id/resolve
 *
 * Resolves a saved favorite into a routable origin/destination for
 * /api/maps/route — a 'google_place' favorite's coordinates are fetched
 * fresh here every time (never read from a cached column, since this
 * table has none; see lib/favoriteAddresses.ts), a 'manual_text' favorite
 * is handed back as its saved address string.
 *
 * Response: { ok: true, kind: 'coordinates', latitude, longitude }
 *         | { ok: true, kind: 'address', text, usedFallback? }
 *         | { ok: false, error }
 *
 * usedFallback: true means this was a 'google_place' favorite whose Place
 * Details lookup failed, so `text` is the saved display text used as a
 * fallback rather than an intentionally-manual address — callers should
 * surface this to the user per independent review (a route built from the
 * fallback text could, in principle, resolve to a similarly-named but
 * different location than the one originally saved).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveFavoriteAddressForRouting } from '@/lib/favoriteAddresses';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const result = await resolveFavoriteAddressForRouting(userId, params.id);
  if (result.kind === 'not_found') {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...result });
}

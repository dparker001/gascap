/**
 * GET    /api/favorite-addresses                — list the signed-in user's favorite addresses
 * POST   /api/favorite-addresses                — create (Home/Work/custom label)
 * PATCH  /api/favorite-addresses?id=…            — edit label/address
 * DELETE /api/favorite-addresses?id=…            — remove
 *
 * Trip Planner Phase 2. Every operation is scoped to the signed-in user via
 * `userId` in the Prisma where clause (lib/favoriteAddresses.ts) — never a
 * fetch-then-filter pattern. Never logs displayAddress/placeId in error
 * responses; only `label`/`id` where a message needs to name the record.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  listFavoriteAddresses,
  createFavoriteAddress,
  updateFavoriteAddress,
  deleteFavoriteAddress,
  type FavoriteAddressSource,
} from '@/lib/favoriteAddresses';

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return (session.user as { id?: string })?.id ?? null;
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const favorites = await listFavoriteAddresses(userId);
  return NextResponse.json({ favorites }, { headers: { 'Cache-Control': 'no-store' } });
}

function isValidSource(v: unknown): v is FavoriteAddressSource {
  return v === 'google_place' || v === 'manual_text';
}

export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { label, displayAddress, placeId, source, confirmDuplicate } = body;
  if (
    typeof label          !== 'string' || !label.trim() ||
    typeof displayAddress !== 'string' || !displayAddress.trim() ||
    !isValidSource(source) ||
    (placeId !== undefined && typeof placeId !== 'string')
  ) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
  }

  const result = await createFavoriteAddress(
    userId,
    { label, displayAddress, placeId, source },
    confirmDuplicate === true,
  );

  if (!result.ok && result.reason === 'duplicate_label') {
    return NextResponse.json(
      { error: 'duplicate_label', existing: result.existing },
      { status: 409 },
    );
  }
  if (!result.ok) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
  }

  return NextResponse.json({ favorite: result.favorite });
}

export async function PATCH(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { label, displayAddress, placeId, source } = body;
  if (label !== undefined && typeof label !== 'string') {
    return NextResponse.json({ error: 'Invalid label' }, { status: 400 });
  }
  if (displayAddress !== undefined && typeof displayAddress !== 'string') {
    return NextResponse.json({ error: 'Invalid displayAddress' }, { status: 400 });
  }
  if (source !== undefined && !isValidSource(source)) {
    return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
  }
  if (placeId !== undefined && placeId !== null && typeof placeId !== 'string') {
    return NextResponse.json({ error: 'Invalid placeId' }, { status: 400 });
  }

  const favorite = await updateFavoriteAddress(userId, id, { label, displayAddress, placeId, source });
  if (!favorite) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ favorite });
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const deleted = await deleteFavoriteAddress(userId, id);
  return NextResponse.json({ ok: deleted });
}

/**
 * GET    /api/favorites            — list the signed-in user's favorite stations,
 *                                    with CURRENT prices resolved live
 * POST   /api/favorites            — save a station
 * DELETE /api/favorites?placeId=…  — remove a favorite
 *
 * A favorite is a station's IDENTITY (placeId/name/address/location). Its
 * price is never frozen at save time: GET resolves it live from Google Places
 * (the same source as Find Gas) on every view. The stored `prices` column is
 * only a fallback for when Google can't be reached, and is returned flagged
 * `priceStatus: 'last_known'` with Google's own observation time so the UI can
 * never present it as current. (2026-09-30: saved stations were showing
 * weeks-old snapshots labelled with the save time.)
 *
 * priceUpdatedAt is always WHEN GOOGLE OBSERVED THE PRICE (freshest
 * updateTime), never when GasCap fetched or saved it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { prisma }                    from '@/lib/prisma';
import type { Prisma }               from '@/lib/generated/prisma/client';
import { randomUUID }                from 'crypto';
import { getLivePlan }               from '@/lib/serverPlan';
import { awardFirstSavedStation }    from '@/lib/gasPoints';
import { fetchStationPrices, freshestPriceTime, type FuelPrice } from '@/lib/nearbyGas';

export type { FavoritePriceStatus } from '@/lib/fuelPriceFreshness';
import type { FavoritePriceStatus } from '@/lib/fuelPriceFreshness';

/**
 * What happened when we tried to refresh this favorite — lets the UI say
 * "Couldn't refresh" (provider failed) vs. "No current price reported"
 * (provider answered, no fuel price) instead of one generic message.
 */
export type FavoriteRefreshResult = 'ok' | 'failed' | 'no_price' | 'skipped';

function toJson(prices: FuelPrice[]): Prisma.InputJsonValue {
  return prices as unknown as Prisma.InputJsonValue;
}

function asPrices(v: unknown): FuelPrice[] {
  return Array.isArray(v) ? (v as FuelPrice[]) : [];
}

// Keeps the Find Gas idle/results screen from pushing its primary CTA out of
// view when a user favorites a lot of stations.
const MAX_FAVORITES = 3;

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return (session.user as { id?: string })?.id ?? null;
}

export async function GET() {
  // Plan from the DB, not the JWT — the live lookup is a paid Google call.
  const { userId, isPro } = await getLivePlan();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await prisma.favoriteStation.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
  });

  const liveEnabled =
    isPro &&
    process.env.ENABLE_LIVE_FUEL_PRICES === 'true' &&
    !!process.env.GOOGLE_PLACES_API_KEY;

  const live = liveEnabled && rows.length > 0
    ? await fetchStationPrices(rows.map((r) => r.placeId))
    : new Map<string, FuelPrice[] | null>();

  const writeBacks: Promise<unknown>[] = [];

  const favorites = rows.map((row) => {
    const base = {
      placeId: row.placeId,
      name:    row.name,
      address: row.address,
      lat:     row.lat,
      lng:     row.lng,
    };

    const livePrices = live.get(row.placeId);
    const lastRefresh: FavoriteRefreshResult =
      !liveEnabled         ? 'skipped'
      : livePrices == null ? 'failed'
      : livePrices.length  ? 'ok'
      :                      'no_price';
    if (livePrices && livePrices.length > 0) {
      const priceUpdatedAt = freshestPriceTime(livePrices);
      // Keep the fallback snapshot current so it can never drift weeks old.
      writeBacks.push(
        prisma.favoriteStation
          .update({ where: { id: row.id }, data: { prices: toJson(livePrices), priceUpdatedAt } })
          .catch((err: unknown) => console.error('[favorites] snapshot write-back failed', err)),
      );
      return { ...base, prices: livePrices, priceUpdatedAt, priceStatus: 'live' as FavoritePriceStatus, lastRefresh };
    }

    // No current price (lookup failed, disabled, or Google no longer reports
    // one). Fall back to the stored snapshot, clearly flagged, with Google's
    // observation time from the snapshot itself — legacy rows stored the SAVE
    // time in priceUpdatedAt, which under-reports the real age.
    const snapshot = asPrices(row.prices);
    if (snapshot.length > 0) {
      return {
        ...base,
        prices:         snapshot,
        priceUpdatedAt: freshestPriceTime(snapshot) ?? row.priceUpdatedAt ?? null,
        priceStatus:    'last_known' as FavoritePriceStatus,
        lastRefresh,
      };
    }
    return { ...base, prices: [], priceUpdatedAt: null, priceStatus: 'unavailable' as FavoritePriceStatus, lastRefresh };
  });

  await Promise.all(writeBacks);

  return NextResponse.json({ favorites }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { placeId, name, address, lat, lng, prices } = body;
  if (
    typeof placeId !== 'string' || !placeId ||
    typeof name    !== 'string' || !name ||
    typeof address !== 'string' ||
    typeof lat     !== 'number' ||
    typeof lng     !== 'number'
  ) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
  }

  const existing = await prisma.favoriteStation.findUnique({
    where: { userId_placeId: { userId, placeId } },
  });
  if (!existing) {
    const count = await prisma.favoriteStation.count({ where: { userId } });
    if (count >= MAX_FAVORITES) {
      return NextResponse.json({ error: 'favorite_limit', limit: MAX_FAVORITES }, { status: 409 });
    }
  }

  // Google's observation time for these prices — NOT now. Tapping the star
  // doesn't make a days-old price fresh.
  const savedPrices    = asPrices(prices);
  const priceUpdatedAt = freshestPriceTime(savedPrices);

  const favorite = await prisma.favoriteStation.upsert({
    where:  { userId_placeId: { userId, placeId } },
    update: { name, address, lat, lng, prices: toJson(savedPrices), priceUpdatedAt },
    create: {
      id:             randomUUID(),
      userId,
      placeId,
      name,
      address,
      lat,
      lng,
      prices:         toJson(savedPrices),
      priceUpdatedAt,
      createdAt:      new Date().toISOString(),
    },
  });

  // Gamification G1: +20 GasPoints for the first saved station (once per lifetime) —
  // only when a NEW favorite row was just created, never on an update of an existing one.
  const gasPointsAwarded = existing ? null : await awardFirstSavedStation(userId);

  return NextResponse.json({ favorite, gasPointsAwarded });
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const placeId = req.nextUrl.searchParams.get('placeId');
  if (!placeId) return NextResponse.json({ error: 'Missing placeId' }, { status: 400 });

  await prisma.favoriteStation.deleteMany({ where: { userId, placeId } });

  return NextResponse.json({ ok: true });
}

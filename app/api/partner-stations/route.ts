/**
 * GET /api/partner-stations?city=Orlando&state=FL
 *
 * Returns active, featured campaign placements for the given city.
 * Used by the in-app FeaturedStation component to show nearby partner stations.
 * City matching is case-insensitive, partial match allowed.
 * Public endpoint — no auth required.
 */
import { NextResponse } from 'next/server';
import { listPlacements } from '@/lib/campaigns';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const city  = (searchParams.get('city')  ?? '').trim().toLowerCase();
  const state = (searchParams.get('state') ?? '').trim().toLowerCase();

  const all = listPlacements().filter((p) => p.active && p.featured);

  // Filter by city if provided, fall back to state, fall back to all featured
  let matches = all;
  if (city) {
    const cityMatches = all.filter((p) =>
      (p.city ?? '').toLowerCase().includes(city) ||
      city.includes((p.city ?? '').toLowerCase()),
    );
    if (cityMatches.length > 0) {
      matches = cityMatches;
    } else if (state) {
      // No city match — try to return any station in the same state area
      // (we store city not state, so this is best-effort)
      matches = all.slice(0, 1); // show nearest featured if nothing else matches
    }
  }

  // De-dupe by station name — return one card per physical station
  const seen   = new Set<string>();
  const unique = matches.filter((p) => {
    const key = p.station.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json({
    stations: unique.map((p) => ({
      code:    p.code,
      station: p.station,
      address: p.address ?? null,
      city:    p.city    ?? null,
    })),
  });
}

/**
 * Proxy for the EPA fueleconomy.gov REST API.
 * Avoids CORS issues and adds server-side caching.
 *
 * Actions:
 *   ?action=years
 *   ?action=makes&year=2024
 *   ?action=models&year=2024&make=Toyota
 *   ?action=trims&year=2024&make=Toyota&model=Camry
 *   ?action=vehicle&id=12345
 */
import { NextResponse } from 'next/server';

const BASE = 'https://fueleconomy.gov/ws/rest/vehicle';
const JSON_HEADERS = { Accept: 'application/json' };
// Cache EPA responses for 24 h at the edge
const CACHE: RequestInit = { next: { revalidate: 86400 } };

type MenuItem = { text: string; value: string };

async function fetchMenu(path: string): Promise<MenuItem[]> {
  const res = await fetch(`${BASE}${path}`, { headers: JSON_HEADERS, ...CACHE });
  if (!res.ok) return [];
  const data = await res.json() as { menuItem?: MenuItem | MenuItem[] };
  const items = data.menuItem;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  try {
    if (action === 'years') {
      const items = await fetchMenu('/menu/year');
      return NextResponse.json(items.reverse()); // newest first
    }

    if (action === 'makes') {
      const year = searchParams.get('year');
      if (!year) return NextResponse.json([]);
      const items = await fetchMenu(`/menu/make?year=${year}`);
      return NextResponse.json(items);
    }

    if (action === 'models') {
      const year = searchParams.get('year');
      const make = searchParams.get('make');
      if (!year || !make) return NextResponse.json([]);
      const items = await fetchMenu(
        `/menu/model?year=${year}&make=${encodeURIComponent(make)}`,
      );
      return NextResponse.json(items);
    }

    if (action === 'trims') {
      const year  = searchParams.get('year');
      const make  = searchParams.get('make');
      const model = searchParams.get('model');
      if (!year || !make || !model) return NextResponse.json([]);
      const items = await fetchMenu(
        `/menu/options?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`,
      );
      return NextResponse.json(items);
    }

    // ── Manual-entry lookup: best-match by year + make + model ──────────
    if (action === 'lookup') {
      const year  = searchParams.get('year')?.trim();
      const make  = searchParams.get('make')?.trim();
      const model = searchParams.get('model')?.trim();
      if (!year || !make || !model) {
        return NextResponse.json({ error: 'Missing year, make, or model.' }, { status: 400 });
      }

      // 1. Get trims for this combination
      const trims = await fetchMenu(
        `/menu/options?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`,
      );
      if (trims.length === 0) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }

      // 2. Fetch full details for the first trim (representative specs)
      const firstId = trims[0].value;
      const vRes = await fetch(`${BASE}/${firstId}`, { headers: JSON_HEADERS, ...CACHE });
      if (!vRes.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

      const d     = await vRes.json() as Record<string, unknown>;
      const comb  = Number(d.comb08  ?? d.combA08  ?? 0);
      const range = Number(d.range   ?? d.rangeA   ?? 0);
      const tankEst = comb > 0 && range > 0
        ? Math.round((range / comb) * 10) / 10
        : null;

      return NextResponse.json({
        year:       d.year,
        make:       d.make,
        model:      d.model,
        fuelType:   d.fuelType1,
        displ:      d.displ,      // engine displacement (litres)
        cylinders:  d.cylinders,
        tankEst,
        matchCount: trims.length, // how many trim variants were found
        epaId:      firstId,
      });
    }

    if (action === 'vehicle') {
      const id = searchParams.get('id');
      if (!id) return NextResponse.json(null);
      const res = await fetch(`${BASE}/${id}`, { headers: JSON_HEADERS, ...CACHE });
      if (!res.ok) return NextResponse.json(null);
      const d = await res.json() as Record<string, unknown>;
      const comb  = Number(d.comb08  ?? d.combA08  ?? 0);
      const range = Number(d.range   ?? d.rangeA   ?? 0);
      // Estimate tank size from EPA range ÷ combined MPG
      const tankEst = comb > 0 && range > 0
        ? Math.round((range / comb) * 10) / 10
        : null;
      return NextResponse.json({
        id:       d.id,
        year:     d.year,
        make:     d.make,
        model:    d.model,
        trim:     d.trany,
        fuelType: d.fuelType1,
        comb08:   comb,
        range,
        tankEst,
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Upstream error' }, { status: 502 });
  }
}

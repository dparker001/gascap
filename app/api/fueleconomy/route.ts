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
import { aiFallbackTankSize } from '@/lib/aiTankEstimate';

const BASE = 'https://fueleconomy.gov/ws/rest/vehicle';
const JSON_HEADERS = { Accept: 'application/json' };
// Cache EPA responses for 24 h at the edge
const CACHE: RequestInit = { next: { revalidate: 86400 } };

type MenuItem = { text: string; value: string };

/**
 * True for battery-electric vehicles, which have no fuel tank at all.
 *
 * This matters because the tank estimate below is `range ÷ comb08`, and for
 * a BEV those fields mean something completely different: comb08 is MPGe and
 * range is electric miles. A 2026 Dodge Charger Daytona R/T (263 mi ÷ 85
 * MPGe) came out as a "3.1 gallon tank" — a real bug this guards against.
 *
 * PHEVs are deliberately NOT caught here: they burn gasoline and do have a
 * tank, so the normal estimate still applies to them.
 */
function isBatteryElectric(d: Record<string, unknown>): boolean {
  const atv  = String(d.atvType ?? '').toLowerCase();
  const fuel = String(d.fuelType1 ?? '').toLowerCase();
  if (atv.includes('plug-in')) return false;          // PHEV — has a tank
  return atv === 'ev' || (fuel.includes('electric') && !fuel.includes('gas'));
}

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
      // EPA's own /menu/year already returns newest-first — the .reverse()
      // that used to be here actually flipped it to oldest-first, contradicting
      // its own comment. Had no visible effect while every year was shown
      // regardless of order; became a real bug once RentalVehicleLookup started
      // slicing this list down to the most recent 10.
      const items = await fetchMenu('/menu/year');
      return NextResponse.json(items);
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
      const electric = isBatteryElectric(d);
      const comb  = Number(d.comb08  ?? d.combA08  ?? 0);
      const range = Number(d.range   ?? d.rangeA   ?? 0);
      // EPA's range field is mostly populated for EV/AFV records — for a
      // regular gas vehicle this formula frequently has nothing to divide,
      // which silently produced no tank size at all. Same AI fallback used
      // by /api/vin when EPA has no usable data.
      // A BEV gets no tank estimate at all (and no AI call — it would only
      // burn tokens to guess at a tank that doesn't exist).
      const epaTank = !electric && comb > 0 && range > 0
        ? Math.round((range / comb) * 10) / 10
        : null;
      const tankEst = electric ? null : (epaTank ?? await aiFallbackTankSize(year, make, model));

      return NextResponse.json({
        year:       d.year,
        make:       d.make,
        model:      d.model,
        fuelType:   d.fuelType1,
        isElectric: electric,
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
      const electric = isBatteryElectric(d);
      const comb  = Number(d.comb08  ?? d.combA08  ?? 0);
      const range = Number(d.range   ?? d.rangeA   ?? 0);
      // Estimate tank size from EPA range ÷ combined MPG — but EPA's range
      // field is mostly populated for EV/AFV records, so this is frequently
      // empty for a regular gas vehicle. Fall back to the AI estimate used by
      // /api/vin rather than silently returning no tank size at all.
      // Skipped entirely for a BEV: comb08 is MPGe and range is electric
      // miles there, so the division yields a nonsense "tank" (see
      // isBatteryElectric).
      const epaTank = !electric && comb > 0 && range > 0
        ? Math.round((range / comb) * 10) / 10
        : null;
      const tankEst = electric ? null : (epaTank ?? await aiFallbackTankSize(
        String(d.year ?? ''), String(d.make ?? ''), String(d.model ?? ''), String(d.trany ?? ''),
      ));
      return NextResponse.json({
        id:       d.id,
        year:     d.year,
        make:     d.make,
        model:    d.model,
        trim:     d.trany,
        fuelType: d.fuelType1,
        isElectric: electric,
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

/**
 * GET /api/mpg-lookup?year=2020&make=Toyota&model=Camry
 *
 * Returns typical city / highway / combined MPG for a given year/make/model
 * by querying the U.S. Department of Energy FuelEconomy.gov REST API.
 * No API key required.
 *
 * We sample up to 5 trims and average across them for a representative
 * estimate, then return all three EPA figures so the UI can let the user
 * pick city, highway, or combined based on their trip type.
 *
 * Response shapes:
 *   { ok: true,  combMpg, cityMpg, hwyMpg, trimName }
 *   { ok: false, error: string }
 */
import { NextResponse } from 'next/server';

const FE_BASE = 'https://www.fueleconomy.gov/ws/rest';

interface FEMenuItem { text: string; value: string }
interface FEMenuResponse { menuItem?: FEMenuItem | FEMenuItem[] }
interface FEVehicle {
  comb08?: number | string;
  city08?: number | string;
  hwy08?:  number | string;
}

function toArray<T>(x: T | T[] | undefined): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function avg(nums: number[]): number | undefined {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : undefined;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const year  = searchParams.get('year')?.trim();
  const make  = searchParams.get('make')?.trim();
  const model = searchParams.get('model')?.trim();

  if (!year || !make || !model) {
    return NextResponse.json({ ok: false, error: 'Missing year, make, or model' }, { status: 400 });
  }

  const headers = { Accept: 'application/json' };

  try {
    // ── 1. Fetch available trims ──────────────────────────────────────────
    const trimUrl =
      `${FE_BASE}/vehicle/menu/options` +
      `?year=${encodeURIComponent(year)}` +
      `&make=${encodeURIComponent(make)}` +
      `&model=${encodeURIComponent(model)}`;

    const trimRes = await fetch(trimUrl, { headers });
    if (!trimRes.ok) {
      return NextResponse.json({ ok: false, error: 'Vehicle not found in FuelEconomy.gov' });
    }

    const trimData = await trimRes.json() as FEMenuResponse;
    const items    = toArray(trimData.menuItem);

    if (items.length === 0) {
      return NextResponse.json({ ok: false, error: 'No trims found for this vehicle' });
    }

    // ── 2. Fetch MPG for up to 5 trims (one request each) ────────────────
    const sample = items.slice(0, 5);
    let   trimName: string | undefined;

    interface TrimMpg { city: number; hwy: number; comb: number }
    const trimResults: TrimMpg[] = [];

    await Promise.all(
      sample.map(async (item) => {
        try {
          const vRes  = await fetch(`${FE_BASE}/vehicle/${item.value}`, { headers });
          if (!vRes.ok) return;
          const vData = await vRes.json() as FEVehicle;
          const comb  = Number(vData.comb08);
          const city  = Number(vData.city08);
          const hwy   = Number(vData.hwy08);
          if (comb > 0) {
            trimResults.push({ comb, city: city || comb, hwy: hwy || comb });
            if (!trimName) trimName = item.text;
          }
        } catch { /* skip failed trim */ }
      }),
    );

    if (trimResults.length === 0) {
      return NextResponse.json({ ok: false, error: 'MPG data unavailable for this vehicle' });
    }

    // ── 3. Average across sampled trims ───────────────────────────────────
    const combMpg = avg(trimResults.map((t) => t.comb))!;
    const cityMpg = avg(trimResults.map((t) => t.city));
    const hwyMpg  = avg(trimResults.map((t) => t.hwy));

    return NextResponse.json({ ok: true, combMpg, cityMpg, hwyMpg, trimName });
  } catch {
    return NextResponse.json({ ok: false, error: 'MPG lookup failed' });
  }
}

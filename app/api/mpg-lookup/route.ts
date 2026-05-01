/**
 * GET /api/mpg-lookup?epaId=47147
 * GET /api/mpg-lookup?year=2020&make=Toyota&model=Camry
 *
 * Returns city / highway / combined MPG for a vehicle by querying the U.S.
 * Department of Energy FuelEconomy.gov REST API. No API key required.
 *
 * Preferred: pass ?epaId= for a direct single-vehicle lookup (exact trim data).
 * Fallback:  pass ?year=&make=&model= — samples up to 5 trims and averages.
 *
 * Response shapes:
 *   { ok: true,  combMpg, cityMpg, hwyMpg }
 *   { ok: false, error: string }
 */
import { NextResponse } from 'next/server';

const FE_BASE = 'https://www.fueleconomy.gov/ws/rest';

interface FEMenuItem { text: string; value: string }
interface FEMenuResponse { menuItem?: FEMenuItem | FEMenuItem[] }
interface FEVehicle {
  comb08?: number | string | null;
  city08?: number | string | null;
  hwy08?:  number | string | null;
}

function toArray<T>(x: T | T[] | undefined): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function avg(nums: number[]): number | undefined {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : undefined;
}

/** Parse an MPG value that may come back as number, string, or null. */
function parseMpg(val: number | string | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return Number(val) || 0;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const epaId = searchParams.get('epaId')?.trim();
  const year  = searchParams.get('year')?.trim();
  const make  = searchParams.get('make')?.trim();
  const model = searchParams.get('model')?.trim();

  const headers = { Accept: 'application/json' };

  try {
    // ── Fast path: direct epaId lookup ─────────────────────────────────────
    // This is the most accurate path — fetches the exact trim the vehicle was
    // saved with, rather than averaging across trims.
    if (epaId) {
      const vRes = await fetch(`${FE_BASE}/vehicle/${epaId}`, { headers });
      if (!vRes.ok) {
        return NextResponse.json({ ok: false, error: 'Vehicle not found in FuelEconomy.gov' });
      }
      const vData = await vRes.json() as FEVehicle;
      const comb  = parseMpg(vData.comb08);
      const city  = parseMpg(vData.city08);
      const hwy   = parseMpg(vData.hwy08);

      if (comb <= 0) {
        return NextResponse.json({ ok: false, error: 'No MPG data for this vehicle' });
      }

      return NextResponse.json({
        ok:      true,
        combMpg: comb,
        cityMpg: city > 0 ? city : comb,
        hwyMpg:  hwy  > 0 ? hwy  : comb,
      });
    }

    // ── Slow path: search by year / make / model ──────────────────────────
    if (!year || !make || !model) {
      return NextResponse.json(
        { ok: false, error: 'Provide either epaId or year + make + model' },
        { status: 400 },
      );
    }

    // 1. Fetch available trims
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

    // 2. Fetch MPG for up to 5 trims
    const sample = items.slice(0, 5);

    interface TrimMpg { city: number; hwy: number; comb: number }
    const trimResults: TrimMpg[] = [];

    await Promise.all(
      sample.map(async (item) => {
        try {
          const vRes  = await fetch(`${FE_BASE}/vehicle/${item.value}`, { headers });
          if (!vRes.ok) return;
          const vData = await vRes.json() as FEVehicle;
          const comb  = parseMpg(vData.comb08);
          const city  = parseMpg(vData.city08);
          const hwy   = parseMpg(vData.hwy08);
          if (comb > 0) {
            trimResults.push({ comb, city: city || comb, hwy: hwy || comb });
          }
        } catch { /* skip failed trim */ }
      }),
    );

    if (trimResults.length === 0) {
      return NextResponse.json({ ok: false, error: 'MPG data unavailable for this vehicle' });
    }

    // 3. Average across sampled trims
    const combMpg = avg(trimResults.map((t) => t.comb))!;
    const cityMpg = avg(trimResults.map((t) => t.city));
    const hwyMpg  = avg(trimResults.map((t) => t.hwy));

    return NextResponse.json({ ok: true, combMpg, cityMpg, hwyMpg });
  } catch {
    return NextResponse.json({ ok: false, error: 'MPG lookup failed' });
  }
}

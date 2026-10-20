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
 * ── Energy-type guard (PR #87 review round 1, 2026-10-20) ────────────────
 * `comb08`/`city08`/`highway08` are MPGe — not MPG — for electric,
 * natural-gas and hydrogen vehicles. This route used to return them as MPG
 * regardless, so a battery-electric or CNG record became a gasoline MPG for
 * every caller: Trip Planner's garage mode, Trip Planner's rental mode, and
 * anything else using this endpoint. The classification lives in
 * lib/epaEnergyType.ts and is applied **per trim, before any averaging**, so
 * an incompatible configuration can never be folded into a gallon-MPG
 * average. See that file for the live-API-verified field values.
 *
 * Nothing here converts MPGe into MPG.
 *
 * Response shapes — three outcomes a caller can distinguish:
 *   { ok: true,  combMpg, cityMpg, hwyMpg, energyType, gallonBased: true,
 *     trimsUsed?, trimsRejected? }
 *   { ok: false, reason: 'unsupported_energy_type', energyType, error }
 *   { ok: false, reason: 'not_found' | 'no_epa_data' | 'bad_request'
 *                      | 'lookup_failed', error }
 *
 * Backward compatibility: the success shape still carries `ok`, `combMpg`,
 * `cityMpg` and `hwyMpg` unchanged, and every failure still carries
 * `ok: false` plus `error`. Existing callers that only test
 * `data.ok && data.combMpg` keep working; `reason` and `energyType` are
 * additive.
 */
import { NextResponse } from 'next/server';
import { classifyEpaEnergyType, type EpaEnergyType } from '@/lib/epaEnergyType';

const FE_BASE = 'https://www.fueleconomy.gov/ws/rest';

interface FEMenuItem { text: string; value: string }
interface FEMenuResponse { menuItem?: FEMenuItem | FEMenuItem[] }
interface FEVehicle {
  comb08?: number | string | null;
  city08?: number | string | null;
  hwy08?:  number | string | null;
  /** Energy-type fields — the reason this route can tell MPG from MPGe. */
  fuelType1?: unknown;
  fuelType2?: unknown;
  atvType?:   unknown;
}

/** How many trims the year/make/model path samples. */
const TRIM_SAMPLE_SIZE = 5;

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

function unsupported(energyType: EpaEnergyType, detail: string) {
  return NextResponse.json({
    ok:    false,
    reason: 'unsupported_energy_type' as const,
    energyType,
    error:  detail,
  });
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
        return NextResponse.json({ ok: false, reason: 'not_found', error: 'Vehicle not found in FuelEconomy.gov' });
      }
      const vData = await vRes.json() as FEVehicle;

      // Energy type BEFORE the numbers: a CNG record's comb08 of 31 is a
      // plausible-looking MPG and is not one.
      const cls = classifyEpaEnergyType(vData);
      if (!cls.gallonBased) return unsupported(cls.energyType, cls.detail);

      const comb  = parseMpg(vData.comb08);
      const city  = parseMpg(vData.city08);
      const hwy   = parseMpg(vData.hwy08);

      if (comb <= 0) {
        return NextResponse.json({ ok: false, reason: 'no_epa_data', error: 'No MPG data for this vehicle' });
      }

      return NextResponse.json({
        ok:          true,
        combMpg:     comb,
        cityMpg:     city > 0 ? city : comb,
        hwyMpg:      hwy  > 0 ? hwy  : comb,
        energyType:  cls.energyType,
        gallonBased: true,
      });
    }

    // ── Slow path: search by year / make / model ──────────────────────────
    if (!year || !make || !model) {
      return NextResponse.json(
        { ok: false, reason: 'bad_request', error: 'Provide either epaId or year + make + model' },
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
      return NextResponse.json({ ok: false, reason: 'not_found', error: 'Vehicle not found in FuelEconomy.gov' });
    }

    const trimData = await trimRes.json() as FEMenuResponse | null;
    const items    = toArray(trimData?.menuItem);

    if (items.length === 0) {
      return NextResponse.json({ ok: false, reason: 'not_found', error: 'No trims found for this vehicle' });
    }

    // 2. Fetch MPG for up to TRIM_SAMPLE_SIZE trims, classifying each one.
    const sample = items.slice(0, TRIM_SAMPLE_SIZE);

    interface TrimMpg { city: number; hwy: number; comb: number; energyType: EpaEnergyType }
    const trimResults:  TrimMpg[] = [];
    /** Trims excluded because their figures are not gallons-based. */
    const rejected:     { energyType: EpaEnergyType; detail: string }[] = [];

    await Promise.all(
      sample.map(async (item) => {
        try {
          const vRes  = await fetch(`${FE_BASE}/vehicle/${item.value}`, { headers });
          if (!vRes.ok) return;
          const vData = await vRes.json() as FEVehicle;

          // Filter BEFORE the average. A model line sold in both gasoline and
          // battery-electric form would otherwise average 26 MPG with 111
          // MPGe into a meaningless "69 MPG".
          const cls = classifyEpaEnergyType(vData);
          if (!cls.gallonBased) {
            rejected.push({ energyType: cls.energyType, detail: cls.detail });
            return;
          }

          const comb  = parseMpg(vData.comb08);
          const city  = parseMpg(vData.city08);
          const hwy   = parseMpg(vData.hwy08);
          if (comb > 0) {
            trimResults.push({ comb, city: city || comb, hwy: hwy || comb, energyType: cls.energyType });
          }
        } catch { /* skip failed trim */ }
      }),
    );

    if (trimResults.length === 0) {
      // Every sampled configuration was non-gallon: that is a different answer
      // from "EPA has no data", and the caller needs to tell them apart.
      if (rejected.length > 0) {
        return unsupported(rejected[0].energyType, rejected[0].detail);
      }
      return NextResponse.json({ ok: false, reason: 'no_epa_data', error: 'MPG data unavailable for this vehicle' });
    }

    // 3. Average across the compatible sampled trims only.
    const combMpg = avg(trimResults.map((t) => t.comb))!;
    const cityMpg = avg(trimResults.map((t) => t.city));
    const hwyMpg  = avg(trimResults.map((t) => t.hwy));

    // When the compatible trims disagree about fuel (a line sold in gasoline
    // and diesel), report the most common — both are gallons, so the average
    // is sound; the label is just less specific.
    const energyType = trimResults.length === 1
      ? trimResults[0].energyType
      : mostCommon(trimResults.map((t) => t.energyType));

    return NextResponse.json({
      ok:          true,
      combMpg, cityMpg, hwyMpg,
      energyType,
      gallonBased: true,
      trimsUsed:     trimResults.length,
      trimsRejected: rejected.length,
    });
  } catch {
    return NextResponse.json({ ok: false, reason: 'lookup_failed', error: 'MPG lookup failed' });
  }
}

function mostCommon(types: EpaEnergyType[]): EpaEnergyType {
  const counts = new Map<EpaEnergyType, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  let best = types[0];
  let bestN = 0;
  for (const [t, n] of counts) if (n > bestN) { best = t; bestN = n; }
  return best;
}

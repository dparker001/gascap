/**
 * GET /api/vin?vin=1HGCM82633A123456
 * Decodes a VIN via NHTSA vPIC API and enriches with EPA fuel economy data.
 * Falls back to Claude AI for tank capacity when EPA lookup has no data.
 * Returns a flat VinResult (for VehiclePicker backwards-compat) + a rich `specs` object.
 */
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { VehicleSpecs } from '@/lib/vehicleSpecs';

interface NhtsaValue  { Variable: string; Value: string | null }
interface NhtsaResponse { Results: NhtsaValue[]; Count: number; Message: string }

// ── EPA helpers ──────────────────────────────────────────────────────────────

interface EpaMenuItem { text: string; value: string }

/**
 * A year/make/model can have several trims with materially different engines and
 * fuel requirements (e.g. a Challenger SXT's 3.6L V6 takes Regular; an R/T's 5.7L
 * V8 needs Premium). EPA's per-trim data (including the octane-specific fuelType1
 * field) is only accurate if we match the SPECIFIC decoded trim — grabbing the
 * first menu result silently returns the wrong trim's fuel type/MPG whenever a
 * model has more than one engine option. `hints` (from the NHTSA decode) lets us
 * pick the closest-matching trim by engine displacement + cylinder count instead.
 */
async function epaLookup(
  year: string, make: string, model: string,
  hints?: { displL?: number; cylinders?: number },
): Promise<{
  epaId?:        string;
  combMpg?:      number;
  cityMpg?:      number;
  hwyMpg?:       number;
  tankEst?:      number;
  rangeMiles?:   number;
  co2GPerMile?:  number;
  fuelType1?:    string;   // EPA's octane-specific grade, e.g. "Premium Gasoline Recommended"
} | null> {
  try {
    const base = 'https://fueleconomy.gov/ws/rest/vehicle';
    const hdrs = { Accept: 'application/json' };
    const cache: RequestInit = { next: { revalidate: 86400 } };

    // Get trims for year/make/model
    const trimRes = await fetch(
      `${base}/menu/options?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`,
      { headers: hdrs, ...cache },
    );
    if (!trimRes.ok) return null;
    const trimData = await trimRes.json() as { menuItem?: EpaMenuItem | EpaMenuItem[] };
    const items = trimData.menuItem ? (Array.isArray(trimData.menuItem) ? trimData.menuItem : [trimData.menuItem]) : [];
    if (items.length === 0) return null;

    // Fetch details for every trim in parallel (all 24h-cached, so this is cheap)
    // so we can pick the one whose engine actually matches the decoded VIN.
    const details = await Promise.all(items.map(async (item) => {
      try {
        const r = await fetch(`${base}/${item.value}`, { headers: hdrs, ...cache });
        if (!r.ok) return null;
        return { value: item.value, data: await r.json() as Record<string, unknown> };
      } catch { return null; }
    }));
    const valid = details.filter((d): d is { value: string; data: Record<string, unknown> } => d !== null);
    if (valid.length === 0) return null;

    // Pick the trim whose displacement + cylinder count are the closest match to
    // the NHTSA-decoded engine. No hints (or a single trim) → first result, same
    // as before.
    let chosen = valid[0];
    if (hints && (hints.displL != null || hints.cylinders != null) && valid.length > 1) {
      let bestScore = Infinity;
      for (const d of valid) {
        const dDispl = Number(d.data.displ);
        const dCyl   = Number(d.data.cylinders);
        let score = 0;
        score += hints.displL != null && !isNaN(dDispl) ? Math.abs(dDispl - hints.displL) : 5;
        score += hints.cylinders != null && !isNaN(dCyl) && dCyl !== hints.cylinders ? 10 : 0;
        if (score < bestScore) { bestScore = score; chosen = d; }
      }
    }

    const d = chosen.data;
    const comb  = Number(d.comb08  ?? d.combA08  ?? 0);
    const city  = Number(d.city08  ?? d.cityA08  ?? 0);
    const hwy   = Number(d.hwy08   ?? d.hwyA08   ?? 0);
    const range = Number(d.range   ?? d.rangeA   ?? 0);
    const co2   = Number(d.co2TailpipeGpm ?? 0);
    const tank  = comb > 0 && range > 0 ? Math.round((range / comb) * 10) / 10 : null;
    const fuelType1 = typeof d.fuelType1 === 'string' && d.fuelType1 ? d.fuelType1 : undefined;

    return {
      epaId:       chosen.value,
      combMpg:     comb  > 0 ? comb  : undefined,
      cityMpg:     city  > 0 ? city  : undefined,
      hwyMpg:      hwy   > 0 ? hwy   : undefined,
      tankEst:     tank  ?? undefined,
      rangeMiles:  range > 0 ? range : undefined,
      co2GPerMile: co2   > 0 ? co2   : undefined,
      fuelType1,
    };
  } catch {
    return null;
  }
}

// ── AI tank-capacity fallback ─────────────────────────────────────────────────

async function aiFallbackTankSize(
  year: string,
  make: string,
  model: string,
  trim: string,
): Promise<number | null> {
  try {
    const apiKey = process.env.GASCAP_ANTHROPIC_KEY;
    if (!apiKey) return null;

    const client = new Anthropic({ apiKey });

    const vehicleDesc = [year, make, model, trim].filter(Boolean).join(' ');

    const msg = await client.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 64,
      messages: [
        {
          role:    'user',
          content: `What is the factory fuel tank capacity in US gallons for a ${vehicleDesc}?
Respond with ONLY a JSON object in this exact format: {"tankGallons": 15.9}
Use the most common trim's factory tank size. If you are not confident, use your best estimate based on the vehicle class. Do NOT include any explanation.`,
        },
      ],
    });

    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as { tankGallons?: unknown };
    const val = Number(parsed.tankGallons);
    if (!isNaN(val) && val > 0 && val < 150) return Math.round(val * 10) / 10;
    return null;
  } catch {
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toBool(val: string | null): boolean | undefined {
  if (!val) return undefined;
  const v = val.toLowerCase();
  return v === 'yes' || v === 'standard' || v === 'optional' || v === 'direct' || v === 'indirect' ? true
       : v === 'no' || v === 'not applicable' ? false
       : undefined;
}

function toNum(val: string | null): number | undefined {
  if (!val) return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const vin = new URL(req.url).searchParams.get('vin')?.trim().toUpperCase() ?? '';

  if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) {
    return NextResponse.json(
      { error: 'A VIN must be exactly 17 characters (letters A-Z except I, O, Q and digits 0-9).' },
      { status: 400 },
    );
  }

  try {
    const url  = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`;
    const res  = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) throw new Error('NHTSA API error');
    const data = await res.json() as NhtsaResponse;

    const pick = (variable: string): string | null =>
      data.Results.find((r) => r.Variable === variable)?.Value?.trim() || null;

    // ── Core identity ────────────────────────────────────────────────────
    const make  = pick('Make');
    const model = pick('Model');
    const year  = pick('Model Year');

    if (!make || !model || !year) {
      return NextResponse.json(
        { error: 'Could not decode this VIN. Please check all 17 characters and try again.' },
        { status: 404 },
      );
    }

    const body         = pick('Body Class');
    const fuel         = pick('Fuel Type - Primary');
    const cyls         = pick('Engine Number of Cylinders');
    const displ        = pick('Displacement (L)');
    const trim         = pick('Trim') ?? pick('Series') ?? '';
    const drive        = pick('Drive Type');
    const trans        = pick('Transmission Style');
    const manufacturer = pick('Manufacturer Name');
    const vehicleType  = pick('Vehicle Type');
    const series       = pick('Series') ?? pick('Trim') ?? null;

    const engineHP     = pick('Engine Brake (Hp) From');
    const engineTorque = pick('Engine Torque (lbs-ft) From');
    const engineConfig = pick('Engine Configuration');
    const turboRaw     = pick('Turbo');
    const superRaw     = pick('Supercharger');
    const fuelInjector = pick('Fuel Injector');

    const seats        = pick('Number of Seats');
    const gvwr         = pick('Gross Vehicle Weight Rating From');
    const wheelbase    = pick('Wheel Base (inches) From');

    const absRaw          = pick('Anti-lock Braking System (ABS)');
    const tpmsRaw         = pick('Tire Pressure Monitoring System (TPMS) Type');
    const backupCamRaw    = pick('Rear Visibility System');
    const blindSpotRaw    = pick('Blind Spot Monitoring');
    const laneDepartRaw   = pick('Lane Departure Warning');
    const adaptCruiseRaw  = pick('Adaptive Cruise Control (ACC)');
    const frontAirbags    = pick('Air Bag Locations (Front)');
    const sideAirbags     = pick('Air Bag Locations (Side)');
    const curtainAirbags  = pick('Air Bag Locations (Curtain)');
    const kneeAirbags     = pick('Air Bag Locations (Knee)');

    // ── EPA enrichment ───────────────────────────────────────────────────
    // Pass the decoded engine so multi-trim models (e.g. a Challenger's SXT V6 vs
    // R/T V8) resolve to the correct trim's fuel type/MPG, not just the first one.
    const epa = await epaLookup(year, make, model, {
      displL:     toNum(displ),
      cylinders:  toNum(cyls),
    });

    // ── AI fallback for tank capacity ─────────────────────────────────────
    const epaHasTank = (epa?.tankEst ?? 0) > 0;
    const aiTank     = epaHasTank ? null : await aiFallbackTankSize(year, make, model, trim ?? '');
    const tankEst: number | null  = epa?.tankEst ?? aiTank;
    const tankSource: 'epa' | 'ai' | null = epa?.tankEst ? 'epa' : aiTank ? 'ai' : null;

    // ── Build specs object ───────────────────────────────────────────────
    const specs: VehicleSpecs = {
      vin,
      manufacturer:     manufacturer ?? undefined,
      vehicleType:      vehicleType  ?? undefined,
      bodyClass:        body         ?? undefined,
      series:           series       ?? undefined,
      driveType:        drive        ?? undefined,
      transmission:     trans        ?? undefined,
      engineDisplL:     toNum(displ),
      engineCylinders:  toNum(cyls),
      engineHP:         toNum(engineHP),
      engineTorqueLbFt: toNum(engineTorque),
      engineConfig:     engineConfig ?? undefined,
      turbo:            toBool(turboRaw),
      supercharger:     toBool(superRaw),
      fuelInjector:     fuelInjector ?? undefined,
      // Prefer EPA's octane-specific grade ("Premium Gasoline Recommended") over
      // NHTSA's generic category ("Gasoline") — this is the actual answer to
      // "does this vehicle need premium?", matched to the correct trim above.
      fuelType:         epa?.fuelType1 ?? fuel ?? undefined,
      combMpg:          epa?.combMpg,
      cityMpg:          epa?.cityMpg,
      hwyMpg:           epa?.hwyMpg,
      tankEstGallons:   tankEst ?? undefined,
      rangeEstMiles:    epa?.rangeMiles,
      co2GPerMile:      epa?.co2GPerMile,
      epaId:            epa?.epaId,
      seats:            toNum(seats),
      wheelbaseIn:      toNum(wheelbase),
      gvwr:             gvwr         ?? undefined,
      abs:              toBool(absRaw),
      tpmsType:         tpmsRaw      ?? undefined,
      backupCamera:     toBool(backupCamRaw),
      blindSpotMonitor: toBool(blindSpotRaw),
      laneDeparture:    toBool(laneDepartRaw),
      adaptiveCruise:   toBool(adaptCruiseRaw),
      frontAirbags:     frontAirbags  ?? undefined,
      sideAirbags:      sideAirbags   ?? undefined,
      curtainAirbags:   curtainAirbags ?? undefined,
      kneeAirbags:      kneeAirbags   ?? undefined,
      decodedAt:        new Date().toISOString(),
    };

    return NextResponse.json({
      // Backwards-compatible flat fields for VehiclePicker — this `fuel` value is
      // what actually gets saved as the vehicle's fuelType, so it needs the same
      // EPA-preferred, trim-matched value as specs.fuelType above.
      vin, make, model, year,
      body, fuel: epa?.fuelType1 ?? fuel, cylinders: cyls, displacement: displ,
      trim, drive, transmission: trans,
      // Tank size from EPA (or AI fallback) for auto-fill
      tankEst: tankEst,
      // Source of the tank estimate: 'epa' | 'ai' | null
      tankSource,
      // Full specs object
      specs,
    });
  } catch {
    return NextResponse.json(
      { error: 'VIN lookup service unavailable. Try again shortly.' },
      { status: 503 },
    );
  }
}

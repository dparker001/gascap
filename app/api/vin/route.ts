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

async function epaLookup(year: string, make: string, model: string): Promise<{
  epaId?:        string;
  combMpg?:      number;
  cityMpg?:      number;
  hwyMpg?:       number;
  tankEst?:      number;
  rangeMiles?:   number;
  co2GPerMile?:  number;
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

    // Fetch details for first trim
    const vRes = await fetch(`${base}/${items[0].value}`, { headers: hdrs, ...cache });
    if (!vRes.ok) return null;
    const d = await vRes.json() as Record<string, unknown>;

    const comb  = Number(d.comb08  ?? d.combA08  ?? 0);
    const city  = Number(d.city08  ?? d.cityA08  ?? 0);
    const hwy   = Number(d.hwy08   ?? d.hwyA08   ?? 0);
    const range = Number(d.range   ?? d.rangeA   ?? 0);
    const co2   = Number(d.co2TailpipeGpm ?? 0);
    const tank  = comb > 0 && range > 0 ? Math.round((range / comb) * 10) / 10 : null;

    return {
      epaId:       items[0].value,
      combMpg:     comb  > 0 ? comb  : undefined,
      cityMpg:     city  > 0 ? city  : undefined,
      hwyMpg:      hwy   > 0 ? hwy   : undefined,
      tankEst:     tank  ?? undefined,
      rangeMiles:  range > 0 ? range : undefined,
      co2GPerMile: co2   > 0 ? co2   : undefined,
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
    const epa = await epaLookup(year, make, model);

    // ── AI fallback for tank capacity ─────────────────────────────────────
    const tankEst: number | null =
      epa?.tankEst ??
      (await aiFallbackTankSize(year, make, model, trim ?? ''));

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
      fuelType:         fuel         ?? undefined,
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
      // Backwards-compatible flat fields for VehiclePicker
      vin, make, model, year,
      body, fuel, cylinders: cyls, displacement: displ,
      trim, drive, transmission: trans,
      // Tank size from EPA (or AI fallback) for auto-fill
      tankEst: tankEst,
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

/**
 * GET /api/gas-price?lat=xx&lng=yy
 *
 * Returns the average regular unleaded gas price for the U.S. state
 * corresponding to the supplied lat/lng, using:
 *   1. Nominatim (OpenStreetMap) reverse-geocode to resolve state
 *   2. EIA Open Data API v2 for weekly gas prices
 *
 * EIA API key: set EIA_API_KEY in Railway environment variables (free at https://www.eia.gov/opendata/)
 * Falls back to national average if state not found or key missing.
 */

import { NextResponse } from 'next/server';

// EIA v2 series IDs for state-level weekly retail gas prices (regular grade)
// States with dedicated EIA series
const STATE_SERIES: Record<string, string> = {
  AK: 'EMM_EPMRU_PTE_SAK_DPG',
  AL: 'EMM_EPMRU_PTE_SAL_DPG',
  AR: 'EMM_EPMRU_PTE_SAR_DPG',
  AZ: 'EMM_EPMRU_PTE_SAZ_DPG',
  CA: 'EMM_EPMRU_PTE_SCA_DPG',
  CO: 'EMM_EPMRU_PTE_SCO_DPG',
  CT: 'EMM_EPMRU_PTE_SCT_DPG',
  DC: 'EMM_EPMRU_PTE_SDC_DPG',
  DE: 'EMM_EPMRU_PTE_SDE_DPG',
  FL: 'EMM_EPMRU_PTE_SFL_DPG',
  GA: 'EMM_EPMRU_PTE_SGA_DPG',
  HI: 'EMM_EPMRU_PTE_SHI_DPG',
  IA: 'EMM_EPMRU_PTE_SIA_DPG',
  ID: 'EMM_EPMRU_PTE_SID_DPG',
  IL: 'EMM_EPMRU_PTE_SIL_DPG',
  IN: 'EMM_EPMRU_PTE_SIN_DPG',
  KS: 'EMM_EPMRU_PTE_SKS_DPG',
  KY: 'EMM_EPMRU_PTE_SKY_DPG',
  LA: 'EMM_EPMRU_PTE_SLA_DPG',
  MA: 'EMM_EPMRU_PTE_SMA_DPG',
  MD: 'EMM_EPMRU_PTE_SMD_DPG',
  ME: 'EMM_EPMRU_PTE_SME_DPG',
  MI: 'EMM_EPMRU_PTE_SMI_DPG',
  MN: 'EMM_EPMRU_PTE_SMN_DPG',
  MO: 'EMM_EPMRU_PTE_SMO_DPG',
  MS: 'EMM_EPMRU_PTE_SMS_DPG',
  MT: 'EMM_EPMRU_PTE_SMT_DPG',
  NC: 'EMM_EPMRU_PTE_SNC_DPG',
  ND: 'EMM_EPMRU_PTE_SND_DPG',
  NE: 'EMM_EPMRU_PTE_SNE_DPG',
  NH: 'EMM_EPMRU_PTE_SNH_DPG',
  NJ: 'EMM_EPMRU_PTE_SNJ_DPG',
  NM: 'EMM_EPMRU_PTE_SNM_DPG',
  NV: 'EMM_EPMRU_PTE_SNV_DPG',
  NY: 'EMM_EPMRU_PTE_SNY_DPG',
  OH: 'EMM_EPMRU_PTE_SOH_DPG',
  OK: 'EMM_EPMRU_PTE_SOK_DPG',
  OR: 'EMM_EPMRU_PTE_SOR_DPG',
  PA: 'EMM_EPMRU_PTE_SPA_DPG',
  RI: 'EMM_EPMRU_PTE_SRI_DPG',
  SC: 'EMM_EPMRU_PTE_SSC_DPG',
  SD: 'EMM_EPMRU_PTE_SSD_DPG',
  TN: 'EMM_EPMRU_PTE_STN_DPG',
  TX: 'EMM_EPMRU_PTE_STX_DPG',
  UT: 'EMM_EPMRU_PTE_SUT_DPG',
  VA: 'EMM_EPMRU_PTE_SVA_DPG',
  VT: 'EMM_EPMRU_PTE_SVT_DPG',
  WA: 'EMM_EPMRU_PTE_SWA_DPG',
  WI: 'EMM_EPMRU_PTE_SWI_DPG',
  WV: 'EMM_EPMRU_PTE_SWV_DPG',
  WY: 'EMM_EPMRU_PTE_SWY_DPG',
  // National average fallback
  US: 'EMM_EPMRU_PTE_NUS_DPG',
};

const EIA_KEY = process.env.EIA_API_KEY ?? '';

async function getStateFromCoords(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res  = await fetch(url, {
      headers: { 'User-Agent': 'GasCap/1.0 (hello@gascap.app)' },
      next:    { revalidate: 3600 },
    });
    if (!res.ok) return 'US';
    const data = await res.json() as {
      address?: {
        state_code?:       string;
        'ISO3166-2-lvl4'?: string;
        state?:            string;
      };
    };

    // Try multiple fields Nominatim may return for the state code
    const raw =
      data.address?.state_code ??
      data.address?.['ISO3166-2-lvl4'] ??
      '';

    // ISO3166-2-lvl4 comes as "US-CA" — strip the country prefix
    const code = raw.includes('-') ? raw.split('-')[1] : raw;
    return code?.toUpperCase() || 'US';
  } catch {
    return 'US';
  }
}

async function getPriceForSeries(series: string): Promise<number | null> {
  if (!EIA_KEY) return null;
  try {
    const url =
      `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${EIA_KEY}` +
      `&frequency=weekly&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=1` +
      `&facets[series][]=${series}`;
    const res  = await fetch(url, { next: { revalidate: 3600 * 6 } });
    if (!res.ok) return null;
    const json  = await res.json() as { response?: { data?: { value?: number }[] } };
    const value = json.response?.data?.[0]?.value;
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lng = parseFloat(searchParams.get('lng') ?? '');

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 });
  }

  if (!EIA_KEY) {
    return NextResponse.json({ price: null, state: 'US', noApiKey: true });
  }

  try {
    const stateCode  = await getStateFromCoords(lat, lng);
    const series     = STATE_SERIES[stateCode] ?? STATE_SERIES['US'];
    const statePrice = await getPriceForSeries(series);

    // Fall back to national average if state series returned nothing
    const price = statePrice ?? await getPriceForSeries(STATE_SERIES['US']);

    if (!price) {
      return NextResponse.json({ price: null, state: stateCode, noApiKey: false });
    }

    return NextResponse.json({
      price:      Math.round(price * 100) / 100,
      state:      stateCode,
      isState:    stateCode !== 'US' && statePrice !== null,
      isNational: stateCode === 'US' || statePrice === null,
      source:     'eia',
      updatedAt:  new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}

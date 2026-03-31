/**
 * GET /api/gas-price/national
 *
 * Returns the current US national average regular gas price from EIA.
 * Cached for 6 hours — safe for frequent client polling.
 * No location required (uses NUS duoarea facet directly).
 */

import { NextResponse } from 'next/server';

const EIA_KEY = process.env.EIA_API_KEY ?? '';

async function getNationalAverage(): Promise<number | null> {
  if (!EIA_KEY) return null;
  try {
    const url =
      `https://api.eia.gov/v2/petroleum/pri/gnd/data/` +
      `?api_key=${EIA_KEY}` +
      `&frequency=weekly` +
      `&data[0]=value` +
      `&sort[0][column]=period&sort[0][direction]=desc` +
      `&length=1` +
      `&facets[duoarea][]=NUS` +
      `&facets[product][]=EPMR`;
    const res  = await fetch(url, { next: { revalidate: 3600 * 6 } });
    if (!res.ok) return null;
    const json  = await res.json() as { response?: { data?: { value?: string | number; period?: string }[] } };
    const raw   = json.response?.data?.[0]?.value;
    const price = parseFloat(String(raw ?? ''));
    return isNaN(price) ? null : price;
  } catch {
    return null;
  }
}

export async function GET() {
  const price = await getNationalAverage();
  if (price === null) {
    return NextResponse.json({ price: null, noApiKey: !EIA_KEY });
  }
  return NextResponse.json({
    price:    Math.round(price * 1000) / 1000,
    source:   'eia',
    updatedAt: new Date().toISOString(),
  });
}

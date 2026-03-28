/**
 * GET /api/gas-price/history?weeks=52
 * Returns weekly US national average regular gasoline prices from the EIA API.
 * Cached for 6 hours. No auth required — public data.
 */
import { NextResponse } from 'next/server';

export interface PriceWeek {
  period: string;   // "YYYY-MM-DD" (Monday of that week)
  price:  number;   // $/gallon
}

interface EiaResponse {
  response?: {
    data?: { period: string; value: string | number | null }[];
  };
  error?: string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const weeks = Math.min(parseInt(searchParams.get('weeks') ?? '52', 10), 156); // max 3 years

  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'EIA_API_KEY not configured.' }, { status: 503 });
  }

  const url = new URL('https://api.eia.gov/v2/petroleum/pri/gnd/data/');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('frequency', 'weekly');
  url.searchParams.append('data[0]', 'value');
  url.searchParams.append('facets[duoarea][]', 'NUS');   // National US
  url.searchParams.append('facets[product][]', 'EPM0'); // Regular gasoline
  url.searchParams.append('sort[0][column]', 'period');
  url.searchParams.append('sort[0][direction]', 'desc');
  url.searchParams.set('length', String(weeks));

  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 21600 }, // cache 6 hours
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'EIA API error.' }, { status: 502 });
    }

    const json = await res.json() as EiaResponse;
    const raw  = json.response?.data ?? [];

    const data: PriceWeek[] = raw
      .filter((d) => d.value != null && d.value !== '')
      .map((d) => ({
        period: d.period,
        price:  Math.round(Number(d.value) * 1000) / 1000,
      }))
      .reverse(); // oldest → newest for charting

    return NextResponse.json({ data, weeks: data.length });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch gas price history.' }, { status: 503 });
  }
}

/**
 * GET /api/fillup-optimizer?state=TX
 *
 * Returns a Smart Fill-Up Optimizer recommendation combining:
 *  - 8 weeks of EIA state/national weekly gas price data (real market trend)
 *  - The authenticated user's average fill-up size from their log history
 *
 * Requires Pro plan. State code optional — falls back to national if omitted
 * or if the state has no EIA data.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import type { Session }     from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { getFillups }       from '@/lib/fillups';

const EIA_KEY = process.env.EIA_API_KEY ?? '';

function userId(session: Session | null) {
  return session?.user?.id ?? session?.user?.email ?? '';
}

async function fetchWeeklyPrices(stateCode: string): Promise<number[]> {
  if (!EIA_KEY) return [];
  const duoarea = stateCode === 'US' ? 'NUS' : `S${stateCode}`;
  try {
    const url =
      `https://api.eia.gov/v2/petroleum/pri/gnd/data/` +
      `?api_key=${EIA_KEY}` +
      `&frequency=weekly` +
      `&data[0]=value` +
      `&sort[0][column]=period&sort[0][direction]=desc` +
      `&length=8` +
      `&facets[duoarea][]=${duoarea}` +
      `&facets[product][]=EPMR`;
    const res  = await fetch(url, { next: { revalidate: 3600 * 6 } });
    if (!res.ok) return [];
    const json = await res.json() as { response?: { data?: { value?: string | number }[] } };
    return (json.response?.data ?? [])
      .map((d) => parseFloat(String(d.value ?? '')))
      .filter((v) => !isNaN(v))
      .reverse(); // oldest → newest
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro/Fleet only
  const plan = (session.user as { plan?: string }).plan ?? 'free';
  if (plan === 'free') return NextResponse.json({ error: 'Pro plan required.' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const stateParam = (searchParams.get('state') ?? 'US').toUpperCase();

  if (!EIA_KEY) {
    return NextResponse.json({ error: 'EIA API key not configured.' }, { status: 503 });
  }

  // Fetch state prices, fall back to national if insufficient data
  let prices       = await fetchWeeklyPrices(stateParam);
  let usingNational = stateParam === 'US';

  if (prices.length < 3 && stateParam !== 'US') {
    prices        = await fetchWeeklyPrices('US');
    usingNational = true;
  }

  if (prices.length < 2) {
    return NextResponse.json({ error: 'Insufficient EIA data.' }, { status: 503 });
  }

  // User's average fill-up size (personalized savings calc)
  const fillups    = getFillups(userId(session));
  const avgGallons = fillups.length > 0
    ? Math.round((fillups.reduce((s, f) => s + f.gallonsPumped, 0) / fillups.length) * 10) / 10
    : 12;

  const current      = prices[prices.length - 1];
  const oldest       = prices[0];
  const pctChange    = ((current - oldest) / oldest) * 100;

  // Week-over-week slope (most recent two data points)
  const slope        = prices[prices.length - 1] - prices[prices.length - 2];
  const projNextWeek = Math.max(0, current + slope);

  // Dollar impact over user's typical fill-up
  const savingsDelta     = current - projNextWeek; // positive = prices falling
  const potentialSavings = Math.abs(savingsDelta) * avgGallons;

  let recommendation: 'fill_now' | 'wait' | 'neutral';
  if (pctChange > 2 || slope > 0.04)       recommendation = 'fill_now';
  else if (pctChange < -2 || slope < -0.04) recommendation = 'wait';
  else                                       recommendation = 'neutral';

  return NextResponse.json({
    state:             usingNational ? 'US' : stateParam,
    usingNational,
    currentPrice:      Math.round(current      * 1000) / 1000,
    oldestPrice:       Math.round(oldest       * 1000) / 1000,
    pctChange:         Math.round(pctChange    * 10)   / 10,
    weeklyPrices:      prices,
    projectedNextWeek: Math.round(projNextWeek * 1000) / 1000,
    slope:             Math.round(slope        * 1000) / 1000,
    recommendation,
    avgGallons,
    potentialSavings:  Math.round(potentialSavings * 100) / 100,
    fillupCount:       fillups.length,
  });
}

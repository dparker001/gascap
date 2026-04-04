/**
 * Gas Price Prophet game API
 * GET  /api/prophet  — fetch game state (current prediction, leaderboard, user stats)
 * POST /api/prophet  — submit this week's prediction { prediction: 'up'|'down'|'flat' }
 */
import { NextResponse }    from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }     from '@/lib/auth';
import {
  getWeekStart, getPrevWeekStart,
  getUserPrediction, submitPrediction,
  resolvePredictions, getUserStats, getLeaderboard,
  type PredictionChoice,
} from '@/lib/predictions';

const EIA_KEY = process.env.EIA_API_KEY ?? '';

/** Fetch national average gas price from EIA (no location needed). */
async function getNationalPrice(): Promise<number | null> {
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
    const json  = await res.json() as { response?: { data?: { value?: string | number }[] } };
    const raw   = json.response?.data?.[0]?.value;
    const price = parseFloat(String(raw ?? ''));
    return isNaN(price) ? null : Math.round(price * 1000) / 1000;
  } catch { return null; }
}

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId  = session ? ((session.user as { id?: string }).id ?? session.user?.email ?? '') : null;

  const currentPrice = await getNationalPrice();
  const weekStart    = getWeekStart();
  const prevWeek     = getPrevWeekStart(weekStart);

  // Lazy resolution: resolve any pending predictions from previous week
  if (currentPrice) {
    resolvePredictions(prevWeek, currentPrice);
  }

  // User-specific data (null for guests)
  const thisWeekPrediction = userId ? getUserPrediction(userId, weekStart)     : null;
  const lastWeekPrediction = userId ? getUserPrediction(userId, prevWeek)      : null;
  const userStats          = userId ? getUserStats(userId)                      : null;

  // Leaderboard (visible to all)
  const leaderboard = getLeaderboard(10);

  // Find user's rank even if outside top 10
  let userRank: number | null = null;
  if (userId && userStats) {
    const all = getLeaderboard(1000);
    const idx = all.findIndex((s) => s.userId === userId);
    userRank  = idx >= 0 ? idx + 1 : null;
  }

  return NextResponse.json({
    weekStart,
    prevWeek,
    currentPrice,
    thisWeekPrediction,
    lastWeekPrediction,
    userStats,
    userRank,
    leaderboard,
    totalPlayers: leaderboard.length,
  });
}

// ── POST ───────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Sign in to play' }, { status: 401 });

  const userId   = (session.user as { id?: string }).id ?? session.user?.email ?? '';
  const userName = session.user.name ?? 'Anonymous';

  const body = await req.json() as { prediction?: string };
  const choice = body.prediction as PredictionChoice;
  if (!['up', 'down', 'flat'].includes(choice)) {
    return NextResponse.json({ error: 'Invalid prediction' }, { status: 400 });
  }

  const currentPrice = await getNationalPrice();
  if (!currentPrice) {
    return NextResponse.json({ error: 'Could not fetch current gas price. Try again later.' }, { status: 503 });
  }

  const weekStart  = getWeekStart();
  const prediction = submitPrediction(userId, userName, weekStart, choice, currentPrice);

  return NextResponse.json({ prediction, currentPrice });
}

/**
 * Admin Sweepstakes API — protected by ADMIN_PASSWORD
 * GET  /api/admin/sweepstakes?month=YYYY-MM  — preview entrants
 * GET  /api/admin/sweepstakes?history=1      — past draw results
 * POST /api/admin/sweepstakes                — run draw { month, notes? }
 */
import { NextResponse } from 'next/server';
import {
  getEligibleEntrants,
  runWeightedDraw,
  recordDraw,
  getDrawHistory,
  currentMonth,
} from '@/lib/giveaway';

function auth(req: Request): 'ok' | 'no-env' | 'wrong' {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return 'no-env';
  return req.headers.get('x-admin-password') === pw ? 'ok' : 'wrong';
}

export async function GET(req: Request) {
  const _auth = auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized'  }, { status: 401 });

  const url = new URL(req.url);

  // History mode
  if (url.searchParams.get('history') === '1') {
    const draws = await getDrawHistory();
    return NextResponse.json({ draws });
  }

  // Entrant preview
  const month = url.searchParams.get('month') ?? currentMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM.' }, { status: 400 });
  }

  const entrants     = await getEligibleEntrants(month);
  const totalEntries = entrants.reduce((s, e) => s + e.entryCount, 0);
  return NextResponse.json({ month, entrants, totalEntries, entrantCount: entrants.length });
}

export async function POST(req: Request) {
  const _auth = auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized'  }, { status: 401 });

  const body  = await req.json() as { month?: string; notes?: string };
  const month = body.month ?? currentMonth();

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM.' }, { status: 400 });
  }

  try {
    const result = await runWeightedDraw(month);
    const draw   = await recordDraw(result, body.notes);
    return NextResponse.json({ ok: true, draw });
  } catch (err) {
    const msg = String(err);
    // Unique constraint = draw already run for this month
    if (msg.includes('Unique constraint')) {
      const history = await getDrawHistory();
      const existing = history.find((d) => d.month === month);
      return NextResponse.json(
        { error: `Draw already run for ${month}.`, existing },
        { status: 409 },
      );
    }
    if (msg.includes('No eligible entrants')) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    console.error('[sweepstakes] draw error:', err);
    return NextResponse.json({ error: 'Draw failed.' }, { status: 500 });
  }
}

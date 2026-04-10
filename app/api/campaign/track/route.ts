/**
 * POST /api/campaign/track
 *
 * Client-side event endpoint for the QR placard campaign.
 * Reads the gc_src attribution cookie and logs the event under
 * the placement that originally drove the user.
 *
 * Body: { type: CampaignEventType, meta?: object, path?: string }
 *
 * Always returns 200 (we never want tracking to break the UX).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { logEvent, type CampaignEventType } from '@/lib/campaigns';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const VALID_TYPES: CampaignEventType[] = [
  'page_view',
  'calc_start',
  'calc_complete',
  'save_to_phone',
  'lead_capture',
  'return_visit',
  // 'scan' and 'signup' are logged server-side only — not from client
];

function rndId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(req: NextRequest) {
  const placementCode = req.cookies.get('gc_src')?.value;

  // No attribution cookie = visit didn't come from a campaign QR. Silently
  // succeed so the client doesn't have to branch on it.
  if (!placementCode) {
    return NextResponse.json({ ok: true, attributed: false });
  }

  let body: { type?: string; meta?: Record<string, unknown>; path?: string } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  const type = body.type as CampaignEventType | undefined;
  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ ok: false, error: 'invalid type' }, { status: 400 });
  }

  // Session ID — prefer cookie, fall back to a fresh one
  let sessionId = req.cookies.get('gc_ssn')?.value;
  if (!sessionId) sessionId = rndId('ssn');

  // If signed in, attach userId for cohort analysis
  let userId: string | undefined;
  try {
    const session = await getServerSession(authOptions);
    if (session?.user) {
      userId = (session.user as { id?: string }).id ?? session.user.email ?? undefined;
    }
  } catch { /* unauthenticated is fine */ }

  logEvent({
    placementCode,
    type,
    sessionId,
    userId,
    path:      body.path,
    userAgent: req.headers.get('user-agent') ?? undefined,
    referrer:  req.headers.get('referer') ?? undefined,
    meta:      body.meta,
  });

  const res = NextResponse.json({ ok: true, attributed: true, placementCode });

  // Refresh session cookie window so consecutive events stay tied
  res.cookies.set('gc_ssn', sessionId, {
    maxAge:   60 * 30,
    path:     '/',
    sameSite: 'lax',
    httpOnly: false,
  });

  return res;
}

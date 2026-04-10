/**
 * QR code redirect endpoint
 *
 * Flow:
 *   1. Customer scans placard QR → hits /q/<CODE>
 *   2. We log a "scan" event attributed to <CODE>
 *   3. Set a 90-day attribution cookie so downstream events
 *      (calc_start, signup, etc.) can be credited back to this placement
 *   4. Redirect to landing page (home or custom) with UTM params
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getPlacementByCode, logEvent } from '@/lib/campaigns';

const ATTRIBUTION_COOKIE = 'gc_src';
const SESSION_COOKIE     = 'gc_ssn';
const NINETY_DAYS        = 60 * 60 * 24 * 90;
const THIRTY_MIN         = 60 * 30;

function rndId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const rawCode = params.code ?? '';
  const placement = getPlacementByCode(rawCode);

  // Unknown code: log it as an "unknown scan" under a sentinel so we can
  // still see that a QR was scanned, but don't crash.
  const code = placement?.code ?? `UNKNOWN:${rawCode}`;

  // Ensure session ID exists (used to de-dupe unique scanners)
  let sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionId) sessionId = rndId('ssn');

  logEvent({
    placementCode: code,
    type:          'scan',
    sessionId,
    path:          `/q/${rawCode}`,
    userAgent:     req.headers.get('user-agent') ?? undefined,
    referrer:      req.headers.get('referer') ?? undefined,
    meta:          { known: !!placement, rawCode },
  });

  // Build the landing URL
  const origin = req.nextUrl.origin;
  const landingPath = placement?.landingPath ?? '/';
  const landing = new URL(landingPath, origin);
  landing.searchParams.set('utm_source',   'gascap_qr');
  landing.searchParams.set('utm_medium',   'placard');
  landing.searchParams.set('utm_campaign', placement?.campaign ?? 'Know Before You Fill Up');
  landing.searchParams.set('utm_content',  code);
  if (placement?.headlineVariant) {
    landing.searchParams.set('utm_term', placement.headlineVariant);
  }

  const res = NextResponse.redirect(landing, { status: 302 });

  // 90-day attribution cookie — survives cross-session so repeat visits
  // and eventual signups are credited back to the placard that got them.
  res.cookies.set(ATTRIBUTION_COOKIE, code, {
    maxAge:   NINETY_DAYS,
    path:     '/',
    sameSite: 'lax',
    httpOnly: false, // readable client-side so tracker can confirm attribution
  });

  // 30-minute session cookie for unique-scanner counting
  res.cookies.set(SESSION_COOKIE, sessionId, {
    maxAge:   THIRTY_MIN,
    path:     '/',
    sameSite: 'lax',
    httpOnly: false,
  });

  return res;
}

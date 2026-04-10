/**
 * QR code redirect endpoint
 *
 * Flow:
 *   1. Customer scans placard QR → hits /q/<CODE>
 *   2. We log a "scan" event attributed to <CODE>, including the scanner's
 *      language preference from the QR URL (`?lang=en|es`) so we can measure
 *      EN vs ES pull-through per placement.
 *   3. Set a 90-day attribution cookie so downstream events (calc_start,
 *      signup, etc.) can be credited back to this placement, and a parallel
 *      `gc_lang` cookie so the landing page hydrates in the correct language.
 *   4. Redirect to landing page (home or custom) with UTM params + `lang`.
 *
 * Bilingual QR campaigns:
 *   Each physical placard carries two QR codes side-by-side — one pointing
 *   at /q/<CODE> (English) and one at /q/<CODE>?lang=es (Spanish). Both
 *   scans roll up to the same Placement row in the admin dashboard, so a
 *   single placement shows EN/ES split in its funnel stats without doubling
 *   the placement count.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getPlacementByCode, logEvent } from '@/lib/campaigns';
import { getBaseUrl } from '@/lib/getBaseUrl';

const ATTRIBUTION_COOKIE = 'gc_src';
const LANG_COOKIE        = 'gc_lang';
const SESSION_COOKIE     = 'gc_ssn';
const NINETY_DAYS        = 60 * 60 * 24 * 90;
const THIRTY_MIN         = 60 * 30;

type SupportedLocale = 'en' | 'es';

function rndId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Read `?lang=` off the request URL and normalize it to a supported locale. */
function readLang(req: NextRequest): SupportedLocale {
  const raw = (req.nextUrl.searchParams.get('lang') ?? '').toLowerCase();
  return raw === 'es' ? 'es' : 'en';
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

  // Language preference (from ?lang=es on Spanish placards, or 'en' default)
  const lang = readLang(req);

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
    meta:          { known: !!placement, rawCode, locale: lang },
  });

  // Build the landing URL — use forwarded host helper because Railway sets
  // req.nextUrl.origin to an internal localhost address.
  const origin = getBaseUrl(req);
  const landingPath = placement?.landingPath ?? '/';
  const landing = new URL(landingPath, origin);
  landing.searchParams.set('utm_source',   'gascap_qr');
  landing.searchParams.set('utm_medium',   'placard');
  landing.searchParams.set('utm_campaign', placement?.campaign ?? 'Know Before You Fill Up');
  landing.searchParams.set('utm_content',  code);
  if (placement?.headlineVariant) {
    landing.searchParams.set('utm_term', placement.headlineVariant);
  }
  // Pass language through so the landing page can hydrate LanguageContext
  // from the URL on first paint, bypassing any stale localStorage value.
  landing.searchParams.set('lang', lang);

  const res = NextResponse.redirect(landing, { status: 302 });

  // 90-day attribution cookie — survives cross-session so repeat visits
  // and eventual signups are credited back to the placard that got them.
  res.cookies.set(ATTRIBUTION_COOKIE, code, {
    maxAge:   NINETY_DAYS,
    path:     '/',
    sameSite: 'lax',
    httpOnly: false, // readable client-side so tracker can confirm attribution
  });

  // 90-day language cookie — mirrors the attribution cookie lifetime so a
  // user who scans the Spanish QR once stays in Spanish across return visits.
  res.cookies.set(LANG_COOKIE, lang, {
    maxAge:   NINETY_DAYS,
    path:     '/',
    sameSite: 'lax',
    httpOnly: false,
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

/**
 * UTM/campaign-link redirect endpoint — the generic sibling of
 * /q/[code] (which stays unchanged and is for QR placards specifically).
 *
 * Flow:
 *   1. A Meta/Instagram/TRNDY link points at /go/<CODE>.
 *   2. <CODE> must already exist, active, in AcquisitionCampaignCode —
 *      an unregistered code is a 404, never written to a cookie. This is
 *      the server-managed registry the architecture packet specifies;
 *      no arbitrary ?utm_campaign= string ever reaches a cookie or the
 *      database through this route.
 *   3. Set a 90-day attribution cookie (gc_utm) + a parallel timestamp
 *      cookie (gc_utm_at) so lib/acquisitionAttribution.ts can later
 *      compare this touch's chronological order against a QR touch
 *      (gc_src/gc_src_at, set by /q/[code]) without ever assuming one
 *      channel wins by default.
 *   4. Redirect to the landing page with ordinary utm_* query params so
 *      existing on-page analytics keep working unchanged.
 *
 * Does not touch entitlement, pricing, checkout, or auth in any way —
 * this route only ever sets a cookie and redirects.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { isSyntacticallyValidUtmCode, UTM_COOKIE, UTM_AT_COOKIE } from '@/lib/acquisitionAttribution';

const NINETY_DAYS = 60 * 60 * 24 * 90;

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const rawCode = (params.code ?? '').toLowerCase();
  const origin  = getBaseUrl(req);

  if (!isSyntacticallyValidUtmCode(rawCode)) {
    return NextResponse.redirect(new URL('/', origin), { status: 302 });
  }

  const row = await prisma.acquisitionCampaignCode.findUnique({ where: { code: rawCode } });
  if (!row || !row.active) {
    // Unregistered or deactivated code — redirect home, never set a
    // cookie for a code this registry doesn't vouch for.
    return NextResponse.redirect(new URL('/', origin), { status: 302 });
  }

  const landing = new URL('/', origin);
  landing.searchParams.set('utm_source',   row.source);
  landing.searchParams.set('utm_medium',   'campaign-link');
  landing.searchParams.set('utm_campaign', row.code);
  if (row.label) landing.searchParams.set('utm_content', row.label);

  const res = NextResponse.redirect(landing, { status: 302 });

  // SameSite=Lax (not Strict) — deliberate: this cookie must survive the
  // Google OAuth redirect round-trip (accounts.google.com -> GasCap
  // callback) for the Google signup path to see it. Matches gc_src's
  // existing, already-working convention exactly.
  res.cookies.set(UTM_COOKIE, row.code, {
    maxAge:   NINETY_DAYS,
    path:     '/',
    sameSite: 'lax',
    httpOnly: false, // client-readable, matching gc_src's existing convention
  });
  res.cookies.set(UTM_AT_COOKIE, String(Date.now()), {
    maxAge:   NINETY_DAYS,
    path:     '/',
    sameSite: 'lax',
    httpOnly: false,
  });

  return res;
}

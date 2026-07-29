/**
 * GET  /api/giveaway/claim?month=YYYY-MM&token=xxx — check claim link validity
 * POST /api/giveaway/claim { month, token, certifiedAdult: true } — confirm +
 *      send the Tremendous card
 *
 * Public, token-gated self-serve claim flow (no login required — the token
 * embedded in the winner's email is the credential). Replaces the old
 * address-collection / GHL-webhook-VA-fulfillment flow (WinnerBanner), which
 * predated the Tremendous integration and never checked eligibility either.
 *
 * The Tremendous card is only ever issued after the winner explicitly
 * certifies they're 18+, a U.S. resident, and eligible per the official
 * rules — never before, and never automatically. See
 * app/api/admin/sweepstakes/route.ts PATCH for the admin-side manual-override
 * equivalent of this same guard (used when a winner can't self-serve).
 */
import { NextResponse } from 'next/server';
import { checkClaimToken, recordAgeConfirmedClaim, getCurrentPrizeTier, formatPeriodLabel } from '@/lib/giveaway';
import { sendTremendousCard } from '@/lib/tremendous';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get('month') ?? '';
  const token = searchParams.get('token') ?? '';

  if (!month || !token) {
    return NextResponse.json({ ok: false, reason: 'invalid_token' });
  }

  const status = await checkClaimToken(month, token);
  if (!status.ok) {
    return NextResponse.json({ ok: false, reason: status.reason });
  }

  const { currentTier } = await getCurrentPrizeTier();
  return NextResponse.json({
    ok:         true,
    firstName:  status.draw.winnerName.split(' ')[0] ?? status.draw.winnerName,
    monthLabel: formatPeriodLabel(status.draw.month),
    prize:      currentTier.prize,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    month?: string; token?: string; certifiedAdult?: boolean;
  };
  const { month, token, certifiedAdult } = body;

  if (!month || !token) {
    return NextResponse.json({ ok: false, reason: 'invalid_token' }, { status: 400 });
  }
  if (certifiedAdult !== true) {
    return NextResponse.json(
      { ok: false, reason: 'certification_required', error: 'You must certify eligibility to claim your prize.' },
      { status: 400 },
    );
  }

  const status = await checkClaimToken(month, token);
  if (!status.ok) {
    return NextResponse.json({ ok: false, reason: status.reason });
  }

  const { currentTier } = await getCurrentPrizeTier();
  const result = await sendTremendousCard(status.draw.winnerName, status.draw.winnerEmail, currentTier.prize);

  if (result.configured && !result.sent) {
    // Card failed to send — do NOT mark claimed, so the flow can be retried
    // (or an admin can investigate/fulfill manually) without losing the claim.
    console.error(`[giveaway/claim] Tremendous send failed for ${month}:`, result.error);
    return NextResponse.json(
      { ok: false, reason: 'delivery_failed', error: "Something went wrong sending your card. We've been notified — please email support@gascap.app." },
      { status: 502 },
    );
  }

  await recordAgeConfirmedClaim(month);

  return NextResponse.json({
    ok:     true,
    sent:   result.sent,
    prize:  currentTier.prize,
    manual: !result.configured, // Tremendous not configured — support will fulfill by hand
  });
}

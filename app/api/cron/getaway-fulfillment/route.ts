/**
 * GET /api/cron/getaway-fulfillment
 *
 * Recurring job for the 72-hour getaway verification hold (2026-08-25, revised
 * same day after direct Marketing Boost support confirmation). Finds
 * Lifetime members who chose a destination, whose hold has elapsed, whose
 * fulfillment is still 'pending', and whose qualification hasn't already
 * been marked revoked — then re-verifies entitlement (authoritatively
 * against RevenueCat for an RC-provenance Lifetime; against the DB, which
 * that provider's own webhook keeps current, for Stripe/gift/Ambassador)
 * and fulfills via the SAME attemptGetawayFulfillment() helper
 * app/api/getaway/choose uses — no fulfillment logic is duplicated here.
 *
 * A candidate whose entitlement no longer holds is marked
 * getawayQualificationRevokedAt and skipped — never sent. A candidate whose
 * RevenueCat lookup fails BEFORE the pre-send claim is left exactly as-is
 * ('pending', getawayFulfillmentAttemptedAt still null) and stays eligible
 * for the next run — provider unavailability is never treated as
 * entitlement validity, and never auto-marked as revoked.
 *
 * getawayFulfillmentAttemptedAt IS NULL is a required candidate filter
 * (2026-08-25 merge-blocker fix): once attemptGetawayFulfillment() has
 * claimed a record and actually called Marketing Boost, an 'ambiguous'
 * outcome leaves getawayFulfillmentStatus exactly 'pending' — without this
 * filter the SAME record would be selected again on the next run and
 * Marketing Boost could be called a second time for a send that may have
 * already succeeded. This filter is what makes that impossible: the claim
 * is never cleared automatically, so an ambiguous/ attempted record is
 * permanently excluded until a human resolves it.
 *
 * Runs every 4 hours (see .github/workflows/crons.yml). With a 72-hour hold,
 * actual issuance therefore lands roughly between 72 and 76 hours after
 * purchase — user-facing copy never promises an exact delivery time, only
 * "after a brief purchase-verification period."
 *
 * Secured with CRON_SECRET, same pattern as every other cron route.
 */
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/prisma';
import { attemptGetawayFulfillment } from '@/lib/getawayFulfillment';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date().toISOString();

  let candidates;
  try {
    candidates = await prisma.user.findMany({
      where: {
        getawayFulfillmentStatus:     'pending',
        getawayDestinationId:         { not: null },
        getawayQualificationRevokedAt: null,
        getawayFulfillmentAttemptedAt: null,
        OR: [
          { getawayHoldUntil: null },        // grandfathered pre-feature Lifetime — eligible immediately
          { getawayHoldUntil: { lte: now } },
        ],
      },
      select: { id: true, email: true },
    });
  } catch (err) {
    console.error('[getaway-fulfillment] DB query failed:', err);
    return NextResponse.json({ ok: false, error: 'DB query failed', ran: now }, { status: 500 });
  }

  let sent = 0, manualRequired = 0, ambiguous = 0, skipped = 0, errors = 0;

  for (const candidate of candidates) {
    try {
      const result = await attemptGetawayFulfillment(candidate.id);
      if (result.outcome === 'sent') sent++;
      else if (result.outcome === 'manual_required') manualRequired++;
      else if (result.outcome === 'ambiguous') ambiguous++;
      else {
        skipped++;
        console.info(`[getaway-fulfillment] Skipped ${candidate.email}: ${result.reason}`);
      }
    } catch (err) {
      console.error(`[getaway-fulfillment] Unexpected error for ${candidate.email}:`, err);
      errors++;
    }
  }

  console.log(`[getaway-fulfillment] ${sent} sent, ${manualRequired} manual_required, ${ambiguous} ambiguous, ${skipped} skipped, ${errors} errors, ${candidates.length} candidates`);
  return NextResponse.json({
    ok: true, sent, manualRequired, ambiguous, skipped, errors, candidates: candidates.length, ran: now,
  });
}

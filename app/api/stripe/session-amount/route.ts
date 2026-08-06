/**
 * GET /api/stripe/session-amount?session_id=cs_...
 *
 * Read-only lookup of a Checkout Session's actual charged amount, used by
 * the upgrade success page to fire an accurate Meta Pixel Purchase event
 * (value-based ad optimization needs the real price — win-back/founding-
 * member discounts mean it isn't a fixed per-plan number). Safe to expose
 * by session_id alone: Stripe session IDs are cryptographically random and
 * the caller already possesses this exact ID (it's in their own success-page
 * URL), so there's no meaningful disclosure beyond what they already have.
 */
import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

export async function GET(req: Request) {
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('session_id');
  if (!sessionId) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return NextResponse.json({
      amountTotal: session.amount_total,   // cents
      currency:    session.currency,
    });
  } catch {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
}

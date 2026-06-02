/**
 * POST /api/stripe/gift-checkout
 * Creates a Stripe Checkout Session to BUY GasCap™ Pro Lifetime as a GIFT.
 * Guest-friendly: no auth required — the buyer just provides their email.
 *
 * The webhook (checkout.session.completed) detects metadata.isGift === 'true',
 * generates a redemption code, stores a Gift record, and emails the code.
 * Body: {
 *   purchaserEmail, recipientEmail?, recipientName?, giftMessage?,
 *   occasion?, deliverToRecipient?, coupon?
 * }
 */
import { NextResponse }   from 'next/server';
import { stripe, PRICES } from '@/lib/stripe';
import { getBaseUrl }     from '@/lib/getBaseUrl';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  if (!stripe) {
    return NextResponse.json(
      { error: 'Stripe is not configured. Add STRIPE_SECRET_KEY to .env.local.' },
      { status: 503 },
    );
  }

  const body = await req.json() as {
    purchaserEmail?:     string;
    recipientEmail?:     string;
    recipientName?:      string;
    giftMessage?:        string;
    occasion?:           string;
    deliverToRecipient?: boolean;
    coupon?:             string;
  };

  const purchaserEmail     = (body.purchaserEmail ?? '').trim().toLowerCase();
  const recipientEmail     = (body.recipientEmail ?? '').trim().toLowerCase();
  const recipientName      = (body.recipientName ?? '').trim();
  const giftMessage        = (body.giftMessage ?? '').trim().slice(0, 500);
  const occasion           = ['gift', 'fathers-day', 'birthday', 'holiday'].includes(body.occasion ?? '')
    ? body.occasion! : 'gift';
  const deliverToRecipient = !!body.deliverToRecipient;
  const coupon             = body.coupon?.trim() || null;

  // ── Validation ──────────────────────────────────────────────────────────
  if (!EMAIL_RE.test(purchaserEmail)) {
    return NextResponse.json({ error: 'Please enter a valid email address for the receipt.' }, { status: 400 });
  }
  if (deliverToRecipient && !EMAIL_RE.test(recipientEmail)) {
    return NextResponse.json({ error: "Please enter the recipient's email, or choose to receive the code yourself." }, { status: 400 });
  }

  const priceId = PRICES.proLifetime;
  if (!priceId) {
    return NextResponse.json({ error: 'Gift pricing is not configured.' }, { status: 503 });
  }

  const origin = getBaseUrl(req);

  const metadata: Record<string, string> = {
    isGift:             'true',
    occasion,
    purchaserEmail,
    recipientEmail:     deliverToRecipient ? recipientEmail : '',
    recipientName,
    giftMessage,
    deliverToRecipient: deliverToRecipient ? 'true' : 'false',
  };

  const checkoutSession = await stripe.checkout.sessions.create({
    mode:                 'payment',   // one-time payment for a Lifetime gift
    payment_method_types: ['card'],
    ...(coupon
      ? { discounts: [{ coupon }] }
      : { allow_promotion_codes: true }),
    line_items:     [{ price: priceId, quantity: 1 }],
    customer_email: purchaserEmail,
    success_url:    `${origin}/gift/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:     `${origin}/gift`,
    metadata,
    payment_intent_data: { metadata },
  });

  return NextResponse.json({ url: checkoutSession.url });
}

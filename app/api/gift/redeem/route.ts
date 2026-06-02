/**
 * POST /api/gift/redeem
 * The signed-in recipient claims a gifted Pro Lifetime using a redemption code.
 * Body: { code: string }
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById, grantGiftedLifetime } from '@/lib/users';
import { findGiftByCode, markGiftRedeemed } from '@/lib/gifts';
import { updateGhlContactPlan } from '@/lib/ghl';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Please sign in or create an account to claim your gift.' }, { status: 401 });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = await findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { code?: string };
  const code = (body.code ?? '').toUpperCase().trim();
  if (!code) return NextResponse.json({ error: 'Please enter your gift code.' }, { status: 400 });

  const gift = await findGiftByCode(code);
  if (!gift) {
    return NextResponse.json({ error: "We couldn't find that gift code. Double-check it and try again." }, { status: 404 });
  }
  if (gift.status === 'refunded') {
    return NextResponse.json({ error: 'This gift is no longer valid. Contact support@gascap.app if you believe this is a mistake.' }, { status: 410 });
  }
  if (gift.status === 'redeemed') {
    return NextResponse.json({ error: 'This gift code has already been redeemed.' }, { status: 409 });
  }

  // Already a Lifetime member? Don't consume the gift — let them pass it on.
  const alreadyLifetime = user.plan === 'pro' && user.stripeInterval === 'lifetime' && !user.isProTrial;
  if (alreadyLifetime) {
    return NextResponse.json({
      alreadyLifetime: true,
      message: "You already have GasCap™ Pro Lifetime — so we left this gift unredeemed. Feel free to pass the code along to someone else!",
    });
  }

  // Atomically claim the gift (guards against double-redeem races).
  const claimed = await markGiftRedeemed(code, user.id);
  if (!claimed) {
    return NextResponse.json({ error: 'This gift code has already been redeemed.' }, { status: 409 });
  }

  await grantGiftedLifetime(user.id);

  // Sync plan to GHL CRM (non-fatal)
  updateGhlContactPlan(user.email, 'pro').catch((e) => console.error('[GHL] gift plan sync failed:', e));

  return NextResponse.json({ success: true, message: 'Pro Lifetime unlocked — enjoy! 🎉' });
}

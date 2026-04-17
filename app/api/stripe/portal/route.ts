/**
 * POST /api/stripe/portal
 * Creates a Stripe Customer Portal session so Pro users can manage/cancel.
 */
import { NextResponse }    from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }     from '@/lib/auth';
import { findById, setUserPlan } from '@/lib/users';
import { stripe }          from '@/lib/stripe';

export async function POST(req: Request) {
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured.' }, { status: 503 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = await findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  let customerId = user.stripeCustomerId;

  // Fall back: look up by email if no customerId stored (e.g. webhook missed)
  if (!customerId) {
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      await setUserPlan(userId, user.plan, { customerId });
    }
  }

  // Still nothing — create a customer so portal works going forward
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name });
    customerId = customer.id;
    await setUserPlan(userId, user.plan, { customerId });
  }

  const reqUrl  = new URL(req.url);
  const origin  = `${reqUrl.protocol}//${reqUrl.host}`;

  const portal = await stripe.billingPortal.sessions.create({
    customer:   customerId,
    return_url: `${origin}/`,
  });

  return NextResponse.json({ url: portal.url });
}

/**
 * POST /api/stripe/portal
 * Creates a Stripe Customer Portal session so Pro users can manage/cancel.
 */
import { NextResponse }     from 'next/server';
import { getServerSession }  from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById, setUserPlan, clearStripeCustomerId } from '@/lib/users';
import { stripe }           from '@/lib/stripe';

async function resolveCustomerId(userId: string, user: { email: string; name?: string; plan: string; stripeCustomerId?: string }) {
  if (!stripe) throw new Error('Stripe not configured.');

  let customerId = user.stripeCustomerId;

  // Look up by email if no ID stored (e.g. webhook missed)
  if (!customerId) {
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      await setUserPlan(userId, user.plan, { customerId });
    }
  }

  // Still nothing — create one
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name });
    customerId = customer.id;
    await setUserPlan(userId, user.plan, { customerId });
  }

  return customerId;
}

export async function POST(req: Request) {
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured.' }, { status: 503 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = await findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const reqUrl = new URL(req.url);
  const origin = `${reqUrl.protocol}//${reqUrl.host}`;

  try {
    let customerId = await resolveCustomerId(userId, user);

    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer:   customerId,
        return_url: `${origin}/settings`,
      });
      return NextResponse.json({ url: portal.url });

    } catch (stripeErr) {
      const msg = stripeErr instanceof Error ? stripeErr.message : '';

      // Stale customer ID (test↔live mode switch, deleted customer, etc.)
      // — clear it, get a fresh one, and retry once.
      if (msg.includes('No such customer')) {
        console.warn('[stripe/portal] Stale customer ID detected, resetting and retrying…');
        await clearStripeCustomerId(userId);

        // Force fresh lookup/create (pass empty stripeCustomerId)
        customerId = await resolveCustomerId(userId, { ...user, stripeCustomerId: undefined });

        const portal = await stripe.billingPortal.sessions.create({
          customer:   customerId,
          return_url: `${origin}/settings`,
        });
        return NextResponse.json({ url: portal.url });
      }

      throw stripeErr; // re-throw anything else
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[stripe/portal]', message);

    if (message.includes('No customer portal')) {
      return NextResponse.json(
        { error: 'Billing portal not yet configured. Please contact support@gascap.app.' },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: 'Could not open billing portal. Please try again.' },
      { status: 500 },
    );
  }
}

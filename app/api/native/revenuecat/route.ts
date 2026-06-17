/**
 * POST /api/native/revenuecat
 *
 * RevenueCat webhook → grants/revokes GasCap Pro on the user's account when they
 * buy (or lose) Pro via Apple In-App Purchase on iOS. Because Pro is account-based
 * and synced, an IAP purchase made on iOS unlocks Pro everywhere (web + app), just
 * like a Stripe purchase does. This is the IAP counterpart to the Stripe webhook.
 *
 * Setup:
 *  - RevenueCat dashboard → Project → Integrations → Webhooks → URL =
 *    https://www.gascap.app/api/native/revenuecat, Authorization header = a secret.
 *  - Set that same secret as REVENUECAT_WEBHOOK_AUTH on Railway.
 *  - The native app calls Purchases.logIn(<gascap userId>) so RevenueCat's
 *    app_user_id IS the GasCap user id (how we match the account below).
 *
 * Product IDs (App Store Connect):
 *  - gascap_pro_lifetime  → non-consumable  → interval 'lifetime'
 *  - gascap_pro_monthly   → auto-renew sub  → interval 'monthly'
 */
import { NextResponse } from 'next/server';
import { setUserPlan, findById, findByEmail } from '@/lib/users';

export const dynamic = 'force-dynamic';

const LIFETIME_PRODUCT = 'gascap_pro_lifetime';

// Events that should GRANT / extend Pro.
const GRANT_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',   // lifetime (non-consumable)
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
]);
// Events that should REVOKE Pro. (CANCELLATION = auto-renew off but still active →
// NOT revoked here; access ends at EXPIRATION.)
const REVOKE_EVENTS = new Set(['EXPIRATION', 'REFUND']);

interface RcEvent {
  type?:                string;
  app_user_id?:         string;
  original_app_user_id?: string;
  aliases?:             string[];
  product_id?:          string;
}

/** Resolve the GasCap user from RevenueCat's app_user_id (we set it = userId). */
async function resolveUser(ev: RcEvent) {
  const candidates = [ev.app_user_id, ev.original_app_user_id, ...(ev.aliases ?? [])]
    .filter((v): v is string => !!v);
  for (const c of candidates) {
    const byId = await findById(c);
    if (byId) return byId;
  }
  // Fallback: some setups use email as the app_user_id.
  for (const c of candidates) {
    if (c.includes('@')) {
      const byEmail = await findByEmail(c);
      if (byEmail) return byEmail;
    }
  }
  return undefined;
}

export async function POST(req: Request) {
  // Auth: RevenueCat sends the Authorization header you configure in its dashboard.
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (expected && req.headers.get('authorization') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { event?: RcEvent } | null;
  const ev = body?.event;
  if (!ev?.type) return NextResponse.json({ ok: true, skipped: 'no event' });

  // Ignore test/non-actionable event types we don't handle.
  if (!GRANT_EVENTS.has(ev.type) && !REVOKE_EVENTS.has(ev.type)) {
    return NextResponse.json({ ok: true, ignored: ev.type });
  }

  const user = await resolveUser(ev);
  if (!user) {
    console.error('[revenuecat] no matching user for app_user_id:', ev.app_user_id);
    // 200 so RevenueCat doesn't retry forever on an unmatched id.
    return NextResponse.json({ ok: true, unmatched: true });
  }

  try {
    if (GRANT_EVENTS.has(ev.type)) {
      const interval: 'monthly' | 'lifetime' =
        ev.product_id === LIFETIME_PRODUCT ? 'lifetime' : 'monthly';
      await setUserPlan(user.id, 'pro', { interval });
      console.log(`[revenuecat] ${ev.type} → granted Pro (${interval}) to ${user.email}`);
    } else {
      // EXPIRATION / REFUND → revert to free (setUserPlan protects ambassador Pro-for-life).
      await setUserPlan(user.id, 'free');
      console.log(`[revenuecat] ${ev.type} → reverted ${user.email} to free`);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[revenuecat] grant/revoke failed:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

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
import { setUserPlan, findById, findByEmail, enrollPaidCampaign } from '@/lib/users';
import { sendMail } from '@/lib/email';
import { sendPaidCampaignEmail } from '@/lib/emailCampaignPaid';
import { getawayPromoActive, GETAWAY_DISCLOSURE } from '@/lib/getawayPromo';

export const dynamic = 'force-dynamic';

const LIFETIME_PRODUCT = 'gascap_pro_lifetime';

/** Fire-and-forget admin notification (mirrors the Stripe webhook). */
function sendAdminMail(opts: { subject: string; html: string; text: string }) {
  sendMail({ to: 'info@gascap.app', ...opts })
    .catch((e) => console.error('[revenuecat] Admin notify failed:', e));
}

/**
 * Getaway promo fulfillment for IAP lifetime buyers — same as the Stripe webhook.
 * Lifetime purchase during the active promo earns a complimentary resort getaway;
 * the buyer picks a destination at /getaway (or via the success-page picker),
 * which fires the actionable "ISSUE GETAWAY CERT" email. Here we give the admin a
 * heads-up and email the buyer the choose link. Only on the initial lifetime
 * purchase event so it can't fire twice.
 */
function maybeSendGetaway(user: { email: string; name?: string | null }, eventType: string) {
  if (!getawayPromoActive()) return;
  if (!INITIAL_GRANT_EVENTS.has(eventType)) return;
  const baseUrl   = (process.env.NEXTAUTH_URL ?? 'https://www.gascap.app').replace(/\/$/, '');
  const chooseUrl = `${baseUrl}/getaway`;
  const name      = user.name ?? 'there';

  sendAdminMail({
    subject: `🏝️ Getaway sale (IAP) — ${user.email} will choose a destination`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
      <p style="font-size:20px;margin:0 0 8px;">🏝️ Getaway promo sale (Apple IAP)</p>
      <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${name}</strong> bought Pro Lifetime via the app during the getaway promo.</p>
      <p style="font-size:14px;color:#64748b;margin:0 0 12px;">They'll pick a destination at /getaway — you'll get a separate <strong>"ISSUE GETAWAY CERT"</strong> email with the destination once they choose. No action needed yet.</p>
      <p style="font-size:13px;color:#64748b;margin:0 0 4px;">Buyer: <strong>${user.email}</strong></p>
    </div>`,
    text: `Getaway promo sale (IAP): ${name} <${user.email}> — awaiting destination choice (separate ISSUE email to follow).`,
  });

  sendMail({
    to:      user.email,
    subject: `🏝️ Choose your complimentary getaway`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#005F4A,#1EB68F);border-radius:16px 16px 0 0;padding:24px;text-align:center;">
        <p style="font-size:26px;margin:0;color:#fff;font-weight:800;">🏝️ You've earned a getaway!</p>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px;">
        <p style="font-size:15px;color:#334155;margin:0 0 12px;">Hi ${name}, thanks for going Lifetime with GasCap™ Pro! 🎉 As a thank-you, pick the complimentary resort getaway you'd like:</p>
        <p style="text-align:center;margin:0 0 16px;">
          <a href="${chooseUrl}" style="display:inline-block;background:#1EB68F;color:#fff;font-weight:800;font-size:15px;text-decoration:none;padding:12px 28px;border-radius:12px;">Choose my destination →</a>
        </p>
        <div style="background:#f0fdf9;border:1px solid #99f6e4;border-radius:12px;padding:14px 16px;margin:0 0 12px;">
          <p style="font-size:12px;color:#0f766e;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">Good to know</p>
          ${GETAWAY_DISCLOSURE.full.map((l) => `<p style="font-size:13px;color:#334155;margin:0 0 4px;">• ${l}</p>`).join('')}
        </div>
        <p style="font-size:13px;color:#64748b;margin:0;">Questions? Just reply to this email.</p>
      </div>
    </div>`,
    text: `You've earned a complimentary getaway! Choose your destination: ${chooseUrl}. ${GETAWAY_DISCLOSURE.short}`,
  }).catch((e) => console.error('[revenuecat] Getaway choose email failed:', e));

  console.info(`[revenuecat] Getaway promo — choose-destination email sent to ${user.email}`);
}

// Events that should GRANT / extend Pro.
const GRANT_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',   // lifetime (non-consumable)
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'TRANSFER',                // non-consumable restored/transferred to a new app_user_id
]);
// First-time grant events → trigger the welcome email + getaway (once).
const INITIAL_GRANT_EVENTS = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'TRANSFER']);
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
      // First grant only (idempotent): welcome email + paid nurture, mirroring the
      // Stripe path so IAP buyers also get an upgrade-confirmation email.
      if (INITIAL_GRANT_EVENTS.has(ev.type) && !user.paidCampaignEnrolledAt) {
        await enrollPaidCampaign(user.id, interval)
          .catch((e) => console.error('[revenuecat] paid-campaign enroll failed:', e));
        sendPaidCampaignEmail('P1', {
          id: user.id, name: user.name, email: user.email, tier: 'pro', interval,
        }).catch((e) => console.error('[revenuecat] P1 welcome send failed:', e));
      }
      // Lifetime buyers earn the complimentary getaway during the active promo.
      if (interval === 'lifetime') maybeSendGetaway(user, ev.type);
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

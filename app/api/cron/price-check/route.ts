/**
 * POST /api/cron/price-check
 *
 * Fetches the current national average gas price from EIA and sends a
 * push notification to any Pro/Fleet user whose alert threshold is at or
 * above the current price — with a 24-hour debounce per user so we never
 * spam.
 *
 * Protected by x-cron-secret header.
 * Schedule: every day at 9:00 AM ET (set in instrumentation.ts)
 */

import { NextResponse }                          from 'next/server';
import { getAllSubs }                             from '@/lib/pushSubscriptions';
import { getAllUsers, setLastPriceAlertSent }     from '@/lib/users';
import webpush                                    from 'web-push';

const CRON_SECRET = process.env.CRON_SECRET   ?? '';
const EIA_KEY     = process.env.EIA_API_KEY   ?? '';

function initVapid(): boolean {
  const pub  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:hello@gascap.app',
    pub,
    priv,
  );
  return true;
}

/** Fetch current national average regular unleaded price from EIA. */
async function getNationalPrice(): Promise<number | null> {
  if (!EIA_KEY) return null;
  try {
    const url =
      `https://api.eia.gov/v2/petroleum/pri/gnd/data/` +
      `?api_key=${EIA_KEY}` +
      `&frequency=weekly` +
      `&data[0]=value` +
      `&sort[0][column]=period&sort[0][direction]=desc` +
      `&length=1` +
      `&facets[duoarea][]=NUS` +
      `&facets[product][]=EPMR`;
    const res  = await fetch(url);
    if (!res.ok) return null;
    const json  = await res.json() as { response?: { data?: { value?: string | number }[] } };
    const raw   = json.response?.data?.[0]?.value;
    const price = parseFloat(String(raw ?? ''));
    return isNaN(price) ? null : price;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = req.headers.get('x-cron-secret') ?? '';
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!initVapid()) {
    return NextResponse.json({ error: 'Push not configured — check VAPID env vars.' }, { status: 503 });
  }

  // ── Fetch current national price ──────────────────────────────────────────
  const nationalPrice = await getNationalPrice();
  if (nationalPrice === null) {
    console.warn('[Cron/PriceCheck] Could not fetch EIA gas price — skipping.');
    return NextResponse.json({ sent: 0, skipped: true, reason: 'EIA price unavailable' });
  }

  const allSubs  = getAllSubs();
  const allUsers = getAllUsers();
  const now      = new Date();
  const DEBOUNCE = 24 * 60 * 60 * 1000; // 24 hours in ms

  // ── Find eligible users ───────────────────────────────────────────────────
  const eligible = allUsers.filter((u) => {
    // Must be Pro or Fleet with a threshold set
    if (u.plan !== 'pro' && u.plan !== 'fleet') return false;
    if (!u.priceAlertThreshold)                  return false;
    // Current price must be at or below their threshold
    if (nationalPrice > u.priceAlertThreshold)   return false;
    // 24h debounce — don't re-notify if we sent recently
    if (u.lastPriceAlertSentAt) {
      const lastSent = new Date(u.lastPriceAlertSentAt).getTime();
      if (now.getTime() - lastSent < DEBOUNCE)   return false;
    }
    // Must have at least one active push subscription
    return allSubs.some((s) => s.userId === u.id);
  });

  if (eligible.length === 0) {
    console.log(`[Cron/PriceCheck] National: $${nationalPrice.toFixed(3)}/gal — no eligible users.`);
    return NextResponse.json({ sent: 0, nationalPrice, reason: 'No eligible users' });
  }

  // ── Send notifications ────────────────────────────────────────────────────
  let sent = 0;

  for (const user of eligible) {
    const savings = (user.priceAlertThreshold! - nationalPrice).toFixed(2);

    const payload = JSON.stringify({
      title: '⛽ Gas prices dropped!',
      body:  `National avg is $${nationalPrice.toFixed(3)}/gal — $${savings} below your alert. Good time to fill up!`,
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      url:   '/',
    });

    const userSubs = allSubs.filter((s) => s.userId === user.id);
    for (const sub of userSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload,
        );
        sent++;
      } catch {
        // Expired or invalid subscription — skip silently
      }
    }

    // Stamp debounce timestamp so we don't re-notify for 24h
    setLastPriceAlertSent(user.id);
  }

  console.log(
    `[Cron/PriceCheck] National: $${nationalPrice.toFixed(3)}/gal. ` +
    `Notified ${sent} subscription(s) for ${eligible.length} user(s).`,
  );
  return NextResponse.json({ sent, nationalPrice, notifiedUsers: eligible.length });
}

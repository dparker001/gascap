/**
 * GET /api/cron/price-alerts
 *
 * Runs once daily (recommend: 20:00 UTC / 4 PM Eastern — peak engagement window).
 *
 * 1. Fetches the current US national average from the EIA.
 * 2. Finds all Pro/Fleet users who have a priceAlertThreshold set.
 * 3. For each user where currentPrice < threshold AND no alert was sent today:
 *    — Sends a price-drop alert email.
 *    — Stamps lastPriceAlertSentAt = now so we don't re-send the same day.
 *
 * Secured with CRON_SECRET env var (append ?secret=<value> in Railway scheduler).
 */

import { NextResponse }               from 'next/server';
import { getAllUsers }                 from '@/lib/users';
import { sendMail, priceAlertEmailHtml } from '@/lib/email';
import { prisma }                       from '@/lib/prisma';
import { sendApns, apnsConfigured }      from '@/lib/apns';

const EIA_KEY = process.env.EIA_API_KEY ?? '';

/** Fetch the current national average gas price from the EIA v2 API. */
async function fetchNationalPrice(): Promise<number | null> {
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

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;

    const json = await res.json() as {
      response?: { data?: { value?: string | number }[] };
    };
    const val = json.response?.data?.[0]?.value;
    if (val === undefined) return null;
    const parsed = parseFloat(String(val));
    return isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Fetch current price ───────────────────────────────────────────────────
  const currentPrice = await fetchNationalPrice();
  if (currentPrice === null) {
    return NextResponse.json({
      ok:      false,
      reason:  EIA_KEY ? 'EIA fetch failed' : 'No EIA_API_KEY configured',
      sent:    0,
      skipped: 0,
    });
  }

  // ── Load all users ────────────────────────────────────────────────────────
  const allUsers = await getAllUsers();
  let sent    = 0;
  let skipped = 0;
  let rearmed = 0;

  for (const user of allUsers) {
    // Pro only (includes Pro Lifetime + trial — all plan='pro'). Free excluded.
    if (user.plan !== 'pro')       continue;
    if (!user.priceAlertThreshold) continue;

    const below    = currentPrice < user.priceAlertThreshold;
    const notified = (user as { priceAlertNotified?: boolean }).priceAlertNotified === true;

    // Price is at/above the threshold → re-arm so the NEXT drop alerts again.
    if (!below) {
      if (notified) {
        await prisma.user.update({ where: { id: user.id }, data: { priceAlertNotified: false } });
        rearmed++;
      }
      skipped++;
      continue;
    }

    // Below threshold, but we already alerted for this drop → stay quiet (one per drop).
    if (notified) { skipped++; continue; }

    // ── New drop → alert on every channel the user is reachable on ───────────
    const willEmail = !user.emailOptOut && !!user.email;
    const iosToken  = (user as { iosPushToken?: string | null }).iosPushToken;
    const willPush  = !!iosToken && apnsConfigured();
    if (!willEmail && !willPush) { skipped++; continue; }

    const firstName = (user.displayName || user.name || 'there').split(' ')[0];

    try {
      if (willEmail) {
        await sendMail({
          to:      user.email,
          subject: `⛽ Gas prices just dropped — $${currentPrice.toFixed(3)}/gal`,
          html:    priceAlertEmailHtml(firstName, currentPrice, user.priceAlertThreshold, user.plan ?? 'pro'),
          text:    `Hi ${firstName}, the US national average gas price is now $${currentPrice.toFixed(3)}/gal — below your $${user.priceAlertThreshold.toFixed(2)} alert. Open GasCap™ to calculate your fill-up: https://www.gascap.app`,
          unsubscribeUrl: `https://www.gascap.app/settings?tab=alerts`,
        });
      }

      if (willPush && iosToken) {
        const r = await sendApns(
          iosToken,
          '⛽ Gas prices dropped',
          `National average is $${currentPrice.toFixed(3)}/gal — below your $${user.priceAlertThreshold.toFixed(2)} alert. Tap to calculate your fill-up.`,
        );
        if (!r.ok) console.warn(`[PriceAlerts] push failed for ${user.email}: ${r.status ?? ''} ${r.reason ?? ''}`);
      }

      // Mark notified so we don't re-alert until the price recovers above the
      // threshold and then drops again (one alert per drop, not daily).
      await prisma.user.update({
        where: { id: user.id },
        data:  { priceAlertNotified: true, lastPriceAlertSentAt: new Date().toISOString() },
      });

      sent++;
      console.log(`[PriceAlerts] Alerted ${user.email} ($${currentPrice.toFixed(3)} < $${user.priceAlertThreshold}) email=${willEmail} push=${willPush}`);
    } catch (err) {
      console.error(`[PriceAlerts] Failed for ${user.email}:`, err);
    }
  }

  return NextResponse.json({
    ok:           true,
    currentPrice: Math.round(currentPrice * 1000) / 1000,
    sent,
    skipped,
    rearmed,
    checkedAt:    new Date().toISOString(),
  });
}

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
  const today    = new Date().toDateString(); // e.g. "Mon May 05 2026"

  let sent    = 0;
  let skipped = 0;

  for (const user of allUsers) {
    // Only Pro / Fleet users with a threshold set
    if (user.plan !== 'pro' && user.plan !== 'fleet') continue;
    if (!user.priceAlertThreshold)                     continue;
    if (user.emailOptOut)                              continue;
    if (!user.email)                                   continue;

    // Price must be below threshold
    if (currentPrice >= user.priceAlertThreshold) { skipped++; continue; }

    // Don't re-send the same calendar day
    if (
      user.lastPriceAlertSentAt &&
      new Date(user.lastPriceAlertSentAt).toDateString() === today
    ) {
      skipped++;
      continue;
    }

    // ── Send email ──────────────────────────────────────────────────────────
    const firstName = (user.displayName || user.name || 'there').split(' ')[0];

    try {
      await sendMail({
        to:      user.email,
        subject: `⛽ Gas prices just dropped — $${currentPrice.toFixed(3)}/gal`,
        html:    priceAlertEmailHtml(firstName, currentPrice, user.priceAlertThreshold, user.plan ?? 'pro'),
        text:    `Hi ${firstName}, the US national average gas price is now $${currentPrice.toFixed(3)}/gal — below your $${user.priceAlertThreshold.toFixed(2)} alert. Open GasCap™ to calculate your fill-up: https://www.gascap.app`,
        unsubscribeUrl: `https://www.gascap.app/settings?tab=alerts`,
      });

      // ── Native iOS push (in addition to the email) ─────────────────────────
      const iosToken = (user as { iosPushToken?: string | null }).iosPushToken;
      if (iosToken && apnsConfigured()) {
        const r = await sendApns(
          iosToken,
          '⛽ Gas prices dropped',
          `National average is $${currentPrice.toFixed(3)}/gal — below your $${user.priceAlertThreshold.toFixed(2)} alert. Tap to calculate your fill-up.`,
        );
        if (!r.ok) console.warn(`[PriceAlerts] push failed for ${user.email}: ${r.status ?? ''} ${r.reason ?? ''}`);
      }

      // Stamp the sent timestamp so we don't re-fire today
      await prisma.user.update({
        where: { id: user.id },
        data:  { lastPriceAlertSentAt: new Date().toISOString() },
      });

      sent++;
      console.log(`[PriceAlerts] Sent to ${user.email} (price $${currentPrice.toFixed(3)} < threshold $${user.priceAlertThreshold})`);
    } catch (err) {
      console.error(`[PriceAlerts] Failed for ${user.email}:`, err);
    }
  }

  return NextResponse.json({
    ok:           true,
    currentPrice: Math.round(currentPrice * 1000) / 1000,
    sent,
    skipped,
    checkedAt:    new Date().toISOString(),
  });
}

/**
 * Personalized monthly fuel-spending digest (push).
 *
 * Friendly, month-to-date wording. Sent to native iOS (APNs) + web (OneSignal).
 * Skips users with no fill-ups this month (no empty "$0 / 0 fill-ups" sends).
 *
 * Used by:
 *  - app/api/cron/digest        (weekly cron → all active Pro users)
 *  - app/api/push/digest        (admin preview → one user)
 */

import { getFillups }            from '@/lib/fillups';
import { prisma }                from '@/lib/prisma';
import { sendApns, apnsConfigured } from '@/lib/apns';
import { sendPushNotification }  from '@/lib/oneSignal';

export interface Digest { title: string; body: string }

/**
 * Build a user's month-to-date digest. Returns null when there's no activity
 * this month (caller should skip — we never send an empty digest).
 */
export async function buildUserDigest(userId: string): Promise<Digest | null> {
  const now   = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const fillups   = await getFillups(userId);
  const thisMonth = fillups.filter((f) => f.date.startsWith(month));
  if (thisMonth.length === 0) return null; // inactive this month → skip

  const spent     = thisMonth.reduce((s, f) => s + f.totalCost, 0);
  const count     = thisMonth.length;
  const fillLabel = `${count} fill-up${count === 1 ? '' : 's'}`;
  // Read the user's monthly budget from the DB (User.monthlyFuelBudget — set in
  // Settings → Monthly Fuel Budget). The old getBudgetGoal() used an ephemeral
  // JSON file that doesn't persist on Railway, so the digest never saw it.
  const u      = await prisma.user.findUnique({ where: { id: userId }, select: { monthlyFuelBudget: true } });
  const budget = u?.monthlyFuelBudget ?? null;

  const body = budget
    ? `This month: $${spent.toFixed(2)} spent · ${Math.round((spent / budget) * 100)}% of $${budget} budget · ${fillLabel}`
    : `This month: $${spent.toFixed(2)} spent · ${fillLabel}`;

  return { title: '⛽ GasCap™ Weekly Digest', body };
}

/** Deliver a built digest to a user across native (APNs) + web (OneSignal). */
async function deliver(
  user: { id: string; iosPushToken?: string | null },
  digest: Digest,
): Promise<boolean> {
  let delivered = false;

  // Web push (OneSignal)
  try {
    const r = await sendPushNotification({
      title: digest.title, body: digest.body, url: '/', externalIds: [user.id],
    });
    if (!r.errors) delivered = true;
  } catch (e) { console.warn('[digest] OneSignal failed:', e); }

  // Native iOS (APNs)
  if (user.iosPushToken && apnsConfigured()) {
    const r = await sendApns(user.iosPushToken, digest.title, digest.body).catch(() => ({ ok: false } as { ok: boolean }));
    if (r.ok) delivered = true;
  }

  return delivered;
}

/**
 * Build + send a user's digest. Returns whether they were active this month and
 * whether any channel delivered, plus the digest text (for admin preview).
 */
export async function sendUserDigest(
  user: { id: string; iosPushToken?: string | null },
): Promise<{ active: boolean; delivered: boolean; digest?: Digest }> {
  const digest = await buildUserDigest(user.id);
  if (!digest) return { active: false, delivered: false };
  const delivered = await deliver(user, digest);
  return { active: true, delivered, digest };
}

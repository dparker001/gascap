/**
 * sendUserPush — fire one push to a single user across native iOS (APNs) and
 * web/Android (OneSignal), keyed by the GasCap user id.
 *
 * Designed to be called fire-and-forget *alongside* an email send: the email is
 * still the source of truth and reaches everyone; this push is a bonus nudge that
 * only lands for users who have the app installed AND granted notification
 * permission. Best-effort — never throws; returns whether any channel accepted it.
 *
 * Self-contained: looks up the user's iOS token by id, so callers only need the
 * userId. Mirrors the delivery pattern in lib/digest.ts.
 */

import { findById }               from '@/lib/users';
import { sendApns, apnsConfigured } from '@/lib/apns';
import { sendPushNotification }    from '@/lib/oneSignal';

export async function sendUserPush(
  userId: string,
  title: string,
  body: string,
  url = '/',
): Promise<boolean> {
  let delivered = false;

  // Web + Android (OneSignal, addressed by external id = GasCap user id)
  try {
    const r = await sendPushNotification({ title, body, url, externalIds: [userId] });
    if (!r?.errors) delivered = true;
  } catch (e) { console.warn('[userPush] OneSignal failed:', e); }

  // Native iOS (APNs)
  try {
    const user  = await findById(userId);
    const token = (user as { iosPushToken?: string | null } | undefined)?.iosPushToken;
    if (token && apnsConfigured()) {
      const r = await sendApns(token, title, body).catch(() => ({ ok: false } as { ok: boolean }));
      if (r.ok) delivered = true;
    }
  } catch (e) { console.warn('[userPush] APNs failed:', e); }

  return delivered;
}

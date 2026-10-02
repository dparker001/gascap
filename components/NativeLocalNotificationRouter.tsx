'use client';

/**
 * NativeLocalNotificationRouter — routes taps on LOCAL notifications (native
 * iOS/Android). Rental Mode return fallbacks carry extra.url =
 * "/rental-return/<id>"; tapping opens that rental. Internal paths only
 * (safeInternalPath) — never an external or protocol-relative URL.
 * Before 2026-10-02 no listener existed, so local-notification taps just
 * opened the app wherever it was.
 */
import { useEffect } from 'react';
import { detectNativePlatform } from '@/hooks/useIsNative';
import { safeInternalPath } from '@/lib/rentalReminder';

export default function NativeLocalNotificationRouter() {
  useEffect(() => {
    if (!detectNativePlatform()) return;
    let remove: (() => void) | undefined;
    (async () => {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const handle = await LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
        const url = safeInternalPath((a.notification?.extra as { url?: unknown } | undefined)?.url);
        if (url) { try { window.location.href = url; } catch { /* ignore */ } }
      });
      remove = () => { void handle.remove(); };
    })().catch(() => { /* plugin unavailable in this build */ });
    return () => remove?.();
  }, []);
  return null;
}

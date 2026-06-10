'use client';

/**
 * NativePushRegistration
 *
 * Runs only inside the native iOS (Capacitor) wrapper. On launch it requests
 * push permission, registers with APNs, and POSTs the device token to
 * /api/native/push-token so the server can send native notifications.
 *
 * The @capacitor/push-notifications plugin is dynamically imported AFTER the
 * native check, so it's never loaded/executed in the normal web bundle.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { detectNativePlatform } from '@/hooks/useIsNative';

export default function NativePushRegistration() {
  const { data: session } = useSession();
  const [token, setToken] = useState<string | null>(null);

  // Register for push once, on native iOS only.
  useEffect(() => {
    if (detectNativePlatform() !== 'ios') return;
    let cleanup: (() => void) | undefined;

    (async () => {
      const { PushNotifications } = await import('@capacitor/push-notifications');

      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== 'granted') return;

      // Listeners MUST be added before register() — iOS fires 'registration'
      // almost immediately after register(), so a later listener misses the token.
      const reg = await PushNotifications.addListener('registration', (t) => setToken(t.value));
      const err = await PushNotifications.addListener('registrationError',
        (e) => console.warn('[NativePush] registration error:', e));

      // Deep-link: when the user taps a notification that carries a `url`, navigate
      // the webview there (use a gascap.app path like "/settings" or a full URL).
      const act = await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
        const url = (a.notification?.data as { url?: string } | undefined)?.url;
        if (url) { try { window.location.href = url; } catch { /* ignore */ } }
      });

      await PushNotifications.register();
      cleanup = () => { reg.remove(); err.remove(); act.remove(); };
    })().catch((e) => console.warn('[NativePush] setup failed:', e));

    return () => cleanup?.();
  }, []);

  // POST the token whenever we have both a token and a signed-in session.
  useEffect(() => {
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!token || !userId) return;
    fetch('/api/native/push-token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    }).catch(() => { /* retry on next token/session change */ });
  }, [token, session]);

  return null;
}

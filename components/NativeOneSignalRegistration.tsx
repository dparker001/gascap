'use client';

/**
 * NativeOneSignalRegistration
 *
 * Runs only inside the native Android (Capacitor) wrapper. iOS uses direct
 * APNs registration (see NativePushRegistration.tsx) — Android has no APNs
 * equivalent, so it goes through OneSignal's native SDK instead, reusing the
 * same OneSignal account/dashboard already used for web push. Once this
 * device logs in under the GasCap user id, every existing sendPushNotification
 * call (digest, streak reminders, trial nudges, etc.) reaches it automatically
 * — no server-side changes needed.
 *
 * Requires NEXT_PUBLIC_ONESIGNAL_APP_ID (already set for web) and a Firebase
 * project connected in the OneSignal dashboard (Settings → Platforms →
 * Google Android (FCM)), plus android/app/google-services.json in the repo.
 */

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { detectNativePlatform } from '@/hooks/useIsNative';

let initialized = false;

export default function NativeOneSignalRegistration() {
  const { data: session } = useSession();

  // Initialize once, Android only.
  useEffect(() => {
    if (detectNativePlatform() !== 'android') return;
    if (initialized) return;
    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    if (!appId) return;
    initialized = true;

    (async () => {
      const { default: OneSignal } = await import('@onesignal/capacitor-plugin');
      await OneSignal.initialize(appId);
      await OneSignal.Notifications.requestPermission(true);
      // Without this, OneSignal receives the push (hence the vibration) but
      // does NOT show a visible notification while the app is in the
      // foreground — it assumes the app wants to handle display itself.
      // Always show it, same as if the app were backgrounded.
      OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event) => {
        event.getNotification().display();
      });
    })().catch((e) => {
      console.warn('[NativeOneSignal] init failed:', e);
      initialized = false; // allow retry
    });
  }, []);

  // Associate the signed-in user with their OneSignal profile — same
  // external-id pattern as OneSignalProvider.tsx (web), so a single
  // sendPushNotification({ externalIds: [userId] }) call reaches both.
  useEffect(() => {
    if (detectNativePlatform() !== 'android') return;
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId || !initialized) return;

    (async () => {
      const { default: OneSignal } = await import('@onesignal/capacitor-plugin');
      await OneSignal.login(userId);
    })().catch(() => {});
  }, [session]);

  return null;
}

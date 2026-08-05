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

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { detectNativePlatform } from '@/hooks/useIsNative';

// TEMP DEBUG — remove once Android push registration is confirmed working.
// Shows the actual init/login status on-screen so it can be read directly
// off the device without needing a USB-debugging session.
const SHOW_DEBUG_BANNER = true;

let initialized = false;

export default function NativeOneSignalRegistration() {
  const { data: session } = useSession();
  const [debugStatus, setDebugStatus] = useState('idle');

  // Initialize once, Android only.
  useEffect(() => {
    if (detectNativePlatform() !== 'android') return;
    if (initialized) { setDebugStatus('already initialized'); return; }
    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    if (!appId) { setDebugStatus('FAILED: no NEXT_PUBLIC_ONESIGNAL_APP_ID'); return; }
    initialized = true;
    setDebugStatus('initializing...');

    (async () => {
      const { default: OneSignal } = await import('@onesignal/capacitor-plugin');
      setDebugStatus('plugin loaded, calling initialize()...');
      await OneSignal.initialize(appId);
      setDebugStatus('initialized, requesting permission...');
      const granted = await OneSignal.Notifications.requestPermission(true);
      setDebugStatus(`ready — permission granted: ${granted}`);
    })().catch((e) => {
      console.warn('[NativeOneSignal] init failed:', e);
      setDebugStatus(`FAILED: ${e?.message ?? String(e)}`);
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
      setDebugStatus((s) => `${s} | logged in as ${userId.slice(0, 8)}...`);
    })().catch((e) => {
      setDebugStatus((s) => `${s} | LOGIN FAILED: ${e?.message ?? String(e)}`);
    });
  }, [session]);

  if (SHOW_DEBUG_BANNER && detectNativePlatform() === 'android') {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 70,
          left: 8,
          right: 8,
          zIndex: 99999,
          background: 'rgba(0,0,0,0.85)',
          color: debugStatus.startsWith('FAILED') || debugStatus.includes('FAILED') ? '#ff6b6b' : '#7CFC00',
          fontSize: 10,
          padding: '6px 8px',
          borderRadius: 8,
          fontFamily: 'monospace',
          wordBreak: 'break-word',
        }}
      >
        OneSignal: {debugStatus}
      </div>
    );
  }

  return null;
}

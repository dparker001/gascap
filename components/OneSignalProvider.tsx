'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import OneSignal from 'react-onesignal';

let initialized = false;

export default function OneSignalProvider() {
  const { data: session } = useSession();

  // Initialize OneSignal once
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    if (!appId || initialized) return;
    initialized = true;

    OneSignal.init({
      appId,
      // Don't show the native browser bell — we have our own toggle
      // Allow localhost during development
      allowLocalhostAsSecureOrigin: process.env.NODE_ENV === 'development',
    }).catch((err) => {
      console.warn('[OneSignal] Init error:', err);
      initialized = false; // allow retry
    });
  }, []);

  // Associate the signed-in user with their OneSignal profile.
  // This lets us target individual users by external ID for
  // digest and fill-up reminder notifications.
  useEffect(() => {
    const userId = (session?.user as { id?: string })?.id ?? session?.user?.email ?? '';
    if (!userId || !initialized) return;

    OneSignal.login(userId).catch(() => {});
  }, [session]);

  return null;
}

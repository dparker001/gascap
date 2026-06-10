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
 *
 * NOTE: contains TEMPORARY dbg() breadcrumbs (→ /api/native/push-debug) while we
 * verify on-device registration. Remove the dbg calls once confirmed.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { detectNativePlatform } from '@/hooks/useIsNative';

function dbg(stage: string, detail = '') {
  try {
    fetch('/api/native/push-debug', {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      JSON.stringify({ stage, detail }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}

export default function NativePushRegistration() {
  const { data: session } = useSession();
  const [token, setToken] = useState<string | null>(null);

  // Register for push once, on native iOS only.
  useEffect(() => {
    const plat = detectNativePlatform();
    if (plat !== 'ios') return;
    let cleanup: (() => void) | undefined;

    (async () => {
      // Report the running native build number so we know exactly which build is live.
      try {
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        dbg('mounted', `platform=${plat} build=${info.build} ver=${info.version}`);
      } catch { dbg('mounted', `platform=${plat} build=?`); }

      const { PushNotifications } = await import('@capacitor/push-notifications');

      let perm = await PushNotifications.checkPermissions();
      dbg('perm-check', perm.receive);
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
        perm = await PushNotifications.requestPermissions();
        dbg('perm-request', perm.receive);
      }
      if (perm.receive !== 'granted') { dbg('not-granted', perm.receive); return; }

      // Add the listeners BEFORE register() — iOS fires 'registration' almost
      // immediately after register(), so a listener added afterwards misses the token.
      const reg = await PushNotifications.addListener('registration', (t) => {
        dbg('token', `len=${t.value.length}`);
        setToken(t.value);
      });
      const err = await PushNotifications.addListener('registrationError',
        (e) => dbg('reg-error', JSON.stringify(e).slice(0, 200)));
      await PushNotifications.register();
      dbg('register-called');
      cleanup = () => { reg.remove(); err.remove(); };
    })().catch((e) => dbg('setup-failed', String(e).slice(0, 200)));

    return () => cleanup?.();
  }, []);

  // POST the token whenever we have both a token and a signed-in session.
  useEffect(() => {
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!token) return;
    if (!userId) { dbg('have-token-no-session'); return; }
    dbg('posting', `uid=${userId.slice(0, 6)}`);
    fetch('/api/native/push-token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    })
      .then((r) => dbg('posted', `status=${r.status}`))
      .catch((e) => dbg('post-failed', String(e).slice(0, 120)));
  }, [token, session]);

  return null;
}

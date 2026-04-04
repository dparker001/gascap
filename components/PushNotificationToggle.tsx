'use client';

import { useSession }           from 'next-auth/react';
import { useEffect, useState }  from 'react';

type PermState = 'default' | 'granted' | 'denied' | 'unsupported';

export default function PushNotificationToggle() {
  const { data: session } = useSession();
  const [perm,     setPerm]    = useState<PermState>('unsupported');
  const [subbed,   setSubbed]  = useState(false);
  const [loading,  setLoading] = useState(false);
  const [subError, setSubError] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return;
    setPerm(Notification.permission as PermState);
    // Check if already subscribed
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription()
    ).then((sub) => {
      setSubbed(!!sub);
    }).catch(() => {});
  }, []);

  if (!session) return null;

  // Browser / device doesn't support push — show install-as-PWA hint
  if (perm === 'unsupported') {
    return (
      <div className="flex items-start gap-2.5 bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-200">
        <span className="text-base mt-0.5">🔔</span>
        <div>
          <p className="text-xs font-semibold text-slate-600">Push notifications</p>
          <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
            Install GasCap™ on your home screen to enable push notifications (gas price alerts, weekly digest &amp; more).{' '}
            <span className="font-medium">iPhone:</span> Share → Add to Home Screen.{' '}
            <span className="font-medium">Android:</span> Menu → Install App.
          </p>
        </div>
      </div>
    );
  }

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = window.atob(base64);
    return Uint8Array.from(Array.from(raw).map((c) => c.charCodeAt(0)));
  }

  async function handleEnable() {
    setLoading(true);
    setSubError('');
    try {
      if (!vapidKey) {
        setSubError('Push notifications are not configured yet. Try again soon.');
        return;
      }

      const permission = await Notification.requestPermission();
      setPerm(permission as PermState);
      if (permission !== 'granted') return;

      // serviceWorker.ready can hang forever if the SW never activates —
      // race it against a 10-second timeout so the button never gets stuck.
      const swReady = navigator.serviceWorker.ready;
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Service worker took too long to activate. Try refreshing the page.')), 10_000),
      );
      const reg = await Promise.race([swReady, timeout]);

      // Pass the key as Uint8Array directly — passing .buffer (ArrayBuffer)
      // causes silent failures in Chrome and some Safari versions.
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const res = await fetch('/api/push/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(sub.toJSON()),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Server error ${res.status}`);
      }

      setSubbed(true);
    } catch (err) {
      console.error('Push subscribe error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setSubError(`Could not enable notifications: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable() {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await fetch('/api/push/subscribe', { method: 'DELETE' });
      setSubbed(false);
      setPerm('default');
    } finally {
      setLoading(false);
    }
  }

  if (perm === 'denied') {
    return (
      <div className="flex items-start gap-2 bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-200">
        <span className="text-base mt-0.5">🔕</span>
        <div>
          <p className="text-xs font-semibold text-slate-600">Push notifications blocked</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Enable them in your browser or device settings to receive gas price alerts and updates.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-3 border border-slate-200">
        <div className="flex items-start gap-2.5">
          <span className="text-lg">{subbed ? '🔔' : '🔕'}</span>
          <div>
            <p className="text-sm font-bold text-slate-700">Push Notifications</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {subbed
                ? 'Enabled — you\'ll receive gas price alerts, weekly digests & updates.'
                : 'Enable gas price alerts, weekly digests & app updates.'}
            </p>
          </div>
        </div>
        <button
          onClick={subbed ? handleDisable : handleEnable}
          disabled={loading}
          className={[
            'ml-3 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50',
            subbed
              ? 'bg-slate-200 text-slate-600 hover:bg-red-100 hover:text-red-600'
              : 'bg-amber-500 text-white hover:bg-amber-400',
          ].join(' ')}
        >
          {loading ? '…' : subbed ? 'Turn off' : 'Enable'}
        </button>
      </div>
      {subError && (
        <p className="text-[10px] text-red-500 mt-1.5 px-1 leading-relaxed">{subError}</p>
      )}
    </div>
  );
}

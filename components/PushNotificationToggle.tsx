'use client';

import { useSession }           from 'next-auth/react';
import { useEffect, useState }  from 'react';

type PermState = 'default' | 'granted' | 'denied' | 'unsupported';

export default function PushNotificationToggle() {
  const { data: session } = useSession();
  const [perm,    setPerm]    = useState<PermState>('unsupported');
  const [subbed,  setSubbed]  = useState(false);
  const [loading, setLoading] = useState(false);

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

  if (!session || perm === 'unsupported') return null;

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = window.atob(base64);
    return Uint8Array.from(Array.from(raw).map((c) => c.charCodeAt(0)));
  }

  async function handleEnable() {
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      setPerm(permission as PermState);
      if (permission !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });

      await fetch('/api/push/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(sub.toJSON()),
      });
      setSubbed(true);
    } catch (err) {
      console.error('Push subscribe error:', err);
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
          <p className="text-[10px] text-slate-400 mt-0.5">Enable them in your browser settings to receive weekly digests.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-3 border border-slate-200">
      <div className="flex items-start gap-2.5">
        <span className="text-lg">{subbed ? '🔔' : '🔕'}</span>
        <div>
          <p className="text-sm font-bold text-slate-700">Weekly Digest</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {subbed
              ? 'You\'ll get a weekly summary of your fuel spending.'
              : 'Get a weekly summary of fuel spending & MPG.'}
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
  );
}

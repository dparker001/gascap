'use client';

import { useSession }          from 'next-auth/react';
import { useEffect, useState } from 'react';
import OneSignal               from 'react-onesignal';

export default function PushNotificationToggle() {
  const { data: session } = useSession();
  const [supported, setSupported] = useState(true);
  const [subbed,    setSubbed]    = useState(false);
  const [denied,    setDenied]    = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setSupported(false);
      return;
    }

    // Read current state from OneSignal
    setDenied(Notification.permission === 'denied');
    setSubbed(OneSignal.User.PushSubscription.optedIn ?? false);

    // Keep UI in sync when OneSignal subscription state changes
    const handler = () => {
      setSubbed(OneSignal.User.PushSubscription.optedIn ?? false);
      setDenied(Notification.permission === 'denied');
    };
    OneSignal.User.PushSubscription.addEventListener('change', handler);
    return () => {
      OneSignal.User.PushSubscription.removeEventListener('change', handler);
    };
  }, []);

  if (!session) return null;

  // Device / browser doesn't support push — show home screen install hint
  if (!supported) {
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

  if (denied) {
    return (
      <div className="flex items-start gap-2 bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-200">
        <span className="text-base mt-0.5">🔕</span>
        <div>
          <p className="text-xs font-semibold text-slate-600">Push notifications blocked</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Enable them in your browser or device settings to receive gas price alerts and updates.
          </p>
        </div>
      </div>
    );
  }

  async function handleEnable() {
    setLoading(true);
    setError('');
    try {
      await OneSignal.User.PushSubscription.optIn();
      setSubbed(OneSignal.User.PushSubscription.optedIn ?? false);
      setDenied(Notification.permission === 'denied');
    } catch (err) {
      console.error('[Push] Subscribe error:', err);
      setError('Could not enable notifications — please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable() {
    setLoading(true);
    try {
      await OneSignal.User.PushSubscription.optOut();
      setSubbed(false);
    } finally {
      setLoading(false);
    }
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
                ? "Enabled — you'll receive gas price alerts, weekly digests & updates."
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
      {error && (
        <p className="text-[10px] text-red-500 mt-1.5 px-1 leading-relaxed">{error}</p>
      )}
    </div>
  );
}

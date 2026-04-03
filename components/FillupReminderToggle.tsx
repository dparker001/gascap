'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

const OPTIONS = [
  { days: 0,  label: 'Off',        desc: 'No reminders' },
  { days: 7,  label: 'Weekly',     desc: 'Remind me if I haven\'t filled up in 7 days' },
  { days: 14, label: 'Bi-weekly',  desc: 'Remind me if I haven\'t filled up in 14 days' },
];

export default function FillupReminderToggle() {
  const { data: session } = useSession();
  const [days,    setDays]    = useState<number>(0);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetch('/api/push/fillup-reminder', { credentials: 'include' })
      .then(r => r.json())
      .then((d: { days?: number }) => setDays(d.days ?? 0))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  async function handleChange(val: number) {
    setDays(val);
    setSaving(true);
    setSaved(false);
    try {
      await fetch('/api/push/fillup-reminder', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ days: val }),
        credentials: 'include',
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (!session || loading) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-black text-slate-700">Fill-Up Reminders</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Get a push notification when you&apos;re overdue for a fill-up
          </p>
        </div>
        {saved && (
          <span className="text-[11px] text-green-600 font-semibold">✓ Saved</span>
        )}
      </div>

      <div className="space-y-2">
        {OPTIONS.map(opt => (
          <button
            key={opt.days}
            onClick={() => handleChange(opt.days)}
            disabled={saving}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all disabled:opacity-50 ${
              days === opt.days
                ? 'bg-amber-50 border-amber-300'
                : 'bg-slate-50 border-slate-200 hover:border-slate-300'
            }`}
          >
            <div>
              <p className={`text-sm font-bold ${days === opt.days ? 'text-amber-700' : 'text-slate-600'}`}>
                {opt.label}
              </p>
              <p className="text-[11px] text-slate-400">{opt.desc}</p>
            </div>
            {days === opt.days && (
              <span className="text-amber-500 text-base">✓</span>
            )}
          </button>
        ))}
      </div>

      {days > 0 && (
        <p className="text-[11px] text-slate-400 leading-relaxed">
          📱 Requires push notifications to be enabled. You&apos;ll only receive one reminder per interval.
        </p>
      )}
    </div>
  );
}

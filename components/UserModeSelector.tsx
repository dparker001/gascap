'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';

const MODES = [
  {
    id:    'personal',
    icon:  '🚗',
    title: 'Personal Driver',
    body:  'Calculate fuel costs, find nearby prices, and know before you go.',
  },
  {
    id:    'gig',
    icon:  '📦',
    title: 'Gig Driver',
    body:  'Track fuel, mileage, and driving costs so you can keep more of what you earn.',
  },
  {
    id:    'rental',
    icon:  '🏢',
    title: 'Rental Car',
    body:  'Estimate exactly how much gas you need before returning your rental.',
  },
  {
    id:    'fleet',
    icon:  '🚚',
    title: 'Business / Fleet',
    body:  'Track fuel usage and vehicle costs across business driving.',
  },
] as const;

type ModeId = typeof MODES[number]['id'];

interface Props {
  initialMode?: ModeId;
  onComplete: (mode: ModeId) => void;
}

export default function UserModeSelector({ initialMode, onComplete }: Props) {
  const { update } = useSession();
  const [selected, setSelected] = useState<ModeId | null>(
    MODES.some((m) => m.id === initialMode) ? (initialMode ?? null) : null,
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch('/api/user/profile', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userMode: selected }),
      });
      await update(); // refresh JWT so session.user.userMode is populated
      window.dispatchEvent(new CustomEvent('gc:user-mode', { detail: { mode: selected } }));
      onComplete(selected);
    } catch {
      setSaving(false);
    }
  }

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How will you use GasCap?"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-brand-orange px-6 pt-6 pb-5 text-center">
          <p className="text-[11px] font-bold tracking-widest text-white/70 uppercase mb-1">Welcome to GasCap™</p>
          <h2 className="text-xl font-black text-white leading-tight">How will you use GasCap?</h2>
          <p className="text-[12px] text-white/80 mt-1">We'll personalize your experience.</p>
        </div>

        {/* Mode cards */}
        <div className="p-4 grid grid-cols-2 gap-3">
          {MODES.map((m) => {
            const active = selected === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setSelected(m.id)}
                className={[
                  'flex flex-col items-start gap-1.5 rounded-xl border-2 p-3 text-left transition-all',
                  active
                    ? 'border-brand-orange bg-orange-50 dark:bg-orange-950/30'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300',
                ].join(' ')}
              >
                <span className="text-2xl leading-none">{m.icon}</span>
                <span className={`text-[13px] font-black leading-snug ${active ? 'text-orange-700 dark:text-orange-300' : 'text-slate-800 dark:text-slate-100'}`}>
                  {m.title}
                </span>
                <span className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                  {m.body}
                </span>
                {active && (
                  <span className="mt-1 text-[10px] font-black text-orange-600 dark:text-orange-400 uppercase tracking-wide">
                    ✓ Selected
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 pb-5 flex flex-col gap-2">
          <button
            onClick={handleSave}
            disabled={!selected || saving}
            className="w-full py-3 rounded-xl font-black text-sm bg-brand-orange text-white
                       disabled:opacity-40 disabled:cursor-not-allowed
                       hover:bg-orange-600 active:scale-[0.98] transition-all"
          >
            {saving ? 'Saving…' : 'Get Started'}
          </button>
          <p className="text-center text-[10px] text-slate-400">You can change this anytime in Settings.</p>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}

'use client';

/**
 * WhatsNewModal
 *
 * Shows a one-time changelog modal for the current signed-in user when
 * CURRENT_VERSION (lib/whatsNew.ts) is newer than what they've already seen
 * (tracked in localStorage). Covers the gap where both app stores default
 * to silent background updates — most users never see a "what changed"
 * message otherwise.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { CURRENT_VERSION, WHATS_NEW } from '@/lib/whatsNew';

const STORAGE_KEY = 'gc_whatsnew_seen_version';

export default function WhatsNewModal() {
  const { data: session } = useSession();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!session) return;
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (seen !== CURRENT_VERSION) setShow(true);
    } catch { /* localStorage unavailable */ }
  }, [session]);

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, CURRENT_VERSION); } catch { /* ignore */ }
    setShow(false);
  }

  if (!show) return null;
  const entry = WHATS_NEW.find((e) => e.version === CURRENT_VERSION) ?? WHATS_NEW[0];
  if (!entry) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50 px-4 pb-4 sm:pb-0">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6">
        <p className="text-[10px] font-bold tracking-widest text-amber-500 uppercase mb-1">
          What&apos;s New · {entry.date}
        </p>
        <h2 className="text-lg font-black text-slate-900 mb-3 leading-snug">{entry.title}</h2>
        <ul className="space-y-2 mb-5">
          {entry.items.map((item) => (
            <li key={item} className="flex items-start gap-2 text-[13px] text-slate-600 leading-relaxed">
              <span className="text-emerald-500 font-bold mt-0.5 flex-shrink-0">✓</span>
              {item}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={dismiss}
          className="w-full py-3 rounded-xl bg-[#005F4A] text-white font-black text-sm
                     hover:opacity-90 active:scale-[0.98] transition-all"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

'use client';

/**
 * GiveawayEntryToast
 * Shown once per day when a Pro/Fleet user earns their daily giveaway entry.
 * Reads from /api/user/giveaway-entries; persists "shown today" in localStorage.
 */

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';

const STORAGE_KEY = 'gascap_entry_toast';
const SHOW_MS     = 5000;   // visible duration
const EXIT_MS     = 350;    // must match .animate-toast-exit duration

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[parseInt(mo, 10) - 1]} ${y}`;
}

export default function GiveawayEntryToast() {
  const { data: session } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!session) return;

    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(STORAGE_KEY) === today) return;

    fetch('/api/user/giveaway-entries', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { month: string; entryCount: number; eligible: boolean }) => {
        if (!d.eligible || d.entryCount === 0) return;

        const n   = d.entryCount;
        const mon = fmtMonth(d.month);
        setMessage(
          `⚡ Entry earned! You have ${n} ${n === 1 ? 'entry' : 'entries'} in the ${mon} drawing.`,
        );
        localStorage.setItem(STORAGE_KEY, today);
      })
      .catch(() => {});
  }, [session]);

  // Auto-dismiss
  useEffect(() => {
    if (!message) return;
    const dismissTimer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => setMessage(null), EXIT_MS);
    }, SHOW_MS);
    return () => clearTimeout(dismissTimer);
  }, [message]);

  function dismiss() {
    setExiting(true);
    setTimeout(() => setMessage(null), EXIT_MS);
  }

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={dismiss}
      className={[
        // Position — fixed at bottom-center, above any nav bar
        'fixed bottom-8 left-1/2 z-[9999]',
        // Layout
        'flex items-center gap-3',
        // Size / shape
        'max-w-[90vw] w-max rounded-2xl px-5 py-3.5',
        // Colors
        'bg-navy-700 text-white shadow-2xl',
        // Type
        'text-sm font-semibold leading-snug',
        // Cursor hint
        'cursor-pointer select-none',
        // Entrance / exit
        exiting ? 'animate-toast-exit' : 'animate-toast-enter',
      ].join(' ')}
    >
      <span className="flex-1">{message}</span>
      <span
        className="flex-shrink-0 text-white/40 hover:text-white/80 transition-colors text-xs ml-1"
        aria-hidden="true"
      >
        ✕
      </span>
    </div>
  );
}

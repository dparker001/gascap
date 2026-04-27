'use client';

/**
 * AnnouncementToast
 *
 * Fetches active announcements from /api/announcements and shows them
 * as dismissible banners, one at a time (newest-first).
 *
 * Dismissal is stored in sessionStorage so each toast re-appears if the
 * user opens a new tab/session but not on every page interaction within
 * the same browser session.
 *
 * Visible only to signed-in users whose plan matches targetPlans.
 * Pass targetPlans: [] to show to all signed-in users.
 */

import { useSession }   from 'next-auth/react';
import Link             from 'next/link';
import { useEffect, useState } from 'react';
import type { Announcement } from '@/app/api/announcements/route';

const DISMISS_PREFIX = 'gc_ann_dismissed_';

// Accent colours for the banner — cycles through a small palette
const PALETTE = [
  { bg: 'bg-teal-50',   border: 'border-teal-200',  title: 'text-teal-800',  body: 'text-teal-700',  btn: 'bg-teal-600 hover:bg-teal-500',   x: 'text-teal-300 hover:text-teal-500',   dismiss: 'text-teal-600' },
  { bg: 'bg-indigo-50', border: 'border-indigo-200', title: 'text-indigo-800',body: 'text-indigo-700',btn: 'bg-indigo-600 hover:bg-indigo-500', x: 'text-indigo-300 hover:text-indigo-500',dismiss: 'text-indigo-600' },
  { bg: 'bg-amber-50',  border: 'border-amber-200',  title: 'text-amber-800', body: 'text-amber-700', btn: 'bg-amber-500 hover:bg-amber-400',   x: 'text-amber-300 hover:text-amber-500',  dismiss: 'text-amber-600' },
  { bg: 'bg-green-50',  border: 'border-green-200',  title: 'text-green-800', body: 'text-green-700', btn: 'bg-green-600 hover:bg-green-500',   x: 'text-green-300 hover:text-green-500',  dismiss: 'text-green-600' },
];

export default function AnnouncementToast() {
  const { data: session, status } = useSession();
  const [toasts, setToasts]       = useState<Announcement[]>([]);
  const [ready,  setReady]        = useState(false);

  // Fetch announcements once session is known
  useEffect(() => {
    if (status === 'loading') return;

    fetch('/api/announcements')
      .then((r) => r.json())
      .then((all: Announcement[]) => {
        const userPlan = (session?.user as { plan?: string })?.plan ?? 'free';

        const filtered = all.filter((a) => {
          // Plan check
          if (a.targetPlans.length > 0 && !a.targetPlans.includes(userPlan)) return false;
          // Already dismissed this session?
          if (typeof window !== 'undefined') {
            if (sessionStorage.getItem(DISMISS_PREFIX + a.id) === '1') return false;
          }
          return true;
        });

        setToasts(filtered);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, [status, session]);

  function dismiss(id: string) {
    sessionStorage.setItem(DISMISS_PREFIX + id, '1');
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  if (!ready || toasts.length === 0) return null;

  // Show only the first un-dismissed toast
  const toast = toasts[0];
  const color = PALETTE[Math.abs(hashCode(toast.id)) % PALETTE.length];

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`mx-4 mt-3 mb-1 max-w-lg mx-auto rounded-2xl border px-4 py-3
                  flex items-start gap-3 shadow-sm
                  ${color.bg} ${color.border}`}
    >
      {/* Emoji */}
      <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">
        {toast.emoji}
      </span>

      {/* Copy */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-black leading-snug ${color.title}`}>
          {toast.title}
        </p>
        <p className={`text-[11px] mt-0.5 leading-relaxed ${color.body}`}>
          {toast.message}
        </p>

        <div className="flex items-center gap-3 mt-2">
          {toast.link && (
            <Link
              href={toast.link}
              className={`px-3 py-1.5 rounded-xl text-xs font-black text-white
                          transition-colors whitespace-nowrap ${color.btn}`}
            >
              {toast.linkText ?? 'Learn more'} →
            </Link>
          )}

          {toast.dismissible && (
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className={`text-[11px] font-semibold hover:underline ${color.dismiss}`}
            >
              Got it
            </button>
          )}
        </div>
      </div>

      {/* Close × */}
      {toast.dismissible && (
        <button
          type="button"
          onClick={() => dismiss(toast.id)}
          aria-label="Dismiss"
          className={`flex-shrink-0 text-lg leading-none mt-0.5 transition-colors ${color.x}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** Simple deterministic hash so the same announcement always gets the same colour */
function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

'use client';

/**
 * MigrationNotice — one-time dismissible banner for the May 12 2026 database
 * migration (JSON → PostgreSQL).  Shows once to signed-in users who may have
 * had fill-ups before the migration, then disappears permanently.
 */

import { useState, useEffect } from 'react';
import { useSession }          from 'next-auth/react';

const STORAGE_KEY = 'gc_db_migration_notice_v1';

export default function MigrationNotice() {
  const { data: session } = useSession();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!session) return;
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch { /* localStorage unavailable */ }
  }, [session]);

  function dismiss() {
    setVisible(false);
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-20 left-0 right-0 z-40 flex justify-center px-4 pointer-events-none">
      <div
        className="pointer-events-auto w-full max-w-sm rounded-2xl border border-amber-200
                   bg-amber-50 shadow-lg px-4 py-3 flex items-start gap-3 animate-slide-up"
      >
        <span className="text-lg flex-shrink-0 mt-0.5">🗄️</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black text-amber-800 leading-snug">Database upgrade</p>
          <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
            We migrated to a permanent database on May 12. Fill-ups logged before that
            date may not appear — we're sorry for the inconvenience.
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex-shrink-0 text-amber-400 hover:text-amber-700 transition-colors mt-0.5"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" className="w-4 h-4" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

'use client';

/**
 * Soft anti-abuse signal — renders nothing unless an account has an
 * unusually high number of distinct devices active in the last 30 days.
 * Purely informational: no login is ever blocked, no session is ever
 * evicted. See lib/deviceSessions.ts.
 */
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';

const THRESHOLD = 5;

export default function DeviceCountNotice() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!session?.user) return;
    fetch('/api/activity')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { stats?: { activeDeviceCount?: number } } | null) => {
        if (d?.stats?.activeDeviceCount) setCount(d.stats.activeDeviceCount);
      })
      .catch(() => {});
  }, [session]);

  if (count < THRESHOLD) return null;

  return (
    <a
      href="/contact"
      className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5
                 hover:bg-amber-100 transition-colors group"
    >
      <span className="text-base flex-shrink-0" aria-hidden="true">📱</span>
      <div>
        <p className="text-xs font-semibold text-amber-800 group-hover:text-amber-900">
          {t.settings.manyDevicesTitle(count)}
        </p>
        <p className="text-[11px] text-amber-600 mt-0.5">
          {t.settings.manyDevicesSub}
        </p>
      </div>
    </a>
  );
}

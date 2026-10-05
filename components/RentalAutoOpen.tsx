'use client';

/**
 * Mounted once in the root layout. Renders nothing. When the renter has
 * switched on "open my rental at pickup time" (device-local, off by default)
 * it checks — on a cold start and on a resume after a real break, and only
 * from the home route — whether exactly one rental is at pickup, and if so
 * opens it once. All the rules live in lib/rentalAutoOpen.ts.
 */
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { RentalSession } from '@/lib/rentalSessions';
import { rentalEventInstant } from '@/lib/rentalCalculations';
import { lifecycleOf } from '@/lib/rentalPresentation';
import {
  AUTO_OPEN_QUERY, AUTO_OPEN_ROUTE, decideAutoOpen, hasAutoOpenOnceFlag, isAutoOpenEnabled, setAutoOpenOnceFlag,
} from '@/lib/rentalAutoOpen';

function isTyping(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable === true;
}

export default function RentalAutoOpen() {
  const { status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const hiddenAt = useRef<number | null>(null);
  const coldStartDone = useRef(false);
  const checking = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated') return;

    async function check(trigger: 'cold_start' | 'resume', backgroundedMs: number) {
      // Cheap exits first: no network unless it could actually open.
      if (checking.current || !isAutoOpenEnabled() || window.location.pathname !== AUTO_OPEN_ROUTE || pathname !== AUTO_OPEN_ROUTE) return;
      checking.current = true;
      try {
        const res = await fetch('/api/rental-sessions?status=active');
        if (!res.ok) return;
        const { sessions = [] } = await res.json() as { sessions?: RentalSession[] };
        const now = Date.now();
        const decision = decideAutoOpen({
          enabled: true, pathname: window.location.pathname, typing: isTyping(), trigger, backgroundedMs,
          rentals: sessions.map((s) => ({
            id: s.id, lifecycle: lifecycleOf(s, now),
            pickupKey: rentalEventInstant(s.pickupDateTimeUtc, s.pickupDateTime) ?? '',
          })),
          hasOnceFlag: hasAutoOpenOnceFlag,
        });
        if (decision.action !== 'open') return;
        setAutoOpenOnceFlag(decision.onceKey);
        router.push(`/rental-return/${decision.rentalId}?${AUTO_OPEN_QUERY}`);
      } catch { /* a failed check never opens anything */ } finally { checking.current = false; }
    }

    if (!coldStartDone.current) { coldStartDone.current = true; void check('cold_start', 0); }

    function onVisibility() {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return; }
      const away = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current;
      hiddenAt.current = null;
      void check('resume', away);
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pathname]);

  return null;
}

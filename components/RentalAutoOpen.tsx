'use client';

/**
 * Mounted once in the root layout. Renders nothing. When the signed-in renter
 * has switched on "open my rental at pickup time" (device-local, PER ACCOUNT,
 * off by default) it checks — on a cold start and on a resume after a real
 * break, and only from the home route — whether exactly one rental is at
 * pickup, and if so opens it once. The rules live in lib/rentalAutoOpen.ts.
 *
 * The check is asynchronous (it fetches the renter's open rentals), so a
 * result can arrive after the world moved on. Every check carries a
 * generation number and an AbortController; they are invalidated on logout,
 * account change, navigation and unmount, and canNavigateAfterCheck()
 * re-verifies the account, route, typing state and the setting itself right
 * before navigating. A stale check does nothing.
 */
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { RentalSession } from '@/lib/rentalSessions';
import { rentalEventInstant } from '@/lib/rentalCalculations';
import { lifecycleOf } from '@/lib/rentalPresentation';
import {
  AUTO_OPEN_QUERY, AUTO_OPEN_ROUTE, canNavigateAfterCheck, decideAutoOpen, hasAutoOpenOnceFlag, isAutoOpenEnabled, setAutoOpenOnceFlag,
} from '@/lib/rentalAutoOpen';

function isTyping(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable === true;
}

export default function RentalAutoOpen() {
  const { status, data } = useSession();
  const userId = (data?.user as { id?: string } | undefined)?.id ?? null;
  const pathname = usePathname();
  const router = useRouter();
  const hiddenAt = useRef<number | null>(null);
  const coldStartFor = useRef<string | null>(null);   // the account whose cold start was already checked
  const generation = useRef(0);
  const liveUserId = useRef<string | null>(null);
  liveUserId.current = status === 'authenticated' ? userId : null;

  useEffect(() => {
    if (status !== 'authenticated' || !userId) return;
    const myUserId = userId;
    const myGeneration = ++generation.current;
    const abort = new AbortController();

    async function check(trigger: 'cold_start' | 'resume', backgroundedMs: number) {
      // Cheap exits first: no network unless it could actually open.
      if (!isAutoOpenEnabled(myUserId) || window.location.pathname !== AUTO_OPEN_ROUTE || pathname !== AUTO_OPEN_ROUTE) return;
      try {
        const res = await fetch('/api/rental-sessions?status=active', { signal: abort.signal });
        if (!res.ok) return;
        const { sessions = [] } = await res.json() as { sessions?: RentalSession[] };
        const now = Date.now();
        const decision = decideAutoOpen({
          userId: myUserId, enabled: isAutoOpenEnabled(myUserId), pathname: window.location.pathname,
          typing: isTyping(), trigger, backgroundedMs,
          rentals: sessions.map((s) => ({
            id: s.id, lifecycle: lifecycleOf(s, now),
            pickupKey: rentalEventInstant(s.pickupDateTimeUtc, s.pickupDateTime) ?? '',
          })),
          hasOnceFlag: hasAutoOpenOnceFlag,
        });
        if (decision.action !== 'open') return;
        // Last gate — everything that was true when the check began must STILL be true.
        if (!canNavigateAfterCheck({
          requestedUserId: myUserId, currentUserId: liveUserId.current,
          requestedGeneration: myGeneration, currentGeneration: generation.current,
          aborted: abort.signal.aborted, currentPathname: window.location.pathname,
          typing: isTyping(), enabledNow: isAutoOpenEnabled(myUserId),
        })) return;
        setAutoOpenOnceFlag(decision.onceKey);
        router.push(`/rental-return/${decision.rentalId}?${AUTO_OPEN_QUERY}`);
      } catch { /* aborted or failed: a failed check never opens anything */ }
    }

    // A cold start is checked once per account per page load (a different
    // account signing in on the same page load gets its own).
    if (coldStartFor.current !== myUserId) { coldStartFor.current = myUserId; void check('cold_start', 0); }

    function onVisibility() {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return; }
      const away = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current;
      hiddenAt.current = null;
      void check('resume', away);
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      // Logout, account change, route change or unmount: anything in flight is now stale.
      generation.current += 1;
      abort.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, userId, pathname]);

  return null;
}

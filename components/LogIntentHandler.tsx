'use client';

/**
 * P1-A — handles the `/?log=1` deep link sent by the first-fill-up nudge
 * (email + push). For a signed-in user it:
 *   1. strips `log=1` from the address bar (other params/hash preserved) so
 *      the intent cannot be re-applied on reload, back or re-render;
 *   2. records a one-shot intent (lib/logIntent.ts);
 *   3. takes the user to the fill-up logger: on the native shell it switches
 *      to the Tools tab; ToolsPanel then selects its Log tab and
 *      ManualFillupLogger consumes the intent once, opens itself and scrolls
 *      itself into view (only the visible instance acts — the page renders a
 *      mobile and a desktop copy).
 * Guests are left alone (the param stays; the existing auth flow applies).
 * No redirect is issued, so there is nothing to loop.
 */
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useIsNative } from '@/hooks/useIsNative';
import { hasLogIntent, requestLogIntent, stripLogIntent } from '@/lib/logIntent';

export default function LogIntentHandler() {
  const sp = useSearchParams();
  const { status } = useSession();
  const isNative = useIsNative();
  const wantsLog = sp.get('log') === '1';

  useEffect(() => {
    if (status !== 'authenticated' || !wantsLog) return;

    // Deferred one tick so sibling shells (NativeAppShell, ToolsPanel) have
    // registered their listeners. Cleanup cancels a pending run, and the
    // URL strip below happens inside the timer, so a StrictMode double-invoke
    // still handles the intent exactly once.
    const timer = window.setTimeout(() => {
      if (!hasLogIntent(window.location.search)) return;   // already handled
      const next = stripLogIntent(window.location.search);
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);

      if (isNative) {
        window.dispatchEvent(new CustomEvent('gc:switch-tab', { detail: { tab: 'tools' } }));
      }
      requestLogIntent();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [status, wantsLog, isNative]);

  return null;
}

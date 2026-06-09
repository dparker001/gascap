'use client';

/**
 * ScrollRestore — returns the user to where they left off after a full page
 * (re)load. The native iOS/Android wrappers (and PWAs) reload the page when the
 * OS reclaims the webview's memory on resume, which otherwise dumps you at the top.
 *
 * Behaviour:
 *  - Saves window.scrollY per-path to sessionStorage (throttled + on hide).
 *  - Restores the saved position ONLY on the first mount (a real page load/reload),
 *    not on client-side navigations — Next.js already handles nav scroll, and we
 *    don't want to fight it.
 *  - Skips restore when the URL has a #hash (let the browser scroll to the anchor).
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const KEY = (path: string) => `gc_scroll:${path}`;

export default function ScrollRestore() {
  const pathname = usePathname();
  const firstRun = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = KEY(pathname);

    // Restore only on the very first mount (page load / app-resume reload),
    // and only if we're not targeting an anchor.
    if (firstRun.current) {
      firstRun.current = false;
      if (!window.location.hash) {
        const saved = parseInt(sessionStorage.getItem(key) ?? '0', 10);
        if (saved > 0) {
          // Re-apply across a few frames while content/images settle into place.
          let attempts = 0;
          const restore = () => {
            window.scrollTo(0, saved);
            if (Math.abs(window.scrollY - saved) > 4 && attempts++ < 12) {
              requestAnimationFrame(restore);
            }
          };
          requestAnimationFrame(restore);
        }
      }
    }

    // Persist the current position (throttled) and on hide/background.
    let ticking = false;
    const save = () => { try { sessionStorage.setItem(key, String(window.scrollY)); } catch { /* ignore */ } };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => { save(); ticking = false; });
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);

    return () => {
      save();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', save);
    };
  }, [pathname]);

  return null;
}

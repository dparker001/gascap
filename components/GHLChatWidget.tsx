'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';

/**
 * GHL Chat Widget — desktop only (≥ 768px).
 *
 * Two-layer suppression:
 *  1. JS gate  — the <Script> tag is never rendered on mobile, so the
 *               widget script never loads on a fresh mobile visit.
 *  2. DOM nuke — if the widget DOM persists from a prior desktop render
 *               (Next.js SPA navigation from desktop → mobile viewport),
 *               the resize handler removes every GHL element from the DOM.
 *
 * CSS in globals.css adds a third layer via display:none for any edge cases.
 */

const GHL_SELECTORS = [
  '#chat-widget-container',
  '.hl_messenger-frame',
  '[id^="chat-widget"]',
  '[class^="chat-widget"]',
  '[id*="leadconnector"]',
  '[class*="leadconnector"]',
];

function removeWidgetFromDom() {
  GHL_SELECTORS.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => el.remove());
  });
}

export default function GHLChatWidget() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');

    const handle = (matches: boolean) => {
      setIsDesktop(matches);
      if (!matches) removeWidgetFromDom();
    };

    handle(mq.matches);

    const listener = (e: MediaQueryListEvent) => handle(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  if (!isDesktop) return null;

  return (
    <Script
      id="ghl-chat-widget"
      src="https://widgets.leadconnectorhq.com/loader.js"
      data-resources-url="https://widgets.leadconnectorhq.com/chat-widget/loader.js"
      data-widget-id="69e91838391771c2f342128d"
      strategy="lazyOnload"
    />
  );
}

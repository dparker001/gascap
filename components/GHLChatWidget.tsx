'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';

/**
 * GHL Chat Widget — desktop only.
 * The script is never injected on mobile viewports (≤ 767px).
 * This is more reliable than CSS-only hiding because the widget
 * injects its own DOM and may not match static CSS selectors.
 */
export default function GHLChatWidget() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
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

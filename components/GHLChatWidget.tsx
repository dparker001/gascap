'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * GHL Chat Widget — desktop only (≥ 768px).
 *
 * Widget ID: 69f213df829cb9710742418d (updated Apr 29 2026)
 *
 * Excluded from pages that collect phone numbers / SMS consent to satisfy
 * A2P compliance checklist item 6 (no duplicate opt-in forms on widget pages).
 *
 * Two-layer suppression on mobile:
 *  1. JS gate  — the <Script> tag is never rendered on mobile.
 *  2. DOM nuke — resize handler removes GHL elements on viewport change.
 * CSS in globals.css adds a third layer via display:none for edge cases.
 */

// Pages excluded from chat widget (have their own phone/SMS opt-in forms)
const EXCLUDED_PATHS = ['/contact', '/settings'];

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
  const pathname   = usePathname();
  const [isDesktop, setIsDesktop] = useState(false);

  // Suppress on pages with their own opt-in forms
  const isExcluded = EXCLUDED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );

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

  if (!isDesktop || isExcluded) return null;

  return (
    <Script
      id="ghl-chat-widget"
      src="https://widgets.leadconnectorhq.com/loader.js"
      data-resources-url="https://widgets.leadconnectorhq.com/chat-widget/loader.js"
      data-widget-id="69f213df829cb9710742418d"
      data-source="WEB_USER"
      strategy="lazyOnload"
    />
  );
}

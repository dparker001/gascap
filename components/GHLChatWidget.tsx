'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/contexts/LanguageContext';

/**
 * GHL Chat Widget — desktop only (≥ 768px), bilingual.
 *
 * English widget ID : 69f213df829cb9710742418d
 * Spanish widget ID : set NEXT_PUBLIC_GHL_CHAT_WIDGET_ID_ES in Railway once
 *                     the Spanish bot is configured in GHL. Falls back to
 *                     the English widget until then so nothing breaks.
 *
 * Language awareness:
 *   When the user toggles to Spanish via the hero language button the locale
 *   stored in LanguageContext changes to 'es'. This component responds by:
 *     1. Purging the existing widget DOM elements.
 *     2. Re-mounting the <Script> tag with the Spanish widget ID (key swap).
 *   Switching back to English reverses the process.
 *
 * Excluded from pages that collect phone numbers / SMS consent to satisfy
 * A2P compliance checklist item 6 (no duplicate opt-in forms on widget pages).
 *
 * Two-layer suppression on mobile:
 *  1. JS gate  — the <Script> tag is never rendered on mobile.
 *  2. DOM nuke — resize handler removes GHL elements on viewport change.
 * CSS in globals.css adds a third layer via display:none for edge cases.
 */

/** English widget — always available */
const WIDGET_EN = '69f213df829cb9710742418d';

/** Spanish widget — add NEXT_PUBLIC_GHL_CHAT_WIDGET_ID_ES to Railway once
 *  the Spanish bot is created in GHL. Empty string = fall back to English. */
const WIDGET_ES = process.env.NEXT_PUBLIC_GHL_CHAT_WIDGET_ID_ES ?? '';

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
  const pathname             = usePathname();
  const { locale }           = useTranslation();
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

  // Purge the existing widget DOM whenever the locale changes so the
  // incoming widget loads into a clean slate.
  useEffect(() => {
    removeWidgetFromDom();
  }, [locale]);

  if (!isDesktop || isExcluded) return null;

  // Use the Spanish widget when locale is 'es' AND the env var is configured.
  // Falls back to the English widget if NEXT_PUBLIC_GHL_CHAT_WIDGET_ID_ES
  // hasn't been set yet — nothing breaks, bot just stays in English for now.
  const widgetId = locale === 'es' && WIDGET_ES ? WIDGET_ES : WIDGET_EN;

  return (
    <Script
      key={`ghl-chat-${widgetId}`}
      id={`ghl-chat-widget-${locale}`}
      src="https://widgets.leadconnectorhq.com/loader.js"
      data-resources-url="https://widgets.leadconnectorhq.com/chat-widget/loader.js"
      data-widget-id={widgetId}
      data-source="WEB_USER"
      strategy="lazyOnload"
    />
  );
}

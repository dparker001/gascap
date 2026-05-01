'use client';

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
 *     2. Dynamically injecting a new <script> tag with the Spanish widget ID.
 *   Switching back to English reverses the process.
 *
 *   NOTE: We use manual DOM injection (document.createElement) instead of
 *   Next.js <Script> because Next.js deduplicates scripts by src URL —
 *   both widgets share the same loader.js URL, so Next.js would only load
 *   it once and ignore the second mount with a different data-widget-id.
 *
 * Excluded from pages that collect phone numbers / SMS consent to satisfy
 * A2P compliance checklist item 6 (no duplicate opt-in forms on widget pages).
 *
 * Two-layer suppression on mobile:
 *  1. JS gate  — script is never injected on mobile.
 *  2. DOM nuke — resize handler removes GHL elements on viewport change.
 * CSS in globals.css adds a third layer via display:none for edge cases.
 */

/** English widget — always available */
const WIDGET_EN = '69f213df829cb9710742418d';

/** Spanish widget — hardcoded as primary source; env var can override if needed */
const WIDGET_ES = process.env.NEXT_PUBLIC_GHL_CHAT_WIDGET_ID_ES || '69f492d44a590de06c3cb048';

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
  // Clear GHL global state so the loader re-initializes on next inject.
  // Without this the loader detects an existing instance and skips init.
  const w = window as Record<string, unknown>;
  delete w['LeadConnector'];
  delete w['lc_chat_widget'];
  delete w['hl_messenger'];
  delete w['GHL_CHAT_WIDGET'];
}

export default function GHLChatWidget() {
  const pathname             = usePathname();
  const { locale }           = useTranslation();
  const [isDesktop, setIsDesktop] = useState(false);

  // Suppress on pages with their own opt-in forms
  const isExcluded = EXCLUDED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );

  // Detect desktop / respond to viewport changes
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

  // Inject / re-inject the widget script whenever locale, desktop state,
  // or excluded status changes. Manual DOM injection is required because
  // Next.js <Script> deduplicates by src URL and won't re-execute the same
  // loader for a different data-widget-id.
  useEffect(() => {
    if (!isDesktop || isExcluded) {
      removeWidgetFromDom();
      return;
    }

    // Use Spanish widget when locale is 'es' AND the env var is configured.
    // Falls back to English widget if NEXT_PUBLIC_GHL_CHAT_WIDGET_ID_ES
    // hasn't been set yet — nothing breaks, bot just stays in English.
    const widgetId = locale === 'es' && WIDGET_ES ? WIDGET_ES : WIDGET_EN;

    // Purge existing widget DOM before injecting the new one
    removeWidgetFromDom();

    // Remove any previously injected GHL loader scripts
    document
      .querySelectorAll('script[data-ghl-widget]')
      .forEach((el) => el.remove());

    // Inject a fresh script tag with the correct widget ID
    const script = document.createElement('script');
    script.src = 'https://widgets.leadconnectorhq.com/loader.js';
    script.setAttribute('data-resources-url', 'https://widgets.leadconnectorhq.com/chat-widget/loader.js');
    script.setAttribute('data-widget-id', widgetId);
    script.setAttribute('data-source', 'WEB_USER');
    script.setAttribute('data-ghl-widget', 'true'); // marker for cleanup
    script.async = true;
    document.body.appendChild(script);

    return () => {
      removeWidgetFromDom();
      script.remove();
    };
  }, [locale, isDesktop, isExcluded]);

  // Nothing to render — widget is injected directly into the DOM
  return null;
}

'use client';

/**
 * CampaignTracker — client-side tracker for the QR placard pilot.
 *
 * Mounted once at the top of the home page tree. It:
 *   1. Reads the gc_src cookie set by /q/[code]
 *   2. Fires a `page_view` event on first load (or `return_visit` if the
 *      visitor has been here before in this browser)
 *   3. Exposes window.gcTrack(type, meta?) so any other component can
 *      record campaign events without prop drilling.
 *
 * All requests are best-effort and silent — tracking failures must never
 * surface in the UI.
 */
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    gcTrack?: (type: string, meta?: Record<string, unknown>) => void;
  }
}

const RETURN_KEY = 'gc_seen';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

async function send(type: string, meta?: Record<string, unknown>) {
  try {
    await fetch('/api/campaign/track', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type, meta, path: window.location.pathname + window.location.search }),
      keepalive: true,
    });
  } catch {
    // silent — never break UX for an analytics call
  }
}

export default function CampaignTracker() {
  // Guard against React StrictMode double-mount in dev — without this the
  // effect runs twice and both page_view and return_visit fire on the same load.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const placement = readCookie('gc_src');
    if (!placement) {
      // No attribution — install the helper anyway so other components
      // can call it without checking. The server will short-circuit.
      window.gcTrack = (type, meta) => { void send(type, meta); };
      return;
    }

    // Install global helper for ad-hoc events from other components
    window.gcTrack = (type, meta) => { void send(type, meta); };

    // Distinguish first visit from return visit
    const seenKey = `${RETURN_KEY}:${placement}`;
    const seenBefore = localStorage.getItem(seenKey);
    if (seenBefore) {
      void send('return_visit');
    } else {
      void send('page_view');
      localStorage.setItem(seenKey, new Date().toISOString());
    }

    // Detect PWA install (Chrome/Edge)
    const onInstalled = () => { void send('save_to_phone', { method: 'pwa-installed' }); };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return null;
}

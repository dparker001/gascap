'use client';

/**
 * SplashIntro — animated brand splash, NATIVE APPS ONLY.
 *
 * The OS launch screen (Capacitor/TWA) is a static image; this is the animated
 * brand moment that plays right after the web app finishes loading. It overlays
 * the GasCap lockup on the brand green, animates it in, holds, then fades out.
 *
 * Shown once per app launch (sessionStorage flag → a cold native launch starts a
 * fresh web context, so it replays on each open but not on in-app navigation).
 * Tap anywhere to skip. Web/PWA never sees it (App Store / Play only requirement
 * doesn't apply, and we don't want a splash on the website).
 *
 * Drop-in replacement point: when the short brand VIDEO is ready, swap the <img>
 * lockup for a muted, playsInline <video> and key the dismiss off `onEnded`.
 */

import { useEffect, useState } from 'react';
import { useIsNative } from '@/hooks/useIsNative';

const SESSION_KEY = 'gc_splash_shown';
const HOLD_MS  = 2200;   // logo + tagline visible
const FADE_MS  = 500;    // fade-out duration

export default function SplashIntro() {
  const isNative = useIsNative();
  const [show, setShow]       = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!isNative) return;
    try { if (sessionStorage.getItem(SESSION_KEY) === '1') return; } catch { /* ignore */ }
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }

    setShow(true);
    const tFade = setTimeout(() => setClosing(true), HOLD_MS);
    const tHide = setTimeout(() => setShow(false), HOLD_MS + FADE_MS);
    return () => { clearTimeout(tFade); clearTimeout(tHide); };
  }, [isNative]);

  if (!show) return null;

  const dismiss = () => {
    setClosing(true);
    setTimeout(() => setShow(false), FADE_MS);
  };

  return (
    <div
      onClick={dismiss}
      role="presentation"
      aria-hidden="true"
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#005F4A]
                  transition-opacity duration-500 ${closing ? 'opacity-0' : 'opacity-100'}`}
      style={{ touchAction: 'none' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-lockup-white.png"
        alt="GasCap"
        className="gc-splash-logo w-[260px] max-w-[68vw] h-auto"
      />
      <p className="gc-splash-tag mt-4 text-[#BFE6DB] text-sm font-semibold tracking-wide">
        Know before you go
      </p>
    </div>
  );
}

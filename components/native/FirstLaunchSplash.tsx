'use client';

/**
 * FirstLaunchSplash — a short brand video that plays full-screen the FIRST time the
 * native app is opened, then hands off to the app. Pure web overlay (HTML5 <video>),
 * so it ships live with NO Codemagic rebuild and no native splash-screen plumbing.
 *
 * Flow: video plays → on end it HOLDS the final confident-lean frame (indefinitely)
 * and fades in the logo + a "Get Started" button → the user taps to enter, and the
 * overlay fades out (no hard flash to the app). The held frame stays until the user
 * taps; a Skip button is available during playback so nobody can get trapped.
 *
 * Served from jsDelivr's CDN (reads public/splash-intro.mp4 from the public repo) —
 * Railway's Node static server truncates/times-out on video-sized files. To update
 * the clip: replace public/splash-intro.mp4 + push, then purge
 * https://purge.jsdelivr.net/gh/dparker001/gascap@main/public/splash-intro.mp4
 *
 * We don't use autoPlay or trust the video's `ended` wall-clock timing: a muted clip's
 * clock can race during first-launch hydration. We paint the green overlay instantly,
 * start playback after a couple of animation frames, and reveal the CTA on `ended` OR
 * a fallback timer — whichever fires first. The clip ends on the hero frame, so even a
 * racing webview just lands there.
 */

import { useEffect, useRef, useState } from 'react';
import { useIsNative } from '@/hooks/useIsNative';

const SPLASH_VIDEO_SRC = 'https://cdn.jsdelivr.net/gh/dparker001/gascap@main/public/splash-intro.mp4';
const SEEN_KEY = 'gc_splash_intro_seen';
const CTA_FALLBACK_MS = 5800; // reveal the CTA by here even if `ended` never fires (clip ~5s)
const FADE_MS = 500;

type Phase = 'playing' | 'cta' | 'leaving';

export default function FirstLaunchSplash() {
  const isNative = useIsNative();
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<Phase>('playing');
  const videoRef = useRef<HTMLVideoElement>(null);
  const dismissed = useRef(false);

  useEffect(() => {
    if (!isNative || !SPLASH_VIDEO_SRC) return;
    try {
      if (!localStorage.getItem(SEEN_KEY)) setShow(true);
    } catch { /* storage blocked — just skip the intro */ }
  }, [isNative]);

  function dismiss() {
    if (dismissed.current) return;
    dismissed.current = true;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    setPhase('leaving');                       // fade the overlay out
    setTimeout(() => setShow(false), FADE_MS); // unmount after the fade
  }

  function revealCta() { setPhase((p) => (p === 'playing' ? 'cta' : p)); }

  useEffect(() => {
    if (!show) return;
    // Start playback after the app has painted/hydrated (thread idle) so the muted
    // clock plays at 1×, not racing.
    let raf1 = 0, raf2 = 0, startTimer = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        startTimer = window.setTimeout(() => { videoRef.current?.play().catch(() => { /* Skip remains */ }); }, 60);
      });
    });
    const ctaTimer = window.setTimeout(revealCta, CTA_FALLBACK_MS);
    return () => {
      cancelAnimationFrame(raf1); cancelAnimationFrame(raf2);
      clearTimeout(startTimer); clearTimeout(ctaTimer);
    };
  }, [show]);

  if (!show || !SPLASH_VIDEO_SRC) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] bg-[#005F4A] flex items-center justify-center
                  transition-opacity duration-500 ${phase === 'leaving' ? 'opacity-0' : 'opacity-100'}`}
      role="dialog"
      aria-label="GasCap intro"
    >
      <video
        ref={videoRef}
        src={SPLASH_VIDEO_SRC}
        muted
        playsInline
        preload="auto"
        className="w-full h-full object-cover"
        onEnded={revealCta}
        onError={dismiss}
      />

      {/* Skip — during playback only */}
      {phase === 'playing' && (
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-4 text-white/90 text-sm font-semibold bg-black/30
                     px-3 py-1.5 rounded-full backdrop-blur active:bg-black/50"
          style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
        >
          Skip
        </button>
      )}

      {/* Held hero frame + branded Enter screen — fades in once the clip lands on the lean */}
      {phase !== 'playing' && (
        <>
          {/* Brand lockup, top */}
          <div
            className="absolute inset-x-0 top-0 pb-14 flex justify-center
                       bg-gradient-to-b from-black/45 to-transparent animate-fade-in"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 22px)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-lockup-white.png" alt="GasCap" className="h-11 w-auto drop-shadow-lg" />
          </div>

          {/* Tagline + CTA, bottom */}
          <div
            className="absolute inset-x-0 bottom-0 pt-24 flex flex-col items-center gap-3
                       bg-gradient-to-t from-black/65 via-black/25 to-transparent animate-fade-in"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 38px)' }}
          >
            <p className="text-white text-xl font-black tracking-tight drop-shadow">Know before you go.</p>
            <button
              type="button"
              onClick={dismiss}
              className="w-[78%] max-w-xs py-3.5 rounded-2xl bg-brand-orange text-white font-bold
                         text-base shadow-lg active:opacity-90 transition-opacity"
            >
              Get Started →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

'use client';

/**
 * FirstLaunchSplash — a short brand video that plays full-screen the FIRST time the
 * native app is opened, then reveals the app. Pure web overlay (HTML5 <video>), so
 * it ships live with NO Codemagic rebuild and no native splash-screen plumbing.
 *
 * The clip: ~5s — woman at the pump → leaning on the car confidently (1080×1920 H.264,
 * constant 24fps, faststart, muted; edited from the brand footage).
 *
 * Robustness notes:
 *  - We DON'T use autoPlay or trust the video's `ended` event. A muted clip's clock
 *    keeps running while the main thread is busy hydrating the app on first launch,
 *    so autoplay can race to the end in a fraction of a second. Instead we paint the
 *    green overlay immediately, start playback after a couple of animation frames
 *    (thread idle), and dismiss on a FIXED timer. The clip ends on the confident-lean
 *    hero frame, so even if a webview ever races the clip, it simply holds that frame
 *    until the timer fires.
 *  - Shows once per install (localStorage); Skip button; dismisses on a load error.
 *
 * To replace the video: re-encode public/splash-intro.mp4 (H.264, yuv420p, CFR,
 * +faststart) or change SPLASH_VIDEO_SRC.
 */

import { useEffect, useRef, useState } from 'react';
import { useIsNative } from '@/hooks/useIsNative';

const SPLASH_VIDEO_SRC = '/splash-intro.mp4';
const SEEN_KEY = 'gc_splash_intro_seen';
const SHOW_MS = 5200; // fixed overlay duration (clip is ~5s)

export default function FirstLaunchSplash() {
  const isNative = useIsNative();
  const [show, setShow] = useState(false);
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
    setShow(false);
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!show) return;
    // Start playback after the app has painted/hydrated (thread idle) so the muted
    // clock plays at 1×; dismiss on a fixed timer regardless of playback quirks.
    let raf1 = 0, raf2 = 0, startTimer = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        startTimer = window.setTimeout(() => { videoRef.current?.play().catch(() => { /* Skip remains */ }); }, 60);
      });
    });
    const cap = window.setTimeout(dismiss, SHOW_MS);
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(startTimer); clearTimeout(cap); };
  }, [show]);

  if (!show || !SPLASH_VIDEO_SRC) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-[#005F4A] flex items-center justify-center"
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
        onError={dismiss}
      />
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-4 text-white/90 text-sm font-semibold bg-black/30
                   px-3 py-1.5 rounded-full backdrop-blur active:bg-black/50"
        style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
      >
        Skip
      </button>
    </div>
  );
}

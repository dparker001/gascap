'use client';

/**
 * FirstLaunchSplash — a short brand video that plays full-screen the FIRST time the
 * native app is opened, then reveals the app. Pure web overlay (HTML5 <video>), so
 * it ships live with NO Codemagic rebuild and no native splash-screen plumbing.
 *
 * ACTIVATION (when the video editor delivers the MP4):
 *   1. Drop the file at  public/splash-intro.mp4  (vertical 9:16, ~3–6s, with a
 *      freeze-frame end; keep it small — a few MB).
 *   2. Set SPLASH_VIDEO_SRC below to '/splash-intro.mp4'.
 * Until SPLASH_VIDEO_SRC is set this component renders nothing (inert), so it's safe
 * to ship now. It plays once per install (tracked in localStorage) with a Skip button
 * and auto-dismisses on end or any playback error.
 */

import { useEffect, useState } from 'react';
import { useIsNative } from '@/hooks/useIsNative';

// ⬇️ Set this to '/splash-intro.mp4' once the brand video is added to /public.
const SPLASH_VIDEO_SRC = '';
const SEEN_KEY = 'gc_splash_intro_seen';

export default function FirstLaunchSplash() {
  const isNative = useIsNative();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isNative || !SPLASH_VIDEO_SRC) return;
    try {
      if (!localStorage.getItem(SEEN_KEY)) setShow(true);
    } catch { /* storage blocked — just skip the intro */ }
  }, [isNative]);

  function dismiss() {
    setShow(false);
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
  }

  if (!show || !SPLASH_VIDEO_SRC) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-[#005F4A] flex items-center justify-center"
      role="dialog"
      aria-label="GasCap intro"
    >
      <video
        src={SPLASH_VIDEO_SRC}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover"
        onEnded={dismiss}
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

'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * SignUpExitIntent — slide-up retention sheet for the /signup page.
 *
 * Triggers on three exit signals:
 *  1. Scroll-velocity upward (mobile primary — fast scroll toward top = leaving)
 *  2. Mouse leaving top of viewport (desktop primary — classic exit-intent)
 *  3. Tab / app switch via visibilitychange (mobile secondary)
 *
 * Guards:
 *  - Only fires once per session (sessionStorage flag)
 *  - Requires ≥ 8 seconds on page before triggering
 *
 * Messages rotate randomly — one of five is chosen on mount.
 */

const MESSAGES = [
  {
    headline: 'Still thinking?',
    body: 'The average driver wastes $300+ a year at the pump. GasCap™ takes 30 seconds to set up.',
  },
  {
    headline: 'Easier than you think.',
    body: 'Takes less than a minute. No app store. No credit card. Just open and go.',
  },
  {
    headline: 'Know before you go.',
    body: 'Know exactly how much to pump — every time. It\'s free to start.',
  },
  {
    headline: 'Join the community.',
    body: 'Many drivers are already saving with GasCap™. Your account takes 30 seconds to create.',
  },
  {
    headline: 'Almost there.',
    body: "Don't leave your next fill-up to chance. Your free account is one tap away.",
  },
];

const SESSION_KEY  = 'gascap_signup_exit_shown';
const MIN_TIME_MS  = 8_000;   // must be on page ≥ 8 s before triggering
const SCROLL_VEL   = 600;     // px/sec upward to count as exit gesture
const SCROLL_Y_MAX = 120;     // must be near top when fast-scroll fires

export default function SignUpExitIntent() {
  const [visible,  setVisible]  = useState(false);
  const triggered  = useRef(false);
  const entryTime  = useRef(Date.now());
  // Pick message once on mount
  const msg = useRef(MESSAGES[Math.floor(Math.random() * MESSAGES.length)]).current;

  function tryTrigger() {
    if (triggered.current) return;
    if (Date.now() - entryTime.current < MIN_TIME_MS) return;
    try { if (sessionStorage.getItem(SESSION_KEY)) return; } catch { /* private browsing */ }
    triggered.current = true;
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
    setVisible(true);
  }

  function dismiss() { setVisible(false); }

  useEffect(() => {
    // ── Mobile: scroll-velocity upward ─────────────────────────────────────
    let lastY    = window.scrollY;
    let lastTime = Date.now();

    function onScroll() {
      const now = Date.now();
      const y   = window.scrollY;
      const dy  = y - lastY;
      const dt  = now - lastTime || 1;

      if (dy < 0) {                                   // scrolling upward
        const velocity = (Math.abs(dy) / dt) * 1000; // px/sec
        if (velocity > SCROLL_VEL && y < SCROLL_Y_MAX) tryTrigger();
      }

      lastY    = y;
      lastTime = now;
    }

    // ── Desktop: cursor exits top of viewport ──────────────────────────────
    function onMouseLeave(e: MouseEvent) {
      if (e.clientY <= 5) tryTrigger();
    }

    // ── Mobile + desktop: tab / app switch ─────────────────────────────────
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') tryTrigger();
    }

    window.addEventListener('scroll',           onScroll,           { passive: true });
    document.addEventListener('mouseleave',      onMouseLeave);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('scroll',           onScroll);
      document.removeEventListener('mouseleave',      onMouseLeave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  if (!visible) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50"
        onClick={dismiss}
        aria-hidden="true"
      />

      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Complete your free GasCap account"
        className="fixed bottom-0 inset-x-0 z-50 bg-white rounded-t-3xl px-6 pt-5 pb-10
                   shadow-2xl max-w-lg mx-auto animate-sheet-up"
      >
        {/* Drag handle */}
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" aria-hidden="true" />

        {/* Close button */}
        <button
          onClick={dismiss}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center
                     rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100
                     transition-colors"
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Brand lockup */}
        <div className="flex items-center gap-1.5 mb-4" aria-hidden="true">
          <img
            src="/gascap-icon-raw.png"
            alt=""
            className="h-9 w-auto object-contain drop-shadow-sm"
          />
          <span className="text-[#1E2D4A] font-black text-xl leading-none tracking-tight">
            GasCap<sup className="text-xs font-bold" style={{ verticalAlign: '0.6em' }}>™</sup>
          </span>
        </div>

        {/* Message */}
        <h2 className="text-xl font-black text-[#1E2D4A] mb-1.5">{msg.headline}</h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-5">{msg.body}</p>

        {/* Trust pills */}
        <div className="flex flex-wrap gap-2 mb-6" aria-label="Why sign up">
          {[
            '✓ 30 days Pro free',
            '✓ No credit card',
            '✓ 30-second setup',
          ].map((label) => (
            <span
              key={label}
              className="text-[11px] font-semibold text-green-700 bg-green-50
                         border border-green-100 rounded-full px-2.5 py-1"
            >
              {label}
            </span>
          ))}
        </div>

        {/* Primary CTA */}
        <button
          onClick={() => {
            dismiss();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            // Focus the first form field after scroll completes
            setTimeout(() => document.getElementById('name')?.focus(), 350);
          }}
          className="w-full py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400
                     active:bg-amber-600 text-white font-black text-[15px]
                     transition-colors shadow-sm"
        >
          Create my free account →
        </button>

        {/* Soft dismiss */}
        <button
          onClick={dismiss}
          className="w-full mt-3 py-1 text-sm text-slate-400 hover:text-slate-600
                     transition-colors"
        >
          No thanks, I&apos;ll figure it out at the pump
        </button>
      </div>
    </>
  );
}

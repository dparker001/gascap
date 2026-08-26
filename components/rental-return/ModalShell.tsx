'use client';

/**
 * Shared bottom-sheet/dialog shell for the Rental Return Assistant modals.
 *
 * Fixes a real focus-jump bug the three modals previously shared: each one
 * nested its own `max-h-[85vh] overflow-y-auto` box inside a bottom-anchored
 * flex overlay. Focusing a field then produced competing scrolls — `vh` does
 * not shrink when the iOS keyboard opens, so the inner container believed it
 * was still full height while the browser tried to scroll the *page* behind
 * the fixed overlay to reveal the input.
 *
 * The fix is the standard single-scroll-container pattern: the OVERLAY
 * scrolls, the panel is auto-height inside it, and body scroll is locked
 * while open so there is exactly one thing that can move.
 *
 * Note on the scroll lock: this project has been burned before by a
 * leftover `overscroll-behavior-y` rule that broke Safari scrolling
 * site-wide, so this deliberately only touches `overflow` on <body>, saves
 * the prior value, and restores it on unmount.
 */

import { useEffect, type ReactNode } from 'react';

export default function ModalShell({
  onClose,
  children,
  labelledBy,
}: {
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  // Escape to dismiss — the overlay click already closes, but a keyboard
  // user focused inside the panel has no pointer target.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      {/* min-h-full + auto margins keeps the panel centered when it's short
          and top-aligned (scrollable) when it's tall — without a vh clamp
          that the keyboard would invalidate. */}
      <div className="min-h-full flex items-end sm:items-center justify-center p-4">
        {/* min-w-0 matters here: a flex child's default min-width is `auto`
            (its content's min-content size), which can override max-w-sm if
            a descendant (e.g. a native date/time input) has a wide-enough
            intrinsic minimum — without it, that content could force this
            panel itself wider than max-w-sm instead of clipping/wrapping
            inside it. */}
        <div
          className="bg-white rounded-3xl w-full max-w-sm min-w-0 p-5 space-y-3 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

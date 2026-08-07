/**
 * Native chrome — status bar and keyboard behaviour for iOS/Android.
 * Called once on NativeAppShell mount. Silently no-ops on web.
 */

function isNative(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).Capacitor;
}

export async function initNativeChrome(): Promise<void> {
  if (!isNative()) return;
  disablePullToRefresh();
  await Promise.all([initStatusBar(), initKeyboard()]);
}

function disablePullToRefresh(): void {
  // WKWebView ignores CSS overscroll-behavior-y. Block at the touch level instead:
  // prevent default only when the document is scrolled to the top AND the user
  // is pulling downward — this kills pull-to-refresh without breaking normal scrolling.
  let startY = 0;
  document.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    const dy = e.touches[0].clientY - startY;
    // Only block a downward pull when the page (or nearest scrollable) is at the top
    if (dy > 0 && window.scrollY === 0) {
      // Allow if the touch target is inside a scrollable element that has scroll room
      const el = e.target as Element | null;
      let node: Element | null = el;
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node);
        const oy = style.overflowY;
        if ((oy === 'auto' || oy === 'scroll') && node.scrollTop > 0) return;
        node = node.parentElement;
      }
      e.preventDefault();
    }
  }, { passive: false });
}

async function initStatusBar(): Promise<void> {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    // Dark text on light background — matches the app's navy/white header
    await StatusBar.setStyle({ style: Style.Dark });
    // Overlay the WebView behind the status bar so our safe-area padding handles spacing
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.show();
  } catch { /* plugin not available in this build */ }
}

async function initKeyboard(): Promise<void> {
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    // Show the accessory bar's "Done" button above the keyboard — with it
    // hidden, there was no way to dismiss the keyboard on any input across
    // the app (numeric keypads in particular have no Return key at all),
    // leaving the keyboard covering whatever button/content sat below it.
    await Keyboard.setAccessoryBarVisible({ isVisible: true });
    await Keyboard.setScroll({ isDisabled: false });

    let focusedField: HTMLElement | null = null;
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
      focusedField = el;
    });
    document.addEventListener('focusout', () => { focusedField = null; });

    /** Nearest ancestor that can actually be scrolled. */
    const scrollableAncestor = (el: HTMLElement): HTMLElement | null => {
      let node: HTMLElement | null = el.parentElement;
      while (node) {
        const style = getComputedStyle(node);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    };

    // Real keyboard height, straight from the native event.
    let kbHeight = 0;

    /**
     * Scroll the focused field back above the keyboard.
     *
     * Two separate things had to be right here, and earlier attempts each
     * only got one of them:
     *
     * 1. WHAT to measure against. The scroll container does not reliably
     *    shrink when the keyboard appears — its bottom edge can still sit
     *    at ~889 while the keyboard's top edge is at ~543. Measuring the
     *    field against the container's own bottom therefore concludes
     *    "already visible" and scrolls nothing. The real cutoff is
     *    `innerHeight - keyboardHeight`, whichever is higher up.
     *
     * 2. WHEN to measure. `keyboardDidShow` fires before the WKWebView
     *    frame finishes resizing — at that moment the container is still
     *    full height (clientH=759) with only 17px of scroll range, so
     *    there is nowhere to scroll to. Verified on-device via Safari Web
     *    Inspector. Running again after the resize settles is what makes
     *    the range available. (This is also why typing appeared to help:
     *    it forced a later reflow.)
     *
     * So: clamp to the keyboard, and run on a few passes so at least one
     * lands after the new geometry does.
     */
    const revealFocusedField = () => {
      const el = focusedField;
      if (!el || !kbHeight) return;
      const container = scrollableAncestor(el);
      if (!container) return;

      const cutoff  = Math.min(container.getBoundingClientRect().bottom, window.innerHeight - kbHeight);
      const overhang = el.getBoundingClientRect().bottom + 12 - cutoff;
      if (overhang > 0) container.scrollTop += overhang;
    };

    Keyboard.addListener('keyboardWillShow', (info) => { kbHeight = info.keyboardHeight; });
    Keyboard.addListener('keyboardWillHide', () => { kbHeight = 0; });

    // Fire on the resize (the signal that new geometry landed) and on a
    // couple of delayed passes, since the resize event is not guaranteed
    // to fire in this WebView. revealFocusedField is idempotent — once the
    // field clears the keyboard, overhang goes negative and it no-ops.
    window.visualViewport?.addEventListener('resize', revealFocusedField);
    Keyboard.addListener('keyboardDidShow', () => {
      [0, 150, 400].forEach((d) => setTimeout(revealFocusedField, d));
    });
  } catch { /* plugin not available in this build */ }
}

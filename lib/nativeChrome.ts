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

    /**
     * Scroll the focused field back above the keyboard.
     *
     * Timing is the whole trick here. Verified on-device via Safari Web
     * Inspector that `keyboardDidShow` fires BEFORE the WKWebView frame
     * finishes resizing: at that instant the scroll container is still
     * full height (clientH=759) with only 17px of scrollable range, and
     * the field sits at y=797 — so nothing useful can be scrolled, and any
     * offset computed then is against stale geometry. Moments later the
     * frame shrinks (innerHeight 956 -> 543, container -> 413) but the
     * scroll position is never revisited, stranding the field below the
     * fold. That also explains why typing appeared to "fix" it — typing
     * forces a later reflow.
     *
     * So run off the viewport resize instead, which is the signal that the
     * new geometry has actually landed. rAF-chained to let layout settle
     * before measuring.
     */
    const revealFocusedField = () => {
      const el = focusedField;
      if (!el) return;
      requestAnimationFrame(() => {
        const container = scrollableAncestor(el);
        if (!container) return;
        const overhang = el.getBoundingClientRect().bottom + 12 - container.getBoundingClientRect().bottom;
        if (overhang > 0) container.scrollTop += overhang;
      });
    };

    window.visualViewport?.addEventListener('resize', revealFocusedField);
    // Fallback for the case where the resize lands before focus is tracked.
    Keyboard.addListener('keyboardDidShow', () => setTimeout(revealFocusedField, 150));
  } catch { /* plugin not available in this build */ }
}

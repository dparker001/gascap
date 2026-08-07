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

    // Confirmed via on-screen diagnostics (screenshots from a real device):
    // resize:"native" does NOT actually shrink window.innerHeight or
    // visualViewport.height here — the keyboard just overlays on top of a
    // full-height, unresized WebView. The browser has no idea the keyboard
    // exists spatially, so scrollIntoView has no obscured region to account
    // for. On top of that, iOS's own automatic keyboard-avoidance scroll
    // only reliably handles the top-level page scroll, not the nested
    // overflow-y-auto region NativeAppShell uses to keep the header/tab bar
    // pinned (see #gc-native-scroll there). Fix both by manually padding
    // that container's bottom by the real keyboard height while it's open —
    // the same technique UIScrollView.contentInset.bottom does natively —
    // then scrolling the focused field into view now that there's real
    // room to scroll into.
    let focusedField: HTMLElement | null = null;
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
      focusedField = el;
    });
    document.addEventListener('focusout', () => { focusedField = null; });

    const scrollRegion = () => document.getElementById('gc-native-scroll');

    Keyboard.addListener('keyboardWillShow', (info) => {
      const region = scrollRegion();
      if (region) region.style.paddingBottom = `${info.keyboardHeight}px`;
    });
    Keyboard.addListener('keyboardWillHide', () => {
      const region = scrollRegion();
      if (region) region.style.paddingBottom = '';
    });
    Keyboard.addListener('keyboardDidShow', () => {
      focusedField?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });
  } catch { /* plugin not available in this build */ }
}

/**
 * Phase 1 P1-A — server-side platform attribution for server-authoritative
 * analytics events (vehicle_saved, fillup_logged, password-register
 * signup_completed).
 *
 * Those events used to hard-code `originPlatform: 'unknown'`. The request's
 * User-Agent is the only signal available server-side, and it is only
 * trusted where it is unambiguous:
 *
 *   - 'ios' / 'android' — the native shells carry a GasCapiOS / GasCapAndroid
 *     User-Agent marker (hooks/useIsNative.ts detects the same marker
 *     client-side; capacitor.config.json sets the Android one).
 *   - 'web' — only when the UA positively identifies a standalone browser:
 *     any desktop UA, or a mobile UA that carries the tokens a real mobile
 *     browser sends and an embedded WebView does not (iOS: "Safari/" together
 *     with "Version/" or CriOS/FxiOS/EdgiOS; Android: "Chrome/"/Firefox/
 *     SamsungBrowser without the WebView "wv" flag).
 *   - 'unknown' — everything else (no UA, bots/curl, an iOS WKWebView without
 *     the marker, unrecognised strings). It is never guessed.
 *
 * Auth behaviour is not touched; this only labels analytics rows.
 */
import type { OriginPlatform } from './analyticsEvents';

const IOS_MARKER     = 'GasCapiOS';
const ANDROID_MARKER = 'GasCapAndroid';

export function originPlatformFromUserAgent(ua: string | null | undefined): OriginPlatform {
  if (!ua || typeof ua !== 'string') return 'unknown';

  if (ua.includes(IOS_MARKER))     return 'ios';
  if (ua.includes(ANDROID_MARKER)) return 'android';

  const isIos     = /\b(iPhone|iPad|iPod)\b/.test(ua);
  const isAndroid = /\bAndroid\b/.test(ua);

  if (isIos) {
    const standaloneBrowser =
      (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) || /\b(CriOS|FxiOS|EdgiOS)\//.test(ua);
    return standaloneBrowser ? 'web' : 'unknown';
  }

  if (isAndroid) {
    if (/;\s*wv\)/.test(ua)) return 'unknown';
    return /\b(Chrome|Firefox|SamsungBrowser|EdgA|OPR)\//.test(ua) ? 'web' : 'unknown';
  }

  // Desktop: a native shell can only be iOS/Android, so a recognisable
  // desktop browser UA is a web client.
  if (/\b(Windows NT|Macintosh|X11|CrOS)\b/.test(ua) && /\b(Chrome|Safari|Firefox|Edg|OPR)\//.test(ua)) {
    return 'web';
  }
  return 'unknown';
}

export function originPlatformFromRequest(req: Request): OriginPlatform {
  try {
    return originPlatformFromUserAgent(req.headers.get('user-agent'));
  } catch {
    return 'unknown';
  }
}

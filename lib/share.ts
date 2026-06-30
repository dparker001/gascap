/**
 * Native share sheet wrapper — falls back to Web Share API, then clipboard.
 */

export interface SharePayload {
  title: string;
  text: string;
  url?: string;
}

export async function nativeShare(payload: SharePayload): Promise<'shared' | 'copied' | 'unavailable'> {
  // Try Capacitor Share (iOS/Android native sheet)
  try {
    const { Share } = await import('@capacitor/share');
    const { value } = await Share.canShare();
    if (value) {
      await Share.share({
        title: payload.title,
        text:  payload.text,
        url:   payload.url ?? 'https://www.gascap.app',
        dialogTitle: payload.title,
      });
      return 'shared';
    }
  } catch { /* not in native context */ }

  // Fallback: Web Share API (Safari on iOS PWA, Chrome Android)
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: payload.title,
        text:  payload.text,
        url:   payload.url ?? 'https://www.gascap.app',
      });
      return 'shared';
    } catch { /* cancelled or unsupported */ }
  }

  // Last resort: copy to clipboard
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(`${payload.text}\n${payload.url ?? 'https://www.gascap.app'}`);
      return 'copied';
    } catch { /* denied */ }
  }

  return 'unavailable';
}

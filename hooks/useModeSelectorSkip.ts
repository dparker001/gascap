'use client';

/**
 * P1-A — remembers that THIS user chose "Skip for now" on the first-login
 * mode selector, so a skip actually ends the prompt instead of reopening on
 * every load (which would silently turn a skippable modal back into a
 * blocking one). Per-browser localStorage, keyed by user id; it stores only a
 * flag. The user's mode itself stays null, and Settings can still set it.
 */
import { useCallback, useEffect, useState } from 'react';

export const MODE_SKIP_KEY_PREFIX = 'gc_mode_selector_skipped:';

export function modeSkipKey(userId: string): string {
  return `${MODE_SKIP_KEY_PREFIX}${userId}`;
}

export function useModeSelectorSkip(userId: string | null | undefined) {
  const [skipped, setSkipped] = useState(false);
  // `ready` stays false until localStorage has been read, so the selector
  // never flashes for a user who already skipped.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!userId) { setSkipped(false); setReady(false); return; }
    try { setSkipped(window.localStorage.getItem(modeSkipKey(userId)) === '1'); }
    catch { setSkipped(false); }
    setReady(true);
  }, [userId]);

  const markSkipped = useCallback(() => {
    setSkipped(true);
    if (!userId) return;
    try { window.localStorage.setItem(modeSkipKey(userId), '1'); } catch { /* storage blocked — in-memory skip still applies */ }
  }, [userId]);

  return { skipped, ready, markSkipped };
}

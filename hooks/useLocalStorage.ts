import { useState, useEffect, useRef } from 'react';

/**
 * useState with localStorage persistence.
 *
 * Always initializes with `initialValue` so the server render and the first
 * client render are identical (no hydration mismatch). After mount a
 * useEffect hydrates the state from localStorage, and subsequent user-driven
 * changes are written back.
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(initialValue);
  // Tracks whether the initial (always-skipped) write effect has fired.
  const skipFirstWrite = useRef(true);

  // After mount: pull the stored value into state.
  // This runs only once, so a key change at runtime won't re-hydrate — that
  // is fine because all keys in this app are static string literals.
  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item != null) setValue(JSON.parse(item) as T);
    } catch {
      // localStorage unavailable (private mode, security policy, etc.)
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep localStorage in sync with state, but skip the very first run (which
  // would overwrite the stored value with initialValue before hydration fires).
  useEffect(() => {
    if (skipFirstWrite.current) {
      skipFirstWrite.current = false;
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore write errors (quota exceeded, private mode, etc.)
    }
  }, [key, value]);

  return [value, setValue] as const;
}

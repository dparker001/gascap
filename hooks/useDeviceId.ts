'use client';

/**
 * A random id persisted per browser/app-install — not tied to any account,
 * just "this physical device/browser." Used only for the soft device-count
 * signal in lib/deviceSessions.ts.
 */
const KEY = 'gc_device_id';

export function getDeviceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

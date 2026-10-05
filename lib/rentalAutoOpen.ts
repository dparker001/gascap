/**
 * C1 — opt-in, device-local "open my rental at pickup time".
 *
 * The decision is a pure function so every guard is unit-tested; the storage
 * helpers swallow storage errors (private windows, blocked site data) and
 * fail OFF — an unreadable setting never opens anything.
 *
 * Opens only when ALL hold: the renter enabled it on THIS device; the app is
 * on the home route and the renter isn't typing; it's a cold start or a
 * resume after a real break; exactly ONE rental is in the 'pickup' state; and
 * this rental+pickup-instant hasn't been auto-opened on this device before.
 * It never touches rental data, fuel readings or userMode.
 */
import type { RentalLifecycle } from './rentalCalculations';

export const AUTO_OPEN_ENABLED_KEY = 'gc_rental_autoopen_enabled';
export const AUTO_OPEN_ONCE_PREFIX = 'gc_rental_autoopen:';
/** A resume counts only after this long in the background. */
export const AUTO_OPEN_MIN_BACKGROUND_MS = 5 * 60_000;
/** The only route it may fire from: home / the calculator. */
export const AUTO_OPEN_ROUTE = '/';
/** Marks the opened rental page so it can show the "Turn off" notice. */
export const AUTO_OPEN_QUERY = 'auto=pickup';

export interface AutoOpenRental { id: string; lifecycle: RentalLifecycle; pickupKey: string }

export type AutoOpenDecision =
  | { action: 'open'; rentalId: string; onceKey: string }
  | { action: 'none'; reason:
      'disabled' | 'wrong_route' | 'typing' | 'too_soon_after_resume' | 'no_pickup_rental' | 'multiple_pickup_rentals' | 'already_opened' };

export const autoOpenOnceKey = (rentalId: string, pickupKey: string) =>
  `${AUTO_OPEN_ONCE_PREFIX}${rentalId}:${pickupKey}`;

export function decideAutoOpen(input: {
  enabled: boolean;
  pathname: string;
  /** An input/textarea/select/contenteditable currently has focus. */
  typing: boolean;
  trigger: 'cold_start' | 'resume';
  backgroundedMs: number;
  rentals: AutoOpenRental[];
  hasOnceFlag: (onceKey: string) => boolean;
}): AutoOpenDecision {
  if (!input.enabled) return { action: 'none', reason: 'disabled' };
  if (input.pathname !== AUTO_OPEN_ROUTE) return { action: 'none', reason: 'wrong_route' };
  if (input.typing) return { action: 'none', reason: 'typing' };
  if (input.trigger === 'resume' && input.backgroundedMs < AUTO_OPEN_MIN_BACKGROUND_MS) {
    return { action: 'none', reason: 'too_soon_after_resume' };
  }
  const atPickup = input.rentals.filter((r) => r.lifecycle === 'pickup');
  if (atPickup.length === 0) return { action: 'none', reason: 'no_pickup_rental' };
  if (atPickup.length > 1) return { action: 'none', reason: 'multiple_pickup_rentals' };
  const r = atPickup[0];
  const onceKey = autoOpenOnceKey(r.id, r.pickupKey);
  if (input.hasOnceFlag(onceKey)) return { action: 'none', reason: 'already_opened' };
  return { action: 'open', rentalId: r.id, onceKey };
}

// ── device-local storage (never throws) ─────────────────────────────────────
function store(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}
export function isAutoOpenEnabled(): boolean {
  try { return store()?.getItem(AUTO_OPEN_ENABLED_KEY) === '1'; } catch { return false; }
}
export function setAutoOpenEnabled(on: boolean): void {
  try { if (on) store()?.setItem(AUTO_OPEN_ENABLED_KEY, '1'); else store()?.removeItem(AUTO_OPEN_ENABLED_KEY); } catch { /* fail off */ }
}
export function hasAutoOpenOnceFlag(onceKey: string): boolean {
  try { return store()?.getItem(onceKey) === '1'; } catch { return false; }
}
export function setAutoOpenOnceFlag(onceKey: string): void {
  try { store()?.setItem(onceKey, '1'); } catch { /* worst case it may open again */ }
}

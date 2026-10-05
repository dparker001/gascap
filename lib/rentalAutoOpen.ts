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

/** Consent is per ACCOUNT on this device: the user id is part of every key, so
 *  one person enabling it never enables it for whoever signs in next. */
export const AUTO_OPEN_ENABLED_PREFIX = 'gc_rental_autoopen_enabled:';
export const AUTO_OPEN_ONCE_PREFIX = 'gc_rental_autoopen:';
/** A resume counts only after this long in the background. */
export const AUTO_OPEN_MIN_BACKGROUND_MS = 5 * 60_000;
/** The only route it may fire from: home / the calculator. */
export const AUTO_OPEN_ROUTE = '/';
/** Marks the opened rental page so it can show the "Turn off" notice. */
export const AUTO_OPEN_QUERY = 'auto=pickup';

export const autoOpenEnabledKey = (userId: string) => `${AUTO_OPEN_ENABLED_PREFIX}${userId}`;

export interface AutoOpenRental { id: string; lifecycle: RentalLifecycle; pickupKey: string }

export type AutoOpenDecision =
  | { action: 'open'; rentalId: string; onceKey: string }
  | { action: 'none'; reason:
      'disabled' | 'wrong_route' | 'typing' | 'too_soon_after_resume' | 'no_pickup_rental' | 'multiple_pickup_rentals' | 'already_opened' };

export const autoOpenOnceKey = (userId: string, rentalId: string, pickupKey: string) =>
  `${AUTO_OPEN_ONCE_PREFIX}${userId}:${rentalId}:${pickupKey}`;

export function decideAutoOpen(input: {
  userId: string;
  enabled: boolean;
  pathname: string;
  /** An input/textarea/select/contenteditable currently has focus. */
  typing: boolean;
  trigger: 'cold_start' | 'resume';
  backgroundedMs: number;
  rentals: AutoOpenRental[];
  hasOnceFlag: (onceKey: string) => boolean;
}): AutoOpenDecision {
  if (!input.enabled || !input.userId) return { action: 'none', reason: 'disabled' };
  if (input.pathname !== AUTO_OPEN_ROUTE) return { action: 'none', reason: 'wrong_route' };
  if (input.typing) return { action: 'none', reason: 'typing' };
  if (input.trigger === 'resume' && input.backgroundedMs < AUTO_OPEN_MIN_BACKGROUND_MS) {
    return { action: 'none', reason: 'too_soon_after_resume' };
  }
  const atPickup = input.rentals.filter((r) => r.lifecycle === 'pickup');
  if (atPickup.length === 0) return { action: 'none', reason: 'no_pickup_rental' };
  if (atPickup.length > 1) return { action: 'none', reason: 'multiple_pickup_rentals' };
  const r = atPickup[0];
  const onceKey = autoOpenOnceKey(input.userId, r.id, r.pickupKey);
  if (input.hasOnceFlag(onceKey)) return { action: 'none', reason: 'already_opened' };
  return { action: 'open', rentalId: r.id, onceKey };
}

/**
 * The LAST gate, evaluated after the asynchronous rental fetch returns and
 * immediately before navigating. The check began under one set of
 * circumstances; navigation happens only if every one of them still holds —
 * same signed-in account, same check generation (not superseded by a new
 * check, a logout, an account change or an unmount), not aborted, still on
 * the home route, the renter hasn't started typing, and the setting is STILL
 * enabled for this account. Anything stale → do nothing.
 */
export function canNavigateAfterCheck(c: {
  requestedUserId: string; currentUserId: string | null;
  requestedGeneration: number; currentGeneration: number;
  aborted: boolean; currentPathname: string; typing: boolean; enabledNow: boolean;
}): boolean {
  return !!c.requestedUserId
    && c.currentUserId === c.requestedUserId
    && c.requestedGeneration === c.currentGeneration
    && !c.aborted
    && c.currentPathname === AUTO_OPEN_ROUTE
    && !c.typing
    && c.enabledNow;
}

// ── device-local storage (never throws; per account) ─────────────────────────
function store(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}
export function isAutoOpenEnabled(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try { return store()?.getItem(autoOpenEnabledKey(userId)) === '1'; } catch { return false; }
}
export function setAutoOpenEnabled(userId: string | null | undefined, on: boolean): void {
  if (!userId) return;
  try { if (on) store()?.setItem(autoOpenEnabledKey(userId), '1'); else store()?.removeItem(autoOpenEnabledKey(userId)); } catch { /* fail off */ }
}
export function hasAutoOpenOnceFlag(onceKey: string): boolean {
  try { return store()?.getItem(onceKey) === '1'; } catch { return false; }
}
export function setAutoOpenOnceFlag(onceKey: string): void {
  try { store()?.setItem(onceKey, '1'); } catch { /* worst case it may open again */ }
}

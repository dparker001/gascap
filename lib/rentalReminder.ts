/**
 * Native local notifications for rental returns.
 *
 * Two distinct things live here:
 *
 * 1. EV calculator return reminder (scheduleRentalReturnReminder /
 *    cancelRentalReturnReminder). The EV Charge tab's rental mode has NO
 *    server record, so it can only use the wall clock the user typed, read on
 *    this device. It now uses its OWN fixed id (EV_RETURN_NOTIFICATION_ID),
 *    outside the Rental Mode range, so it can never replace a rental reminder.
 *
 * 2. Rental Mode (RentalSession) return reminders — Option C (owner decision
 *    2026-10-02): SERVER PUSH is primary. A LOCAL fallback is scheduled only
 *    when THIS device has no usable push, and only from the authoritative
 *    server instant `returnDateTimeUtc - 2h` — never from the wall clock
 *    re-read in this device's zone. One deterministic id per rental in a
 *    reserved range; stale ids are reconciled away; taps deep-link to
 *    /rental-return/<id>. When push becomes usable, all fallbacks are
 *    cancelled so the same event never notifies twice on one device.
 *    Pickup reminders stay server-only (no local fallback in this phase).
 *
 * Every native call is best-effort and silent; on web everything no-ops.
 */

const EV_RETURN_NOTIFICATION_ID = 918273;          // historic id, now EV-only
const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;      // 2 hours

/** Reserved id range for Rental Mode return fallbacks (EV id is outside it). */
export const RENTAL_RETURN_ID_MIN = 910_000_000;
export const RENTAL_RETURN_ID_MAX = 919_999_999;
const RANGE = RENTAL_RETURN_ID_MAX - RENTAL_RETURN_ID_MIN + 1;

function isNative(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).Capacitor;
}

// ── 1. EV calculator (device wall clock; no server record exists) ──────────

/**
 * Schedule (or reschedule) the EV calculator's drop-off reminder for the
 * given local date/time. If the computed reminder time has already passed,
 * no notification is scheduled. NOT used for Rental Mode rentals.
 */
export async function scheduleRentalReturnReminder(
  dateStr: string,
  timeStr: string,
  opts: { isEv?: boolean } = {},
): Promise<void> {
  if (!isNative() || !dateStr || !timeStr) return;
  try {
    const returnAt = new Date(`${dateStr}T${timeStr}:00`);
    if (isNaN(returnAt.getTime())) return;
    const reminderAt = new Date(returnAt.getTime() - REMINDER_LEAD_MS);
    if (reminderAt.getTime() <= Date.now()) return; // already too late to remind
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    if (!(await ensureLocalPermission(LocalNotifications))) return;
    await LocalNotifications.schedule({
      notifications: [{
        id:    EV_RETURN_NOTIFICATION_ID,
        title: opts.isEv ? '🔋 Rental due back in 2 hours' : '⛽ Rental due back in 2 hours',
        body:  opts.isEv
          ? 'Charge to your required return level now — charging takes longer than a fill-up.'
          : "Fill up before drop-off to avoid the rental company's refuel fee.",
        schedule: { at: reminderAt },
        extra: { tab: 'calculator' },
      }],
    });
  } catch { /* local-notifications not available in this build */ }
}

/** Cancel the EV calculator's drop-off reminder. */
export async function cancelRentalReturnReminder(): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id: EV_RETURN_NOTIFICATION_ID }] });
  } catch { /* ignore */ }
}

type LN = typeof import('@capacitor/local-notifications').LocalNotifications;
async function ensureLocalPermission(LocalNotifications: LN): Promise<boolean> {
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display === 'granted') return true;
  const req = await LocalNotifications.requestPermissions();
  return req.display === 'granted';
}

// ── 2. Rental Mode return fallback (Option C) ───────────────────────────────

/** Deterministic id for a rental's return-2h fallback (FNV-1a → reserved range). */
export function rentalReturnNotificationId(sessionId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return RENTAL_RETURN_ID_MIN + (h % RANGE);
}
export const isRentalReturnNotificationId = (id: number) => id >= RENTAL_RETURN_ID_MIN && id <= RENTAL_RETURN_ID_MAX;

export interface FallbackSession {
  id:                string;
  status:            string;
  rentalCompany?:    string | null;
  returnDateTimeUtc: string | null;
}
export interface PlannedFallback { id: number; atMs: number; url: string; sessionId: string; company: string | null }

/**
 * Pure: which return fallbacks SHOULD be pending. Only active rentals with a
 * server-derived returnDateTimeUtc whose 2h-before instant is still ahead.
 * A rental without a UTC instant gets none (never derived from a wall clock).
 */
export function planRentalReturnFallbacks(sessions: FallbackSession[], nowMs: number): PlannedFallback[] {
  const out: PlannedFallback[] = [];
  for (const s of sessions) {
    if (s.status !== 'active' || !s.returnDateTimeUtc) continue;
    const due = Date.parse(s.returnDateTimeUtc);
    if (!Number.isFinite(due)) continue;
    const atMs = due - REMINDER_LEAD_MS;
    if (atMs <= nowMs) continue;
    out.push({ id: rentalReturnNotificationId(s.id), atMs, url: `/rental-return/${encodeURIComponent(s.id)}`, sessionId: s.id, company: s.rentalCompany ?? null });
  }
  return out;
}

/**
 * Pure reconciliation. With usable push, every pending rental fallback is
 * cancelled and none scheduled (server push is primary — no duplicates).
 * Otherwise: schedule the plan, cancel pending rental ids not in it. Ids
 * outside the reserved range (EV, anything else) are never touched.
 */
export function reconcileRentalFallbacks(pendingIds: number[], plan: PlannedFallback[], pushUsable: boolean):
  { toSchedule: PlannedFallback[]; toCancel: number[] } {
  const pendingRental = pendingIds.filter(isRentalReturnNotificationId);
  if (pushUsable) return { toSchedule: [], toCancel: pendingRental };
  const wanted = new Set(plan.map((p) => p.id));
  return { toSchedule: plan, toCancel: pendingRental.filter((id) => !wanted.has(id)) };
}

/** Internal app paths only — never an external or protocol-relative URL. */
export function safeInternalPath(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !url.includes('\\') ? url : null;
}

// ── Push-usable detection (per device) ──────────────────────────────────────

const IOS_REGISTERED_KEY = 'gc_ios_push_registered_user';

/** iOS: call after the APNs token was successfully POSTed for this user. */
export function markIosPushRegistered(userId: string): void {
  try { localStorage.setItem(IOS_REGISTERED_KEY, userId); } catch { /* ignore */ }
}

/**
 * Whether THIS device will receive the server's push for this user.
 *   iOS: APNs permission granted AND this user's token was POSTed to
 *        /api/native/push-token from this device (markIosPushRegistered).
 *   Android (OneSignal Capacitor SDK 1.1.7, confirmed from its d.ts):
 *        Notifications.hasPermission() AND
 *        User.pushSubscription.getOptedInAsync() AND a non-null
 *        getTokenAsync() (opted-in "does not guarantee a token") AND
 *        User.getExternalId() === userId (server push targets external id).
 * Any error → false (fall back to a local reminder rather than none).
 */
export async function isPushUsableOnThisDevice(userId: string, platform: 'ios' | 'android' | null): Promise<boolean> {
  if (!isNative() || !userId || !platform) return false;
  try {
    if (platform === 'ios') {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const perm = await PushNotifications.checkPermissions();
      let registeredFor: string | null = null;
      try { registeredFor = localStorage.getItem(IOS_REGISTERED_KEY); } catch { /* ignore */ }
      return perm.receive === 'granted' && registeredFor === userId;
    }
    const { default: OneSignal } = await import('@onesignal/capacitor-plugin');
    const [perm, optedIn, token, externalId] = await Promise.all([
      OneSignal.Notifications.hasPermission(),
      OneSignal.User.pushSubscription.getOptedInAsync(),
      OneSignal.User.pushSubscription.getTokenAsync(),
      OneSignal.User.getExternalId(),
    ]);
    return perm && optedIn && !!token && externalId === userId;
  } catch {
    return false;
  }
}

/**
 * Re-sync this device's Rental Mode return fallbacks. Call after create/edit
 * (with the fresh active list) and on dashboard/list load. Idempotent:
 * scheduling an existing id replaces it.
 */
export async function syncRentalReturnFallbacks(
  sessions: FallbackSession[], ctx: { userId: string; platform: 'ios' | 'android' | null }, nowMs: number = Date.now(),
): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const pushUsable = await isPushUsableOnThisDevice(ctx.userId, ctx.platform);
    const pending = (await LocalNotifications.getPending()).notifications.map((n) => n.id);
    const { toSchedule, toCancel } = reconcileRentalFallbacks(pending, planRentalReturnFallbacks(sessions, nowMs), pushUsable);
    if (toCancel.length) await LocalNotifications.cancel({ notifications: toCancel.map((id) => ({ id })) });
    if (!toSchedule.length || !(await ensureLocalPermission(LocalNotifications))) return;
    await LocalNotifications.schedule({
      notifications: toSchedule.map((p) => ({
        id:    p.id,
        title: '⛽ Rental due back in 2 hours',
        body:  p.company ? `Your ${p.company} rental is due back soon — fill up before drop-off.` : "Fill up before drop-off to avoid the rental company's refuel fee.",
        schedule: { at: new Date(p.atMs) },
        extra: { url: p.url },
      })),
    });
  } catch { /* best-effort; the server push/email remain */ }
}

/** Cancel every Rental Mode return fallback on this device (push became usable). */
export async function cancelAllRentalReturnFallbacks(): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const ids = (await LocalNotifications.getPending()).notifications.map((n) => n.id).filter(isRentalReturnNotificationId);
    if (ids.length) await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  } catch { /* ignore */ }
}

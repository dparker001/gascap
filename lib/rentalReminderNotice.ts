/**
 * Which server pickup reminders are still AHEAD for an upcoming rental — so
 * the dashboard notice only claims what the cron will actually send
 * (2026-10-02, T7 copy). Pure display logic; it schedules nothing.
 *
 * Mirrors app/api/cron/rental-return-reminder/route.ts:
 *   - pickup24 fires while the authoritative pickup instant is 20–26h away
 *     (a rental saved less than ~20h ahead never gets it);
 *   - pickup2 fires while it is 0–3h away; UTC-only.
 * A tier already stamped *SentAt is no longer "scheduled".
 * Without an authoritative pickupDateTimeUtc nothing is claimed.
 */

export const PICKUP_24H_LOWER_HOURS = 20;   // keep in sync with the cron's PICKUP_24H.lowerHours

export interface PickupReminderNoticeInput {
  status:                 string;
  pickupDateTimeUtc:      string | null;
  pickupReminder24SentAt: string | null;
  pickupReminder2SentAt:  string | null;
}

export interface PendingPickupReminders { day: boolean; twoHour: boolean }

export function pendingPickupReminders(s: PickupReminderNoticeInput, nowMs: number = Date.now()): PendingPickupReminders | null {
  if (s.status !== 'active' || !s.pickupDateTimeUtc) return null;
  const at = Date.parse(s.pickupDateTimeUtc);
  if (!Number.isFinite(at)) return null;
  const hoursAway = (at - nowMs) / 3_600_000;
  const day     = !s.pickupReminder24SentAt && hoursAway > PICKUP_24H_LOWER_HOURS;
  const twoHour = !s.pickupReminder2SentAt && hoursAway > 0;
  return day || twoHour ? { day, twoHour } : null;
}

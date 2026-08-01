/**
 * Rental Mode drop-off reminder — schedules a native local notification 2 hours
 * before the user's rental return date/time, reminding them to fill the tank
 * before drop-off. Local-only (no server/push needed): @capacitor/local-notifications
 * fires it even if the app is closed. Silently no-ops on web.
 */

const NOTIFICATION_ID = 918273; // fixed id — scheduling again with the same id replaces the previous one
const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000; // 2 hours

function isNative(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).Capacitor;
}

/**
 * Schedule (or reschedule) the drop-off reminder for the given local date/time.
 * If the computed reminder time has already passed, no notification is scheduled.
 */
export async function scheduleRentalReturnReminder(dateStr: string, timeStr: string): Promise<void> {
  if (!isNative() || !dateStr || !timeStr) return;
  try {
    const returnAt = new Date(`${dateStr}T${timeStr}:00`);
    if (isNaN(returnAt.getTime())) return;
    const reminderAt = new Date(returnAt.getTime() - REMINDER_LEAD_MS);
    if (reminderAt.getTime() <= Date.now()) return; // already too late to remind

    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== 'granted') return;
    }

    await LocalNotifications.schedule({
      notifications: [{
        id:    NOTIFICATION_ID,
        title: '⛽ Rental due back in 2 hours',
        body:  "Fill up before drop-off to avoid the rental company's refuel fee.",
        schedule: { at: reminderAt },
        extra: { tab: 'calculator' },
      }],
    });
  } catch { /* local-notifications not available in this build */ }
}

/** Cancel the drop-off reminder — call when the user clears the return date/time or exits Rental Mode. */
export async function cancelRentalReturnReminder(): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] });
  } catch { /* ignore */ }
}

/**
 * lib/rentalReminder.ts — native local 2h-before-return reminder.
 * 2026-08-25 P0 fix wires this into RentalSetupFlow/EditRentalModal (see
 * those components) — this file tests the scheduling helper itself:
 * permission handling never nags repeatedly, a denied permission never
 * crashes, and the server cron remains the backup path (this helper is
 * local-only and best-effort — see its own header comment).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

type PermStatus = 'granted' | 'denied' | 'prompt';
const checkPermissions   = vi.fn(async (): Promise<{ display: PermStatus }> => ({ display: 'granted' }));
const requestPermissions = vi.fn(async (): Promise<{ display: PermStatus }> => ({ display: 'granted' }));
const schedule           = vi.fn(async (_opts?: unknown) => {});
const cancel             = vi.fn(async (_opts?: unknown) => {});
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions:   () => checkPermissions(),
    requestPermissions: () => requestPermissions(),
    schedule:            (opts: unknown) => schedule(opts),
    cancel:              (opts: unknown) => cancel(opts),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  checkPermissions.mockResolvedValue({ display: 'granted' });
  requestPermissions.mockResolvedValue({ display: 'granted' });
  // Simulate a native Capacitor WebView — isNative() checks window.Capacitor.
  (globalThis as { window?: unknown }).window = { Capacitor: {} };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

async function getModule() {
  return import('@/lib/rentalReminder');
}

function futureLocalParts(hoursFromNow: number): [string, string] {
  const d = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return [dateStr, timeStr];
}

describe('scheduleRentalReturnReminder', () => {
  it('schedules a notification 2 hours before the given return time when permission is already granted', async () => {
    const { scheduleRentalReturnReminder } = await getModule();
    const [d, t] = futureLocalParts(5); // return is 5h out — reminder should land ~3h from now
    await scheduleRentalReturnReminder(d, t);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(requestPermissions).not.toHaveBeenCalled(); // already granted — never re-prompts
  });

  it('7. requests permission only when not already granted, and does not nag again once granted', async () => {
    checkPermissions.mockResolvedValue({ display: 'prompt' });
    requestPermissions.mockResolvedValue({ display: 'granted' });
    const { scheduleRentalReturnReminder } = await getModule();
    const [d, t] = futureLocalParts(5);
    await scheduleRentalReturnReminder(d, t);
    expect(requestPermissions).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('7b. a DENIED permission does not crash — schedule() is simply never called', async () => {
    checkPermissions.mockResolvedValue({ display: 'prompt' });
    requestPermissions.mockResolvedValue({ display: 'denied' });
    const { scheduleRentalReturnReminder } = await getModule();
    const [d, t] = futureLocalParts(5);
    await expect(scheduleRentalReturnReminder(d, t)).resolves.toBeUndefined();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('a return time already in the past (reminder time already elapsed) does not schedule anything', async () => {
    const { scheduleRentalReturnReminder } = await getModule();
    const [d, t] = futureLocalParts(-1); // return already happened
    await scheduleRentalReturnReminder(d, t);
    expect(schedule).not.toHaveBeenCalled();
    expect(checkPermissions).not.toHaveBeenCalled(); // bails before even checking permission
  });

  it('an invalid date/time string does not throw', async () => {
    const { scheduleRentalReturnReminder } = await getModule();
    await expect(scheduleRentalReturnReminder('not-a-date', '10:00')).resolves.toBeUndefined();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('web (non-native) silently no-ops — no permission check, no schedule call', async () => {
    delete (globalThis as { window?: unknown }).window;
    const { scheduleRentalReturnReminder } = await getModule();
    const [d, t] = futureLocalParts(5);
    await scheduleRentalReturnReminder(d, t);
    expect(checkPermissions).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('8. is purely local/best-effort — a schedule() throw is swallowed, never propagates (server cron remains the backup)', async () => {
    schedule.mockRejectedValue(new Error('local-notifications plugin unavailable'));
    const { scheduleRentalReturnReminder } = await getModule();
    const [d, t] = futureLocalParts(5);
    await expect(scheduleRentalReturnReminder(d, t)).resolves.toBeUndefined();
  });
});

describe('cancelRentalReturnReminder', () => {
  it('cancels the fixed-id notification on native', async () => {
    const { cancelRentalReturnReminder } = await getModule();
    await cancelRentalReturnReminder();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('no-ops on web', async () => {
    delete (globalThis as { window?: unknown }).window;
    const { cancelRentalReturnReminder } = await getModule();
    await cancelRentalReturnReminder();
    expect(cancel).not.toHaveBeenCalled();
  });
});

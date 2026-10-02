/**
 * T5 — Rental Mode return reminders, Option C (owner decision 2026-10-02):
 * server push primary; a LOCAL fallback only on a device without usable
 * push, scheduled from returnDateTimeUtc - 2h (never a device-read wall
 * clock), one deterministic id per rental, stale ids reconciled, deep link
 * to the rental. No pickup local fallback. EV reminder id kept separate.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  planRentalReturnFallbacks, reconcileRentalFallbacks, rentalReturnNotificationId, isRentalReturnNotificationId,
  safeInternalPath, RENTAL_RETURN_ID_MIN, RENTAL_RETURN_ID_MAX,
} from '@/lib/rentalReminder';

const ONE_WAY = { id: 'rs-oneway', status: 'active', rentalCompany: 'Hertz', returnDateTimeUtc: '2026-10-08T14:00:00.000Z' };
const NOW = Date.parse('2026-10-06T00:00:00Z');

describe('plan (pure)', () => {
  it('one-way JFK return: fallback at returnDateTimeUtc - 2h, BEFORE the due instant, deep-linked', () => {
    const [p] = planRentalReturnFallbacks([ONE_WAY], NOW);
    expect(new Date(p.atMs).toISOString()).toBe('2026-10-08T12:00:00.000Z');
    expect(p.atMs).toBeLessThan(Date.parse(ONE_WAY.returnDateTimeUtc));
    expect(p.url).toBe('/rental-return/rs-oneway');
    expect(p.id).toBe(rentalReturnNotificationId('rs-oneway'));
  });
  it('no fallback for: no UTC instant (never derived from a wall clock), non-active, or already-past', () => {
    expect(planRentalReturnFallbacks([
      { id: 'a', status: 'active', returnDateTimeUtc: null },
      { id: 'b', status: 'completed', returnDateTimeUtc: '2026-10-08T14:00:00.000Z' },
      { id: 'c', status: 'active', returnDateTimeUtc: '2026-10-06T01:00:00.000Z' }, // 2h-before already passed
    ], NOW)).toEqual([]);
  });
  it('plans RETURN reminders only — there is no pickup local fallback', () => {
    const plan = planRentalReturnFallbacks([ONE_WAY], NOW);
    expect(plan).toHaveLength(1);
    expect(Object.keys(plan[0]).sort()).toEqual(['atMs', 'company', 'id', 'sessionId', 'url']);
  });
});

describe('ids', () => {
  it('deterministic, inside the reserved range, distinct across rentals', () => {
    const ids = Array.from({ length: 500 }, (_, i) => rentalReturnNotificationId(`session-${i}-${'x'.repeat(i % 7)}`));
    expect(rentalReturnNotificationId('abc')).toBe(rentalReturnNotificationId('abc'));
    expect(ids.every((id) => id >= RENTAL_RETURN_ID_MIN && id <= RENTAL_RETURN_ID_MAX)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('the EV calculator id (918273) is outside the rental range', () => {
    expect(isRentalReturnNotificationId(918273)).toBe(false);
  });
});

describe('reconcile (pure)', () => {
  const plan = planRentalReturnFallbacks([ONE_WAY], NOW);
  const stale = rentalReturnNotificationId('deleted-rental');
  it('usable push → cancel every pending rental fallback, schedule none; EV id untouched', () => {
    expect(reconcileRentalFallbacks([plan[0].id, stale, 918273], plan, true)).toEqual({ toSchedule: [], toCancel: [plan[0].id, stale] });
  });
  it('no usable push → schedule the plan, cancel only stale rental ids', () => {
    expect(reconcileRentalFallbacks([plan[0].id, stale, 918273], plan, false)).toEqual({ toSchedule: plan, toCancel: [stale] });
  });
});

describe('deep links are internal-only', () => {
  it('accepts app paths; rejects external, protocol-relative, backslash and non-strings', () => {
    expect(safeInternalPath('/rental-return/rs-1')).toBe('/rental-return/rs-1');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil', 'javascript:alert(1)', 42, null]) {
      expect(safeInternalPath(bad)).toBeNull();
    }
  });
});

// ── native sync with mocked plugins ─────────────────────────────────────────
const pending: { notifications: { id: number }[] } = { notifications: [] };
const schedule = vi.fn(async (_o: unknown) => {});
const cancel = vi.fn(async (_o: unknown) => {});
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    getPending: async () => pending,
    schedule: (o: unknown) => schedule(o),
    cancel: (o: unknown) => cancel(o),
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
  },
}));
const os = { perm: true, optedIn: true, token: 'tok' as string | null, externalId: 'u1' as string | null };
vi.mock('@onesignal/capacitor-plugin', () => ({
  default: {
    Notifications: { hasPermission: async () => os.perm },
    User: {
      getExternalId: async () => os.externalId,
      pushSubscription: { getOptedInAsync: async () => os.optedIn, getTokenAsync: async () => os.token },
    },
  },
}));
const iosPerm = { receive: 'granted' };
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: { checkPermissions: async () => iosPerm } }));

describe('syncRentalReturnFallbacks (native)', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    vi.clearAllMocks();
    pending.notifications = [];
    Object.assign(os, { perm: true, optedIn: true, token: 'tok', externalId: 'u1' });
    iosPerm.receive = 'granted';
    store.clear();
    (globalThis as { window?: unknown }).window = { Capacitor: {} };
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  const sync = async (platform: 'ios' | 'android', tz = 'America/New_York') => {
    const prev = process.env.TZ; process.env.TZ = tz;
    try {
      const { syncRentalReturnFallbacks } = await import('@/lib/rentalReminder');
      await syncRentalReturnFallbacks([ONE_WAY], { userId: 'u1', platform }, NOW);
    } finally { process.env.TZ = prev; }
  };
  const scheduledAt = () => ((schedule.mock.calls[0][0] as { notifications: { schedule: { at: Date } }[] }).notifications[0].schedule.at).toISOString();

  it('Android with usable push (permission + opted in + token + this external id) → server push only, no local', async () => {
    pending.notifications = [{ id: rentalReturnNotificationId('rs-oneway') }];
    await sync('android');
    expect(schedule).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith({ notifications: [{ id: rentalReturnNotificationId('rs-oneway') }] });
  });

  it.each([
    ['no permission',        { perm: false }],
    ['not opted in',         { optedIn: false }],
    ['no token yet',         { token: null }],
    ['other external id',    { externalId: 'someone-else' }],
  ])('Android NOT usable (%s) → local fallback from the UTC instant', async (_n, patch) => {
    Object.assign(os, patch);
    await sync('android');
    expect(scheduledAt()).toBe('2026-10-08T12:00:00.000Z');
  });

  it('iOS: granted + registered for this user → no local; unregistered → local fallback', async () => {
    store.set('gc_ios_push_registered_user', 'u1');
    await sync('ios');
    expect(schedule).not.toHaveBeenCalled();
    store.clear();
    await sync('ios');
    expect(scheduledAt()).toBe('2026-10-08T12:00:00.000Z');
  });

  it('the scheduled instant is identical whatever this device timezone is', async () => {
    Object.assign(os, { token: null });
    await sync('android', 'America/Los_Angeles');
    const la = scheduledAt();
    schedule.mockClear();
    await sync('android', 'Asia/Tokyo');
    expect(scheduledAt()).toBe(la);
  });

  it('each scheduled fallback deep-links to its rental', async () => {
    Object.assign(os, { token: null });
    await sync('android');
    const n = (schedule.mock.calls[0][0] as { notifications: { id: number; extra: { url: string } }[] }).notifications[0];
    expect(n.extra.url).toBe('/rental-return/rs-oneway');
    expect(n.id).toBe(rentalReturnNotificationId('rs-oneway'));
  });
});

describe('EV calculator reminder keeps its own id', () => {
  beforeEach(() => { vi.clearAllMocks(); (globalThis as { window?: unknown }).window = { Capacitor: {} }; });
  afterEach(() => { delete (globalThis as { window?: unknown }).window; });
  it('schedules with 918273, outside the Rental Mode range', async () => {
    const { scheduleRentalReturnReminder } = await import('@/lib/rentalReminder');
    const d = new Date(Date.now() + 5 * 3_600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    await scheduleRentalReturnReminder(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`, { isEv: true });
    const id = (schedule.mock.calls[0][0] as { notifications: { id: number }[] }).notifications[0].id;
    expect(id).toBe(918273);
    expect(isRentalReturnNotificationId(id)).toBe(false);
  });
});

/**
 * Gas station geofencing — registers proximity alerts using
 * @capacitor-community/background-geolocation.
 *
 * iOS: requires "Always" location permission for background delivery.
 * Android: requires ACCESS_BACKGROUND_LOCATION.
 * Web: silently no-ops.
 *
 * Max 5 active geofences (well under iOS 20-region limit).
 */

const STORAGE_KEY  = 'gc_geofences';
const MAX_FENCES   = 5;
const RADIUS_M     = 200;

export interface StationGeofence {
  id:        string;   // placeId
  name:      string;
  lat:       number;
  lng:       number;
  price?:    number;   // $/gal at time of registration
  grade?:    string;
  addedAt:   number;   // Date.now()
}

function isNative(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).Capacitor;
}

async function getPlugin() {
  if (!isNative()) return null;
  try {
    // This plugin registers itself on the Capacitor bridge at runtime;
    // the JS layer is accessed via registerPlugin from core.
    const { registerPlugin } = await import('@capacitor/core');
    type BgGeoPlugin = {
      addWatcher: (opts: Record<string, unknown>, cb: (pos: { latitude: number; longitude: number } | null, err: Error | null) => void) => Promise<string>;
      removeWatcher: (opts: { id: string }) => Promise<void>;
    };
    return registerPlugin<BgGeoPlugin>('BackgroundGeolocation');
  } catch {
    return null;
  }
}

// ── Persisted fence list ───────────────────────────────────────────────────────

export function getActiveGeofences(): StationGeofence[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as StationGeofence[];
  } catch {
    return [];
  }
}

function saveGeofences(fences: StationGeofence[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fences)); } catch { /* ignore */ }
}

// ── Plugin watcher (singleton) ────────────────────────────────────────────────

let watcherId: string | null = null;

async function ensureWatcher() {
  const plugin = await getPlugin();
  if (!plugin || watcherId) return;

  watcherId = await plugin.addWatcher(
    {
      backgroundMessage:   'GasCap is checking for nearby stations.',
      backgroundTitle:     'GasCap Location',
      requestPermissions:  true,
      stale:               false,
      distanceFilter:      50, // metres between updates
    },
    (position: { latitude: number; longitude: number } | null, error: Error | null) => {
      if (error || !position) return;
      checkProximity(position.latitude, position.longitude);
    },
  );
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const NOTIFIED_KEY = 'gc_geo_notified';
function recentlyNotified(id: string): boolean {
  try {
    const map = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '{}') as Record<string, number>;
    const last = map[id] ?? 0;
    return Date.now() - last < 3_600_000; // 1 hour cooldown per station
  } catch { return false; }
}
function markNotified(id: string) {
  try {
    const map = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '{}') as Record<string, number>;
    map[id] = Date.now();
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

async function checkProximity(lat: number, lng: number) {
  const fences = getActiveGeofences();
  for (const fence of fences) {
    const dist = haversineM(lat, lng, fence.lat, fence.lng);
    if (dist <= RADIUS_M && !recentlyNotified(fence.id)) {
      markNotified(fence.id);
      await fireStationNotification(fence);
    }
  }
}

async function fireStationNotification(fence: StationGeofence) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const priceStr = fence.price ? `$${fence.price.toFixed(2)}/gal` : 'prices nearby';
    await LocalNotifications.schedule({
      notifications: [{
        id:    Math.floor(Math.random() * 100000),
        title: `⛽ ${fence.name}`,
        body:  `${priceStr} — tap to calculate your fill-up`,
        extra: { tab: 'gas', stationId: fence.id },
      }],
    });
  } catch { /* push not available */ }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function registerStationGeofence(station: {
  id: string; name: string; lat: number; lng: number; price?: number; grade?: string;
}): Promise<void> {
  if (!isNative()) return;

  let fences = getActiveGeofences().filter((f) => f.id !== station.id);

  // Keep only the 4 most recent + the new one
  if (fences.length >= MAX_FENCES) {
    fences = fences.sort((a, b) => b.addedAt - a.addedAt).slice(0, MAX_FENCES - 1);
  }

  fences.push({ ...station, addedAt: Date.now() });
  saveGeofences(fences);

  await ensureWatcher();
}

export async function clearStationGeofences(): Promise<void> {
  saveGeofences([]);
  const plugin = await getPlugin();
  if (plugin && watcherId) {
    await plugin.removeWatcher({ id: watcherId }).catch(() => {});
    watcherId = null;
  }
}

export function isStationGeofenced(placeId: string): boolean {
  return getActiveGeofences().some((f) => f.id === placeId);
}

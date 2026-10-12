'use client';

/**
 * GasCap™ — one-shot "use my current location" for the Trip Planner.
 *
 * Follows the same native-vs-web pattern already proven in
 * components/NearbyStations.tsx (Capacitor's coarseLocation permission
 * check+request on native — navigator.geolocation.getCurrentPosition()
 * never fires in WKWebView remote-server mode — else the plain web API),
 * but written as a small standalone function rather than extracted from
 * that component: NearbyStations' version is tightly coupled to its own
 * fetch-cancellation/staleness state and a one-shot "get my location now"
 * call doesn't need that machinery.
 *
 * Coordinates returned here are never persisted — the caller holds them in
 * component state for the current planning session only.
 */
import { Geolocation } from '@capacitor/geolocation';

export type CurrentLocationResult =
  | { status: 'granted';     latitude: number; longitude: number }
  | { status: 'denied' }
  | { status: 'unavailable' }
  | { status: 'timeout' }
  | { status: 'unsupported' };

export async function requestCurrentLocation(isNative: boolean): Promise<CurrentLocationResult> {
  if (isNative) {
    let permStatus: string;
    try {
      permStatus = (await Geolocation.checkPermissions()).coarseLocation;
    } catch {
      permStatus = 'unknown';
    }

    if (permStatus === 'denied') return { status: 'denied' };

    if (permStatus !== 'granted') {
      try {
        const req = await Geolocation.requestPermissions({ permissions: ['coarseLocation'] });
        if (req.coarseLocation === 'denied') return { status: 'denied' };
      } catch {
        // Continue — getCurrentPosition below fails with a clear error if really denied.
      }
    }

    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000 });
      return { status: 'granted', latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : '';
      if (msg.includes('denied')) return { status: 'denied' };
      if (msg.includes('timeout') || msg.includes('timed out')) return { status: 'timeout' };
      return { status: 'unavailable' };
    }
  }

  if (!navigator.geolocation) return { status: 'unsupported' };

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ status: 'granted', latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) resolve({ status: 'denied' });
        else if (err.code === err.TIMEOUT) resolve({ status: 'timeout' });
        else resolve({ status: 'unavailable' });
      },
      { timeout: 10000, maximumAge: 300_000, enableHighAccuracy: false },
    );
  });
}

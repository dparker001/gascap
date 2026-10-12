/**
 * Trip Planner Phase 2 — "Use my current location". Covers the four
 * explicit failure states Don's brief required (denied / unavailable /
 * timeout / unsupported) plus success, on both the web and native paths.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const checkPermissions = vi.fn();
const requestPermissions = vi.fn();
const getCurrentPosition = vi.fn();
vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions: (...a: unknown[]) => checkPermissions(...a),
    requestPermissions: (...a: unknown[]) => requestPermissions(...a),
    getCurrentPosition: (...a: unknown[]) => getCurrentPosition(...a),
  },
}));

let requestCurrentLocation: typeof import('@/lib/currentLocation').requestCurrentLocation;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('@/lib/currentLocation');
  requestCurrentLocation = mod.requestCurrentLocation;
});

describe('requestCurrentLocation — native (Capacitor) path', () => {
  it('1. already-granted permission resolves coordinates directly', async () => {
    checkPermissions.mockResolvedValue({ coarseLocation: 'granted' });
    getCurrentPosition.mockResolvedValue({ coords: { latitude: 28.5, longitude: -81.4 } });
    const result = await requestCurrentLocation(true);
    expect(result).toEqual({ status: 'granted', latitude: 28.5, longitude: -81.4 });
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('2. previously-denied permission resolves denied without prompting again', async () => {
    checkPermissions.mockResolvedValue({ coarseLocation: 'denied' });
    const result = await requestCurrentLocation(true);
    expect(result).toEqual({ status: 'denied' });
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('3. not-yet-decided permission requests it, denies if the user declines the prompt', async () => {
    checkPermissions.mockResolvedValue({ coarseLocation: 'prompt' });
    requestPermissions.mockResolvedValue({ coarseLocation: 'denied' });
    const result = await requestCurrentLocation(true);
    expect(result).toEqual({ status: 'denied' });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('4. not-yet-decided permission requests it, proceeds to getCurrentPosition if granted', async () => {
    checkPermissions.mockResolvedValue({ coarseLocation: 'prompt' });
    requestPermissions.mockResolvedValue({ coarseLocation: 'granted' });
    getCurrentPosition.mockResolvedValue({ coords: { latitude: 1, longitude: 2 } });
    const result = await requestCurrentLocation(true);
    expect(result).toEqual({ status: 'granted', latitude: 1, longitude: 2 });
  });

  it('5. getCurrentPosition rejecting with a "denied" message maps to denied', async () => {
    checkPermissions.mockResolvedValue({ coarseLocation: 'granted' });
    getCurrentPosition.mockRejectedValue(new Error('Location denied by user'));
    const result = await requestCurrentLocation(true);
    expect(result).toEqual({ status: 'denied' });
  });

  it('6. getCurrentPosition rejecting with a timeout message maps to timeout', async () => {
    checkPermissions.mockResolvedValue({ coarseLocation: 'granted' });
    getCurrentPosition.mockRejectedValue(new Error('Request timed out'));
    const result = await requestCurrentLocation(true);
    expect(result).toEqual({ status: 'timeout' });
  });

  it('7. any other getCurrentPosition failure maps to unavailable (never invents coordinates)', async () => {
    checkPermissions.mockResolvedValue({ coarseLocation: 'granted' });
    getCurrentPosition.mockRejectedValue(new Error('GPS hardware error'));
    const result = await requestCurrentLocation(true);
    expect(result).toEqual({ status: 'unavailable' });
  });
});

describe('requestCurrentLocation — web path', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('8. unsupported browser (no navigator.geolocation) resolves unsupported', async () => {
    vi.stubGlobal('navigator', {});
    const result = await requestCurrentLocation(false);
    expect(result).toEqual({ status: 'unsupported' });
  });

  it('9. success resolves coordinates', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: (p: { coords: { latitude: number; longitude: number } }) => void) =>
          success({ coords: { latitude: 10, longitude: 20 } }),
      },
    });
    const result = await requestCurrentLocation(false);
    expect(result).toEqual({ status: 'granted', latitude: 10, longitude: 20 });
  });

  it('10. PERMISSION_DENIED error code resolves denied', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (
          _success: unknown,
          error: (e: { code: number; PERMISSION_DENIED: number; TIMEOUT: number }) => void,
        ) => error({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 }),
      },
    });
    const result = await requestCurrentLocation(false);
    expect(result).toEqual({ status: 'denied' });
  });

  it('11. TIMEOUT error code resolves timeout', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (
          _success: unknown,
          error: (e: { code: number; PERMISSION_DENIED: number; TIMEOUT: number }) => void,
        ) => error({ code: 3, PERMISSION_DENIED: 1, TIMEOUT: 3 }),
      },
    });
    const result = await requestCurrentLocation(false);
    expect(result).toEqual({ status: 'timeout' });
  });

  it('12. POSITION_UNAVAILABLE (or any other code) resolves unavailable', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (
          _success: unknown,
          error: (e: { code: number; PERMISSION_DENIED: number; TIMEOUT: number }) => void,
        ) => error({ code: 2, PERMISSION_DENIED: 1, TIMEOUT: 3 }),
      },
    });
    const result = await requestCurrentLocation(false);
    expect(result).toEqual({ status: 'unavailable' });
  });
});

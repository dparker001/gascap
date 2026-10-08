/**
 * Phase 1 P1-A — server-side platform attribution. 'unknown' must remain the
 * answer whenever the platform genuinely cannot be determined.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { originPlatformFromUserAgent, originPlatformFromRequest } from '../lib/originPlatform';

const UA = {
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  desktopSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  iosSafari:     'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosChrome:     'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
  iosWebViewNoMarker: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iosShell:      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GasCapiOS',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidWebView:'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36',
  androidShell:  'GasCapAndroid',
};

describe('originPlatformFromUserAgent', () => {
  it('identifies the native shells by their User-Agent marker', () => {
    expect(originPlatformFromUserAgent(UA.iosShell)).toBe('ios');
    expect(originPlatformFromUserAgent(UA.androidShell)).toBe('android');
  });
  it('identifies standalone browsers as web', () => {
    expect(originPlatformFromUserAgent(UA.desktopChrome)).toBe('web');
    expect(originPlatformFromUserAgent(UA.desktopSafari)).toBe('web');
    expect(originPlatformFromUserAgent(UA.iosSafari)).toBe('web');
    expect(originPlatformFromUserAgent(UA.iosChrome)).toBe('web');
    expect(originPlatformFromUserAgent(UA.androidChrome)).toBe('web');
  });
  it('does NOT guess for ambiguous or missing agents', () => {
    expect(originPlatformFromUserAgent(UA.iosWebViewNoMarker)).toBe('unknown');
    expect(originPlatformFromUserAgent(UA.androidWebView)).toBe('unknown');
    expect(originPlatformFromUserAgent('curl/8.4.0')).toBe('unknown');
    expect(originPlatformFromUserAgent('')).toBe('unknown');
    expect(originPlatformFromUserAgent(null)).toBe('unknown');
    expect(originPlatformFromUserAgent(undefined)).toBe('unknown');
  });
  it('originPlatformFromRequest reads the header and never throws', () => {
    expect(originPlatformFromRequest(new Request('https://x.test', { headers: { 'user-agent': UA.iosShell } }))).toBe('ios');
    expect(originPlatformFromRequest(new Request('https://x.test'))).toBe('unknown');
  });
});

// ── The real write paths take the platform, and default to unknown ──────────
const vehicleCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...args.data }));
const fillupCreate  = vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...args.data }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    vehicle: { create: (a: { data: Record<string, unknown> }) => vehicleCreate(a) },
    fillup:  { create: (a: { data: Record<string, unknown> }) => fillupCreate(a) },
  },
}));
const recordAnalyticsEvent = vi.fn(async (..._a: unknown[]) => ({ outcome: 'written' as const, id: 'e1' }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])) }));

describe('server events carry the supplied platform', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('vehicle_saved uses the supplied platform', async () => {
    const { addVehicle } = await import('@/lib/savedVehicles');
    await addVehicle('u1', 'Car', 12, undefined, { originPlatform: 'ios' });
    expect((recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>).originPlatform).toBe('ios');
  });
  it('vehicle_saved stays unknown when none is supplied', async () => {
    const { addVehicle } = await import('@/lib/savedVehicles');
    await addVehicle('u1', 'Car', 12);
    expect((recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>).originPlatform).toBe('unknown');
  });
  it('fillup_logged uses the supplied platform and stays unknown otherwise', async () => {
    const { addFillup } = await import('@/lib/fillups');
    const base = { vehicleName: 'Car', date: '2026-10-01', gallonsPumped: 10, pricePerGallon: 3.5 };
    await addFillup('u1', base, { originPlatform: 'android' });
    expect((recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>).originPlatform).toBe('android');
    recordAnalyticsEvent.mockClear();
    await addFillup('u1', base);
    expect((recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>).originPlatform).toBe('unknown');
  });
});

/**
 * Growth Sprint 1, P0C-2A — regression coverage for lib/clientAnalytics.ts,
 * the fire-and-forget client-side writer into the public/untrusted
 * AnalyticsEvent ingest route (app/api/analytics/event/route.ts).
 *
 * Covers: originPlatform derivation (web/ios/android via the authoritative
 * hooks/useIsNative.ts detector, never a second UA-sniffing
 * implementation), the exact request-body shape (no userId/provider/
 * emitter/billing/idempotencyKey — those are not client-controlled fields
 * on this route), metadata omission vs. presence, and that neither a
 * network failure nor a platform-detection/serialization failure ever
 * propagates to the caller.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const detectNativePlatform = vi.fn((): 'ios' | 'android' | null => null);
vi.mock('@/hooks/useIsNative', () => ({
  detectNativePlatform: (...a: unknown[]) => detectNativePlatform(...(a as [])),
}));

const fetchMock = vi.fn(async (..._a: unknown[]) => ({ ok: true }) as unknown);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  detectNativePlatform.mockReturnValue(null);
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
});

async function loadHelper() {
  const { trackClientEvent } = await import('@/lib/clientAnalytics');
  return trackClientEvent;
}

function lastCallBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

describe('trackClientEvent()', () => {
  it('RFA1. web platform — detectNativePlatform() null → originPlatform=web', async () => {
    const trackClientEvent = await loadHelper();
    trackClientEvent('rental_assistant_opened');
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastCallBody().originPlatform).toBe('web');
  });

  it('RFA2. ios — originPlatform=ios', async () => {
    detectNativePlatform.mockReturnValue('ios');
    const trackClientEvent = await loadHelper();
    trackClientEvent('rental_assistant_opened');
    await Promise.resolve();

    expect(lastCallBody().originPlatform).toBe('ios');
  });

  it('RFA3. android — originPlatform=android', async () => {
    detectNativePlatform.mockReturnValue('android');
    const trackClientEvent = await loadHelper();
    trackClientEvent('rental_assistant_opened');
    await Promise.resolve();

    expect(lastCallBody().originPlatform).toBe('android');
  });

  it('RFA4. request body never contains userId/emitter/provider/idempotencyKey', async () => {
    const trackClientEvent = await loadHelper();
    trackClientEvent('rental_setup_step_viewed', { step: 3 });
    await Promise.resolve();

    const body = lastCallBody();
    expect(body).not.toHaveProperty('userId');
    expect(body).not.toHaveProperty('emitter');
    expect(body).not.toHaveProperty('provider');
    expect(body).not.toHaveProperty('idempotencyKey');
    expect(Object.keys(body).sort()).toEqual(['eventType', 'metadata', 'originPlatform']);
  });

  it('RFA5. metadata omitted when not supplied', async () => {
    const trackClientEvent = await loadHelper();
    trackClientEvent('rental_setup_started');
    await Promise.resolve();

    const body = lastCallBody();
    expect(body).not.toHaveProperty('metadata');
    expect(Object.keys(body).sort()).toEqual(['eventType', 'originPlatform']);
  });

  it('RFA6. metadata {step:1} serialized correctly', async () => {
    const trackClientEvent = await loadHelper();
    trackClientEvent('rental_setup_step_viewed', { step: 1 });
    await Promise.resolve();

    expect(lastCallBody().metadata).toEqual({ step: 1 });
  });

  it('RFA7. fetch rejection is swallowed — no unhandled rejection, no throw', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const trackClientEvent = await loadHelper();

    expect(() => trackClientEvent('rental_assistant_opened')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('RFA8. platform-detection failure is swallowed — caller does not throw', async () => {
    detectNativePlatform.mockImplementation(() => { throw new Error('window unavailable'); });
    const trackClientEvent = await loadHelper();

    expect(() => trackClientEvent('rental_assistant_opened')).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Bonus. request uses same-origin POST with JSON content-type and keepalive', async () => {
    const trackClientEvent = await loadHelper();
    trackClientEvent('rental_assistant_opened');
    await Promise.resolve();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/analytics/event');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.keepalive).toBe(true);
  });

  it('Bonus. eventType is passed through exactly', async () => {
    const trackClientEvent = await loadHelper();
    trackClientEvent('rental_fuel_needed_calculated');
    await Promise.resolve();

    expect(lastCallBody().eventType).toBe('rental_fuel_needed_calculated');
  });
});

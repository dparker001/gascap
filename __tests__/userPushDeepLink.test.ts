/**
 * sendUserPush — iOS pushes must carry the deep-link `url` (2026-10-02).
 * NativePushRegistration navigates to notification.data.url on tap; without
 * it in the APNs payload, tapping e.g. a rental pickup reminder only opened
 * the home screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendApns = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock('@/lib/apns', () => ({ sendApns: (...a: unknown[]) => sendApns(...a), apnsConfigured: () => true }));
vi.mock('@/lib/oneSignal', () => ({ sendPushNotification: vi.fn(async () => ({})) }));
vi.mock('@/lib/users', () => ({ findById: vi.fn(async () => ({ id: 'u1', iosPushToken: 'tok-123' })) }));

beforeEach(() => { sendApns.mockClear(); });

describe('sendUserPush iOS deep link', () => {
  it('puts the url in the APNs payload data', async () => {
    const { sendUserPush } = await import('@/lib/userPush');
    await sendUserPush('u1', 'Pickup tomorrow', 'Record your pickup fuel', '/rental-return/rs-9');
    expect(sendApns).toHaveBeenCalledWith('tok-123', 'Pickup tomorrow', 'Record your pickup fuel', { url: '/rental-return/rs-9' });
  });

  it('defaults to the home path when no url is given', async () => {
    const { sendUserPush } = await import('@/lib/userPush');
    await sendUserPush('u1', 't', 'b');
    expect(sendApns).toHaveBeenCalledWith('tok-123', 't', 'b', { url: '/' });
  });
});

/**
 * Phase 4B — app/api/user/profile GET/PATCH coverage for the new global
 * fuelGaugeStyle preference. No real Prisma call is made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-1', email: 'buyer@example.com' } })) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ghl', () => ({ upsertGhlContact: vi.fn(async () => {}), removeGhlTags: vi.fn(async () => {}) }));

const findById = vi.fn(async (_id?: string) => ({
  id: 'user-1', email: 'buyer@example.com', name: 'Test', displayName: '', phone: '',
  smsOptIn: false, avatarUrl: '', preferredFillLevel: null, monthlyFuelBudget: null,
  userMode: null, fuelGaugeStyle: 'vertical_curved_needle',
}) as unknown);
const updateUserProfile = vi.fn(async (_userId: string, fields: Record<string, unknown>) => ({
  id: 'user-1', email: 'buyer@example.com', name: 'Test', displayName: '', smsOptIn: false, ...fields,
}) as unknown);
vi.mock('@/lib/users', () => ({
  findById: (id: string) => findById(id),
  updateUserProfile: (userId: string, fields: Record<string, unknown>) => updateUserProfile(userId, fields),
}));

function req(body: Record<string, unknown>) {
  return new Request('https://www.gascap.app/api/user/profile', { method: 'PATCH', body: JSON.stringify(body) });
}

beforeEach(() => { vi.clearAllMocks(); findById.mockResolvedValue({
  id: 'user-1', email: 'buyer@example.com', name: 'Test', displayName: '', phone: '',
  smsOptIn: false, avatarUrl: '', preferredFillLevel: null, monthlyFuelBudget: null,
  userMode: null, fuelGaugeStyle: 'vertical_curved_needle',
}); });

describe('GET /api/user/profile — Phase 4B fuelGaugeStyle', () => {
  it('returns the stored global gauge style', async () => {
    const { GET } = await import('@/app/api/user/profile/route');
    const res = await GET(new Request('https://www.gascap.app/api/user/profile') as any);
    const body = await res.json();
    expect(body.fuelGaugeStyle).toBe('vertical_curved_needle');
  });

  it('returns null when the user has no explicit preference', async () => {
    findById.mockResolvedValue({ id: 'user-1', email: 'e', name: 'n', smsOptIn: false, fuelGaugeStyle: null });
    const { GET } = await import('@/app/api/user/profile/route');
    const res = await GET(new Request('https://www.gascap.app/api/user/profile') as any);
    const body = await res.json();
    expect(body.fuelGaugeStyle).toBeNull();
  });
});

describe('PATCH /api/user/profile — Phase 4B fuelGaugeStyle', () => {
  it('accepts a valid canonical style', async () => {
    const { PATCH } = await import('@/app/api/user/profile/route');
    const res = await PATCH(req({ fuelGaugeStyle: 'vertical_curved_segments' }) as any);
    expect(res.status).toBe(200);
    expect(updateUserProfile).toHaveBeenCalledWith('user-1', expect.objectContaining({ fuelGaugeStyle: 'vertical_curved_segments' }));
  });

  it('accepts null to clear the explicit preference', async () => {
    const { PATCH } = await import('@/app/api/user/profile/route');
    const res = await PATCH(req({ fuelGaugeStyle: null }) as any);
    expect(res.status).toBe(200);
    expect(updateUserProfile).toHaveBeenCalledWith('user-1', expect.objectContaining({ fuelGaugeStyle: null }));
  });

  it('rejects an unrecognized style string rather than silently coercing it', async () => {
    const { PATCH } = await import('@/app/api/user/profile/route');
    const res = await PATCH(req({ fuelGaugeStyle: 'digital_percentage' }) as any);
    expect(res.status).toBe(400);
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it('leaves fuelGaugeStyle untouched when the field is omitted entirely', async () => {
    const { PATCH } = await import('@/app/api/user/profile/route');
    const res = await PATCH(req({ displayName: 'New Name' }) as any);
    expect(res.status).toBe(200);
    const call = updateUserProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(call.fuelGaugeStyle).toBeUndefined();
  });
});

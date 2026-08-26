/**
 * Phase 5C — admin communication counts must be scoped to the specific
 * Campaign being viewed, via CampaignCommunication.groupBy({where:{campaignId}}).
 * Regression coverage for the correctness audit's Issue 1 (a global EmailLog
 * count would have bled Campaign A's sends into Campaign B's report).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/adminAuth', () => ({
  sessionHasAdminRole: vi.fn(async () => true),
  legacyAdminPasswordOk: vi.fn(() => false),
}));

const groupBy = vi.fn(async ({ where }: any) => {
  // Only ever return rows for the campaign actually asked for — proves the
  // route passes campaignId through rather than aggregating globally.
  if (where.campaignId !== 'camp-B') return [];
  return [{ kind: 'invite_email', state: 'sent', _count: { _all: 3 } }];
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(async ({ where }: any) => (where.key === 'camp-B-key' ? { id: 'camp-B', key: 'camp-B-key', name: 'B', startsAt: new Date(), endsAt: null, drawingAt: null, timezone: 'America/New_York' } : null)),
      findFirst: vi.fn(async () => null),
    },
    campaignParticipation: { count: vi.fn(async () => 0) },
    drawingEntry: { count: vi.fn(async () => 0) },
    feedbackResponse: { findMany: vi.fn(async () => []) },
    campaignCommunication: { groupBy },
  },
}));

function req(url: string) {
  return new Request(url);
}

describe('GET /api/admin/feedback-campaign — communication counts are campaign-scoped', () => {
  it('only returns communication counts for the requested campaign, never another one', async () => {
    const { GET } = await import('@/app/api/admin/feedback-campaign/route');
    const res = await GET(req('https://www.gascap.app/api/admin/feedback-campaign?key=camp-B-key'));
    const body = await res.json();
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: 'camp-B' } }));
    expect(body.communications.invite_email.sent).toBe(3);
  });
});

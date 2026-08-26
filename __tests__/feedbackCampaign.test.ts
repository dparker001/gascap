/**
 * Phase 5A — Feedback Campaign foundation (lib/feedbackCampaign.ts).
 * In-memory Prisma mock, same pattern as __tests__/rentalFillups.test.ts —
 * simulates the (campaignId, userId) unique constraints on
 * FeedbackResponse/DrawingEntry with a real P2002 throw from create().
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface CampaignRow { id: string; key: string; startsAt: Date; endsAt: Date | null; timezone: string }
interface UserRow { id: string; createdAt: string; calcCount: number; activeDays: string[] }
interface ParticipationRow {
  id: string; campaignId: string; userId: string;
  eligibleAt: Date | null; inviteShownAt: Date | null; openedAt: Date | null; startedAt: Date | null;
  submittedAt: Date | null; drawingEntryGrantedAt: Date | null;
}
interface ResponseRow { id: string; campaignId: string; userId: string; [k: string]: unknown }
interface EntryRow { id: string; campaignId: string; userId: string; kind: string; source: string | null }

class PrismaClientKnownRequestError extends Error {
  code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}

let idCounter = 0;
const campaigns: CampaignRow[] = [];
const users = new Map<string, UserRow>();
const fillups = new Map<string, number>();   // userId -> count
const vehicles = new Map<string, number>();
const rentalSessions = new Map<string, number>();
const participations: ParticipationRow[] = [];
const responses: ResponseRow[] = [];
const entries: EntryRow[] = [];

function reset() {
  idCounter = 0;
  campaigns.length = 0; participations.length = 0; responses.length = 0; entries.length = 0;
  users.clear(); fillups.clear(); vehicles.clear(); rentalSessions.clear();
}

function findParticipation(campaignId: string, userId: string) {
  return participations.find((p) => p.campaignId === campaignId && p.userId === userId);
}

const prismaMock = {
  campaign: {
    findFirst: vi.fn(async ({ where }: any) => {
      const now: Date = where.startsAt.lte;
      const matches = campaigns.filter((c) => c.startsAt <= now && (c.endsAt == null || c.endsAt >= now));
      matches.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
      return matches[0] ?? null;
    }),
  },
  user: {
    findUnique: vi.fn(async ({ where }: any) => users.get(where.id) ?? null),
  },
  fillup: { count: vi.fn(async ({ where }: any) => fillups.get(where.userId) ?? 0) },
  vehicle: { count: vi.fn(async ({ where }: any) => vehicles.get(where.userId) ?? 0) },
  rentalSession: { count: vi.fn(async ({ where }: any) => rentalSessions.get(where.userId) ?? 0) },
  campaignParticipation: {
    findUnique: vi.fn(async ({ where }: any) => findParticipation(where.campaignId_userId.campaignId, where.campaignId_userId.userId) ?? null),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const existing = findParticipation(where.campaignId_userId.campaignId, where.campaignId_userId.userId);
      if (existing) { Object.assign(existing, update); return existing; }
      const row: ParticipationRow = {
        id: `part-${++idCounter}`, campaignId: create.campaignId, userId: create.userId,
        eligibleAt: null, inviteShownAt: null, openedAt: null, startedAt: null, submittedAt: null, drawingEntryGrantedAt: null,
        ...create,
      };
      participations.push(row);
      return row;
    }),
  },
  feedbackResponse: {
    create: vi.fn(async ({ data }: any) => {
      if (responses.some((r) => r.campaignId === data.campaignId && r.userId === data.userId)) {
        throw new PrismaClientKnownRequestError('unique violation', 'P2002');
      }
      const row: ResponseRow = { id: `resp-${++idCounter}`, ...data };
      responses.push(row);
      return row;
    }),
    findMany: vi.fn(async ({ where }: any) => responses.filter((r) => r.campaignId === where.campaignId)),
  },
  drawingEntry: {
    create: vi.fn(async ({ data }: any) => {
      if (entries.some((e) => e.campaignId === data.campaignId && e.userId === data.userId)) {
        throw new PrismaClientKnownRequestError('unique violation', 'P2002');
      }
      const row: EntryRow = { id: `entry-${++idCounter}`, ...data };
      entries.push(row);
      return row;
    }),
  },
  $transaction: vi.fn(async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock)),
};

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/generated/prisma/client', () => ({ Prisma: { PrismaClientKnownRequestError } }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: vi.fn(async () => ({ outcome: 'written', id: 'evt' })) }));

const {
  getActiveCampaign, getFeedbackStatus, submitFeedback,
} = await import('@/lib/feedbackCampaign');

const NOW = new Date('2026-09-15T00:00:00.000Z');

function addCampaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  const row: CampaignRow = {
    id: `camp-${++idCounter}`, key: 'feedback_2026_q3',
    startsAt: new Date('2026-09-01T00:00:00.000Z'), endsAt: new Date('2026-09-30T23:59:59.000Z'),
    timezone: 'America/New_York', ...overrides,
  };
  campaigns.push(row);
  return row;
}

function addUser(id: string, overrides: Partial<UserRow> = {}) {
  users.set(id, { id, createdAt: '2026-09-01T00:00:00.000Z', calcCount: 0, activeDays: [], ...overrides });
}

const VALID_INPUT = {
  overallSatisfaction: 4,
  primaryFeature: 'fuel_calculator' as const,
  likes: 'The calculator',
  frustrations: 'Nothing much',
  hadIssue: false,
  improvementRequest: 'More charts',
  featureRequest: 'Widgets',
  pmfResponse: 'somewhat' as const,
};

describe('getActiveCampaign', () => {
  beforeEach(reset);

  it('finds the campaign whose window contains now', async () => {
    addCampaign();
    const c = await getActiveCampaign(NOW);
    expect(c?.key).toBe('feedback_2026_q3');
  });

  it('returns null when no campaign window contains now', async () => {
    addCampaign({ startsAt: new Date('2026-01-01'), endsAt: new Date('2026-01-31') });
    expect(await getActiveCampaign(NOW)).toBeNull();
  });
});

describe('getFeedbackStatus — eligibility rule', () => {
  beforeEach(reset);

  it('account <7 days old is not eligible even with usage', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-10T00:00:00.000Z', calcCount: 5 }); // 5 days old
    const status = await getFeedbackStatus('u1', NOW);
    expect(status.eligible).toBe(false);
  });

  it('>=7 days old + calcCount>=1 is eligible', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z', calcCount: 1 });
    expect((await getFeedbackStatus('u1', NOW)).eligible).toBe(true);
  });

  it('Fillup usage qualifies', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z' });
    fillups.set('u1', 1);
    expect((await getFeedbackStatus('u1', NOW)).eligible).toBe(true);
  });

  it('Vehicle usage qualifies', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z' });
    vehicles.set('u1', 1);
    expect((await getFeedbackStatus('u1', NOW)).eligible).toBe(true);
  });

  it('RentalSession usage qualifies', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z' });
    rentalSessions.set('u1', 1);
    const status = await getFeedbackStatus('u1', NOW);
    expect(status.eligible).toBe(true);
    expect(status.hasRentalUsage).toBe(true);
  });

  it('activeDays.length >= 3 qualifies', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z', activeDays: ['2026-09-01', '2026-09-02', '2026-09-03'] });
    expect((await getFeedbackStatus('u1', NOW)).eligible).toBe(true);
  });

  it('no usage at all is not eligible', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z' });
    expect((await getFeedbackStatus('u1', NOW)).eligible).toBe(false);
  });

  it('a user who already submitted is not re-eligible', async () => {
    const campaign = addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z', calcCount: 1 });
    await submitFeedback('u1', VALID_INPUT, NOW);
    const status = await getFeedbackStatus('u1', NOW);
    expect(status.eligible).toBe(false);
    expect(status.alreadySubmitted).toBe(true);
    void campaign;
  });
});

describe('submitFeedback — atomicity and idempotency', () => {
  beforeEach(reset);

  it('a valid first submission creates exactly one FeedbackResponse and one DrawingEntry', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z', calcCount: 1 });
    const result = await submitFeedback('u1', VALID_INPUT, NOW);
    expect(result.outcome).toBe('submitted');
    expect(responses).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('feedback_campaign');
  });

  it('a replayed/duplicate submit does not create a second response or entry', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z', calcCount: 1 });
    await submitFeedback('u1', VALID_INPUT, NOW);
    const second = await submitFeedback('u1', VALID_INPUT, NOW);
    expect(second.outcome).toBe('duplicate');
    expect(responses).toHaveLength(1);
    expect(entries).toHaveLength(1);
  });

  it('one FeedbackResponse per campaign/user even under a raw create() race (P2002)', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z', calcCount: 1 });
    await prismaMock.feedbackResponse.create({ data: { campaignId: campaigns[0].id, userId: 'u1' } as any });
    await expect(prismaMock.feedbackResponse.create({ data: { campaignId: campaigns[0].id, userId: 'u1' } as any }))
      .rejects.toThrow('unique violation');
  });

  it('one DrawingEntry per campaign/user even under a raw create() race (P2002)', async () => {
    addCampaign();
    await prismaMock.drawingEntry.create({ data: { campaignId: campaigns[0].id, userId: 'u1', kind: 'feedback_campaign', source: null } as any });
    await expect(prismaMock.drawingEntry.create({ data: { campaignId: campaigns[0].id, userId: 'u1', kind: 'feedback_campaign', source: null } as any }))
      .rejects.toThrow('unique violation');
  });

  it('rejects submission for an ineligible user', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-14T00:00:00.000Z' }); // 1 day old, no usage
    const result = await submitFeedback('u1', VALID_INPUT, NOW);
    expect(result.outcome).toBe('ineligible');
  });

  it('rejects submission with no active campaign', async () => {
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z', calcCount: 1 });
    const result = await submitFeedback('u1', VALID_INPUT, NOW);
    expect(result.outcome).toBe('campaign_closed');
  });

  it('rejects an invalid overallSatisfaction value', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z', calcCount: 1 });
    const result = await submitFeedback('u1', { ...VALID_INPUT, overallSatisfaction: 9 }, NOW);
    expect(result.outcome).toBe('invalid');
  });

  it('Rental questions are only accepted for a user with actual RentalSession usage', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z', calcCount: 1 }); // no rental usage
    const result = await submitFeedback('u1', { ...VALID_INPUT, rentalEaseScore: 5 }, NOW);
    expect(result.outcome).toBe('invalid');
  });

  it('Rental questions are accepted and stored for a user with RentalSession usage', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z' });
    rentalSessions.set('u1', 1);
    const result = await submitFeedback('u1', { ...VALID_INPUT, rentalEaseScore: 5, rentalHelpfulness: 'yes', rentalImprovement: 'nothing' }, NOW);
    expect(result.outcome).toBe('submitted');
    expect(responses[0].rentalEaseScore).toBe(5);
  });
});

describe('getFeedbackStatus — server-authoritative status endpoint data', () => {
  beforeEach(reset);

  it('reports campaign key, eligibility, and hasRentalUsage independent of client input', async () => {
    addCampaign();
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z' });
    rentalSessions.set('u1', 2);
    const status = await getFeedbackStatus('u1', NOW);
    expect(status).toMatchObject({ campaignKey: 'feedback_2026_q3', eligible: true, alreadySubmitted: false, hasRentalUsage: true });
  });

  it('returns eligible:false and no campaign key when no campaign is active', async () => {
    addUser('u1', { createdAt: '2026-09-01T00:00:00.000Z', calcCount: 1 });
    const status = await getFeedbackStatus('u1', NOW);
    expect(status.eligible).toBe(false);
    expect(status.campaignKey).toBeNull();
  });
});

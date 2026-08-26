/**
 * Phase 5B — post-feedback $9.99 Lifetime offer (lib/feedbackCampaign.ts's
 * getLifetimeOfferStatus/markLifetimeOfferRedeemStarted/
 * markLifetimeOfferConverted, plus the app/api/stripe/checkout server gate).
 * Self-contained in-memory Prisma mock, same pattern as
 * __tests__/feedbackCampaign.test.ts and __tests__/rentalFillups.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface CampaignRow { id: string; key: string; startsAt: Date; endsAt: Date | null; timezone: string }
interface UserRow {
  id: string; createdAt: string; calcCount: number; activeDays: string[];
  stripeInterval: string | null; revenueCatActive: boolean; revenueCatInterval: string | null;
}
interface ParticipationRow {
  id: string; campaignId: string; userId: string;
  eligibleAt: Date | null; inviteShownAt: Date | null; openedAt: Date | null; startedAt: Date | null;
  submittedAt: Date | null; drawingEntryGrantedAt: Date | null;
  lifetimeOfferShownAt: Date | null; lifetimeOfferExpiresAt: Date | null; lifetimeOfferConvertedAt: Date | null;
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
const fillups = new Map<string, number>();
const vehicles = new Map<string, number>();
const rentalSessions = new Map<string, number>();
const participations: ParticipationRow[] = [];
const responses: ResponseRow[] = [];
const entries: EntryRow[] = [];
const analyticsCalls: Array<{ eventType: string; idempotencyKey?: string | null }> = [];

function reset() {
  idCounter = 0;
  campaigns.length = 0; participations.length = 0; responses.length = 0; entries.length = 0;
  users.clear(); fillups.clear(); vehicles.clear(); rentalSessions.clear();
  analyticsCalls.length = 0;
}

function findParticipation(campaignId: string, userId: string) {
  return participations.find((p) => p.campaignId === campaignId && p.userId === userId);
}
function newParticipation(overrides: Partial<ParticipationRow>): ParticipationRow {
  return {
    id: `part-${++idCounter}`, campaignId: '', userId: '',
    eligibleAt: null, inviteShownAt: null, openedAt: null, startedAt: null,
    submittedAt: null, drawingEntryGrantedAt: null,
    lifetimeOfferShownAt: null, lifetimeOfferExpiresAt: null, lifetimeOfferConvertedAt: null,
    ...overrides,
  };
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
    findFirst: vi.fn(async ({ where }: any) => {
      const matches = participations.filter((p) => p.userId === where.userId && p.submittedAt != null);
      matches.sort((a, b) => (b.submittedAt as Date).getTime() - (a.submittedAt as Date).getTime());
      return matches[0] ?? null;
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const existing = findParticipation(where.campaignId_userId.campaignId, where.campaignId_userId.userId);
      if (existing) { Object.assign(existing, update); return existing; }
      const row = newParticipation({ campaignId: create.campaignId, userId: create.userId, ...create });
      participations.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = participations.find((p) => p.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const row = participations.find((p) => p.id === where.id);
      if (!row) return { count: 0 };
      if ('lifetimeOfferConvertedAt' in where && row.lifetimeOfferConvertedAt !== where.lifetimeOfferConvertedAt) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
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
vi.mock('@/lib/analyticsEvents', () => ({
  recordAnalyticsEvent: vi.fn(async (input: { eventType: string; idempotencyKey?: string | null }) => {
    analyticsCalls.push(input);
    return { outcome: 'written', id: 'evt' };
  }),
}));

const {
  submitFeedback, getLifetimeOfferStatus, markLifetimeOfferRedeemStarted, markLifetimeOfferConverted,
} = await import('@/lib/feedbackCampaign');

const T0 = new Date('2026-09-15T00:00:00.000Z');

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
  users.set(id, {
    id, createdAt: '2026-09-01T00:00:00.000Z', calcCount: 1, activeDays: [],
    stripeInterval: null, revenueCatActive: false, revenueCatInterval: null,
    ...overrides,
  });
}
const VALID_INPUT = {
  overallSatisfaction: 4, primaryFeature: 'fuel_calculator' as const,
  likes: 'x', frustrations: 'y', hadIssue: false,
  improvementRequest: 'z', featureRequest: 'w', pmfResponse: 'somewhat' as const,
};

describe('Phase 5B — offer window starts at server submission time', () => {
  beforeEach(reset);

  it('a submitted participant gets 72-hour eligibility from that exact submission timestamp', async () => {
    addCampaign();
    addUser('u1');
    const submittedAt = new Date('2026-09-15T10:00:00.000Z');
    await submitFeedback('u1', VALID_INPUT, submittedAt);

    const status = await getLifetimeOfferStatus('u1', new Date('2026-09-15T11:00:00.000Z'));
    expect(status.lifetimeOfferEligible).toBe(true);
    expect(status.lifetimeOfferExpiresAt).toBe(new Date(submittedAt.getTime() + 72 * 3600_000).toISOString());
  });

  it('repeated status reads (simulating refresh/reopen) do not extend expiration', async () => {
    addCampaign();
    addUser('u1');
    const submittedAt = new Date('2026-09-15T10:00:00.000Z');
    await submitFeedback('u1', VALID_INPUT, submittedAt);

    const first = await getLifetimeOfferStatus('u1', new Date('2026-09-15T11:00:00.000Z'));
    const second = await getLifetimeOfferStatus('u1', new Date('2026-09-16T11:00:00.000Z'));
    const third = await getLifetimeOfferStatus('u1', new Date('2026-09-17T11:00:00.000Z'));
    expect(first.lifetimeOfferExpiresAt).toBe(second.lifetimeOfferExpiresAt);
    expect(second.lifetimeOfferExpiresAt).toBe(third.lifetimeOfferExpiresAt);
  });

  it('the offer expires exactly at submittedAt + 72h, not before or indefinitely after', async () => {
    addCampaign();
    addUser('u1');
    const submittedAt = new Date('2026-09-15T10:00:00.000Z');
    await submitFeedback('u1', VALID_INPUT, submittedAt);

    const justBefore = await getLifetimeOfferStatus('u1', new Date(submittedAt.getTime() + 72 * 3600_000 - 1000));
    const justAfter = await getLifetimeOfferStatus('u1', new Date(submittedAt.getTime() + 72 * 3600_000 + 1000));
    expect(justBefore.lifetimeOfferEligible).toBe(true);
    expect(justAfter.lifetimeOfferEligible).toBe(false);
  });
});

describe('Phase 5B — eligibility gates', () => {
  beforeEach(reset);

  it('an existing Lifetime owner is not eligible even with a valid unexpired offer', async () => {
    addCampaign();
    addUser('u1', { stripeInterval: 'lifetime' });
    await submitFeedback('u1', VALID_INPUT, T0);
    const status = await getLifetimeOfferStatus('u1', T0);
    expect(status.alreadyLifetime).toBe(true);
    expect(status.lifetimeOfferEligible).toBe(false);
  });

  it('a RevenueCat (native IAP) Lifetime owner is also not eligible — provider-neutral', async () => {
    addCampaign();
    addUser('u1', { revenueCatActive: true, revenueCatInterval: 'lifetime' });
    await submitFeedback('u1', VALID_INPUT, T0);
    const status = await getLifetimeOfferStatus('u1', T0);
    expect(status.alreadyLifetime).toBe(true);
    expect(status.lifetimeOfferEligible).toBe(false);
  });

  it('an expired offer is rejected', async () => {
    addCampaign();
    addUser('u1');
    await submitFeedback('u1', VALID_INPUT, T0);
    const status = await getLifetimeOfferStatus('u1', new Date(T0.getTime() + 100 * 3600_000));
    expect(status.lifetimeOfferEligible).toBe(false);
  });

  it('an already-converted offer is rejected even if still within the 72h window', async () => {
    addCampaign();
    addUser('u1');
    await submitFeedback('u1', VALID_INPUT, T0);
    await markLifetimeOfferConverted('u1', new Date(T0.getTime() + 3600_000));
    const status = await getLifetimeOfferStatus('u1', new Date(T0.getTime() + 7200_000));
    expect(status.converted).toBe(true);
    expect(status.lifetimeOfferEligible).toBe(false);
  });

  it('a user with no submitted feedback has no offer at all', async () => {
    addUser('u1');
    const status = await getLifetimeOfferStatus('u1', T0);
    expect(status.lifetimeOfferEligible).toBe(false);
    expect(status.lifetimeOfferExpiresAt).toBeNull();
  });
});

describe('Phase 5B — conversion marking is authoritative and idempotent', () => {
  beforeEach(reset);

  it('conversion timestamp is written only when explicitly called (not by viewing/starting checkout)', async () => {
    addCampaign();
    addUser('u1');
    await submitFeedback('u1', VALID_INPUT, T0);
    await getLifetimeOfferStatus('u1', T0);
    await markLifetimeOfferRedeemStarted('u1', T0);
    const stillNotConverted = await getLifetimeOfferStatus('u1', T0);
    expect(stillNotConverted.converted).toBe(false);
  });

  it('marks conversion exactly once and a replayed webhook call does not create a second conversion event', async () => {
    addCampaign();
    addUser('u1');
    await submitFeedback('u1', VALID_INPUT, T0);
    await markLifetimeOfferConverted('u1', new Date(T0.getTime() + 3600_000));
    await markLifetimeOfferConverted('u1', new Date(T0.getTime() + 3600_000)); // replay

    const redeemedEvents = analyticsCalls.filter((c) => c.eventType === 'feedback_lifetime_offer_redeemed');
    expect(redeemedEvents).toHaveLength(1);
  });

  it('a late-arriving webhook still records conversion attribution even after the 72h window passed', async () => {
    addCampaign();
    addUser('u1');
    await submitFeedback('u1', VALID_INPUT, T0);
    await markLifetimeOfferConverted('u1', new Date(T0.getTime() + 200 * 3600_000)); // long after expiry
    const status = await getLifetimeOfferStatus('u1', new Date(T0.getTime() + 200 * 3600_000));
    expect(status.converted).toBe(true);
  });
});

describe('Phase 5B — offer redeem-started analytics', () => {
  beforeEach(reset);

  it('fires feedback_lifetime_offer_redeem_started with a deterministic idempotency key', async () => {
    addCampaign();
    addUser('u1');
    await submitFeedback('u1', VALID_INPUT, T0);
    await markLifetimeOfferRedeemStarted('u1', T0);
    const calls = analyticsCalls.filter((c) => c.eventType === 'feedback_lifetime_offer_redeem_started');
    expect(calls).toHaveLength(1);
    expect(calls[0].idempotencyKey).toMatch(/^feedback_lifetime_offer_redeem_started:/);
  });
});

describe('Phase 5B — offer shown / expired analytics', () => {
  beforeEach(reset);

  it('fires feedback_lifetime_offer_shown exactly once across repeated status reads', async () => {
    addCampaign();
    addUser('u1');
    await submitFeedback('u1', VALID_INPUT, T0);
    await getLifetimeOfferStatus('u1', T0);
    await getLifetimeOfferStatus('u1', new Date(T0.getTime() + 3600_000));
    const shown = analyticsCalls.filter((c) => c.eventType === 'feedback_lifetime_offer_shown');
    expect(shown).toHaveLength(1);
  });

  it('fires feedback_lifetime_offer_expired once the window has closed', async () => {
    addCampaign();
    addUser('u1');
    await submitFeedback('u1', VALID_INPUT, T0);
    await getLifetimeOfferStatus('u1', new Date(T0.getTime() + 100 * 3600_000));
    const expired = analyticsCalls.filter((c) => c.eventType === 'feedback_lifetime_offer_expired');
    expect(expired).toHaveLength(1);
  });
});

describe('Phase 5B — campaign inactive means the offer is unreachable', () => {
  beforeEach(reset);

  it('with zero Campaign rows, no participation can exist, so the offer is never eligible', async () => {
    addUser('u1');
    // No addCampaign() call at all — mirrors the real "campaign table is
    // empty" production state this phase must preserve.
    const status = await getLifetimeOfferStatus('u1', T0);
    expect(status.lifetimeOfferEligible).toBe(false);
    expect(participations).toHaveLength(0);
  });
});

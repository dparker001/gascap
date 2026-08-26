/**
 * Phase 5C — Feedback Campaign communications (lib/feedbackCampaignComms.ts),
 * rewritten after the correctness audit that replaced the EmailLog-based
 * dedup gate with the CampaignCommunication ledger. In-memory Prisma mock,
 * same pattern as __tests__/feedbackCampaign.test.ts — the
 * campaignCommunication.create() mock throws a real P2002 on a duplicate
 * (campaignId, userId, kind), exactly like Postgres would enforce the
 * @@unique constraint, so this file proves the atomic-claim concurrency
 * story, not just the happy path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface CampaignRow { id: string; key: string; startsAt: Date; endsAt: Date | null; timezone: string; config: unknown }
interface UserRow {
  id: string; email: string; name: string; createdAt: string; calcCount: number; activeDays: string[];
  emailOptOut: boolean; locale: string | null;
}
interface ParticipationRow {
  id: string; campaignId: string; userId: string;
  eligibleAt: Date | null; inviteShownAt: Date | null; inviteSentAt: Date | null; pushSentAt: Date | null;
  openedAt: Date | null; startedAt: Date | null; submittedAt: Date | null; drawingEntryGrantedAt: Date | null;
}
interface CommRow {
  id: string; campaignId: string; userId: string; kind: string; state: string;
  attemptedAt: Date; sentAt: Date | null; lastError: string | null;
}

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
const communications: CommRow[] = [];
const sendMailCalls: Array<{ to: string; subject: string }> = [];
const pushCalls: string[] = [];
const analyticsCalls: Array<{ eventType: string }> = [];

let sendMailBehavior: 'success' | 'reject' | 'network_error' = 'success';
let pushBehavior: 'delivered' | 'no_channel' | 'throw' = 'delivered';

function reset() {
  idCounter = 0;
  campaigns.length = 0; participations.length = 0; communications.length = 0;
  sendMailCalls.length = 0; pushCalls.length = 0; analyticsCalls.length = 0;
  users.clear(); fillups.clear(); vehicles.clear(); rentalSessions.clear();
  sendMailBehavior = 'success';
  pushBehavior = 'delivered';
}

function findParticipation(campaignId: string, userId: string) {
  return participations.find((p) => p.campaignId === campaignId && p.userId === userId);
}
function newParticipation(overrides: Partial<ParticipationRow>): ParticipationRow {
  return {
    id: `part-${++idCounter}`, campaignId: '', userId: '',
    eligibleAt: null, inviteShownAt: null, inviteSentAt: null, pushSentAt: null,
    openedAt: null, startedAt: null, submittedAt: null, drawingEntryGrantedAt: null,
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
    findMany: vi.fn(async ({ where, take }: any) => {
      const cutoff: string = where.createdAt.lte;
      return [...users.values()]
        .filter((u) => u.createdAt <= cutoff && u.emailOptOut === where.emailOptOut)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, take);
    }),
    findUnique: vi.fn(async ({ where }: any) => users.get(where.id) ?? null),
  },
  fillup: { count: vi.fn(async ({ where }: any) => fillups.get(where.userId) ?? 0) },
  vehicle: { count: vi.fn(async ({ where }: any) => vehicles.get(where.userId) ?? 0) },
  rentalSession: { count: vi.fn(async ({ where }: any) => rentalSessions.get(where.userId) ?? 0) },
  campaignParticipation: {
    findUnique: vi.fn(async ({ where }: any) => findParticipation(where.campaignId_userId.campaignId, where.campaignId_userId.userId) ?? null),
    findMany: vi.fn(async ({ where, take }: any) => {
      let matches = participations.filter((p) => p.campaignId === where.campaignId);
      if (where.inviteSentAt) {
        matches = matches.filter((p) => p.inviteSentAt != null && p.inviteSentAt.getTime() <= where.inviteSentAt.lte.getTime());
      }
      if ('submittedAt' in where) matches = matches.filter((p) => p.submittedAt === where.submittedAt);
      if ('pushSentAt' in where) matches = matches.filter((p) => p.pushSentAt === where.pushSentAt);
      matches.sort((a, b) => (a.inviteSentAt?.getTime() ?? 0) - (b.inviteSentAt?.getTime() ?? 0));
      return matches.slice(0, take).map((p) => ({ ...p, user: users.get(p.userId) ?? null }));
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
      if (!row) throw new Error('participation not found');
      Object.assign(row, data);
      return row;
    }),
  },
  campaignCommunication: {
    create: vi.fn(async ({ data }: any) => {
      if (communications.some((c) => c.campaignId === data.campaignId && c.userId === data.userId && c.kind === data.kind)) {
        throw new PrismaClientKnownRequestError('unique violation', 'P2002');
      }
      const row: CommRow = {
        id: `comm-${++idCounter}`, campaignId: data.campaignId, userId: data.userId, kind: data.kind,
        state: data.state, attemptedAt: data.attemptedAt, sentAt: null, lastError: null,
      };
      communications.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = communications.find((c) => c.id === where.id);
      if (!row) throw new Error('communication not found');
      Object.assign(row, data);
      return row;
    }),
  },
  $transaction: vi.fn(async (cb: any) => cb(prismaMock)),
};

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/generated/prisma/client', () => ({ Prisma: { PrismaClientKnownRequestError } }));
vi.mock('@/lib/analyticsEvents', () => ({
  recordAnalyticsEvent: vi.fn(async (input: { eventType: string }) => { analyticsCalls.push(input); return { outcome: 'written', id: 'evt' }; }),
}));
vi.mock('@/lib/email', () => ({
  sendMail: vi.fn(async (opts: { to: string; subject: string }) => {
    sendMailCalls.push(opts);
    if (sendMailBehavior === 'reject') throw new Error('Email send failed: 422 invalid recipient');
    if (sendMailBehavior === 'network_error') throw new Error('fetch failed: ECONNRESET');
  }),
  brandHeader: () => '<tr><td>header</td></tr>',
}));
vi.mock('@/lib/emailLog', () => ({
  logEmail: vi.fn(async () => {}),
  logEmailError: vi.fn(async () => {}),
}));
vi.mock('@/lib/userPush', () => ({
  sendUserPush: vi.fn(async (userId: string) => {
    pushCalls.push(userId);
    if (pushBehavior === 'throw') throw new Error('push transport error');
    return pushBehavior === 'delivered';
  }),
}));

const { runFeedbackCampaignComms } = await import('@/lib/feedbackCampaignComms');

const T0 = new Date('2026-09-01T12:00:00.000Z');

function addCampaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  const row: CampaignRow = {
    id: `camp-${++idCounter}`, key: 'feedback_2026_q3',
    startsAt: new Date('2026-09-01T00:00:00.000Z'), endsAt: new Date('2026-09-30T23:59:59.000Z'),
    timezone: 'America/New_York', config: null, ...overrides,
  };
  campaigns.push(row);
  return row;
}
function addUser(id: string, overrides: Partial<UserRow> = {}): UserRow {
  const u: UserRow = {
    id, email: `${id}@example.com`, name: 'Test User', createdAt: '2026-08-01T00:00:00.000Z',
    calcCount: 1, activeDays: [], emailOptOut: false, locale: null, ...overrides,
  };
  users.set(id, u);
  return u;
}
function seedInvited(campaign: CampaignRow, userId: string, daysAgo: number, extra: Partial<ParticipationRow> = {}) {
  communications.push({
    id: `comm-${++idCounter}`, campaignId: campaign.id, userId, kind: 'invite_email', state: 'sent',
    attemptedAt: new Date(T0.getTime() - daysAgo * 86_400_000), sentAt: new Date(T0.getTime() - daysAgo * 86_400_000), lastError: null,
  });
  participations.push(newParticipation({ campaignId: campaign.id, userId, inviteSentAt: new Date(T0.getTime() - daysAgo * 86_400_000), ...extra }));
}

describe('runFeedbackCampaignComms — campaign-inactive safety', () => {
  beforeEach(reset);

  it('with zero Campaign rows, is a clean no-op', async () => {
    addUser('u1');
    const result = await runFeedbackCampaignComms(T0);
    expect(result.noop).toBe('no_active_campaign');
    expect(communications).toHaveLength(0);
    expect(sendMailCalls).toHaveLength(0);
  });
});

describe('runFeedbackCampaignComms — Campaign A does not block Campaign B (Issue 1/2 fix)', () => {
  beforeEach(reset);

  it('a user already invited in a past, now-closed campaign is still invited fresh in a new campaign', async () => {
    const campaignA = addCampaign({ key: 'feedback_2026_q1', startsAt: new Date('2026-01-01'), endsAt: new Date('2026-01-31') });
    addUser('u1');
    communications.push({ id: 'comm-a', campaignId: campaignA.id, userId: 'u1', kind: 'invite_email', state: 'sent', attemptedAt: T0, sentAt: T0, lastError: null });

    const campaignB = addCampaign({ key: 'feedback_2026_q3' }); // active window covers T0
    const result = await runFeedbackCampaignComms(T0);
    expect(result.invitesSent).toBe(1);
    expect(communications.some((c) => c.campaignId === campaignB.id && c.userId === 'u1' && c.kind === 'invite_email')).toBe(true);
  });
});

describe('runFeedbackCampaignComms — atomic claim / concurrency (Issue 2 fix)', () => {
  beforeEach(reset);

  it('two concurrent invite claims for the same user cause exactly ONE provider send', async () => {
    addCampaign();
    addUser('u1');
    const [a, b] = await Promise.all([runFeedbackCampaignComms(T0), runFeedbackCampaignComms(T0)]);
    expect(a.invitesSent + b.invitesSent).toBe(1);
    expect(sendMailCalls).toHaveLength(1);
  });

  it('two concurrent reminder claims for the same user cause exactly ONE provider send', async () => {
    const campaign = addCampaign();
    addUser('u1');
    seedInvited(campaign, 'u1', 6);
    const [a, b] = await Promise.all([runFeedbackCampaignComms(T0), runFeedbackCampaignComms(T0)]);
    expect(a.remindersSent + b.remindersSent).toBe(1);
    expect(sendMailCalls).toHaveLength(1);
  });

  it('two concurrent push claims for the same user cause exactly ONE provider send', async () => {
    const campaign = addCampaign();
    addUser('u1');
    seedInvited(campaign, 'u1', 6);
    const [a, b] = await Promise.all([runFeedbackCampaignComms(T0), runFeedbackCampaignComms(T0)]);
    expect(a.pushSent + b.pushSent).toBe(1);
    expect(pushCalls).toHaveLength(1);
  });

  it('the P2002 loser never calls the provider at all', async () => {
    addCampaign();
    addUser('u1');
    await runFeedbackCampaignComms(T0);
    sendMailCalls.length = 0; // reset call log, keep ledger state
    await runFeedbackCampaignComms(new Date(T0.getTime() + 1000));
    expect(sendMailCalls).toHaveLength(0);
  });
});

describe('runFeedbackCampaignComms — successful invite', () => {
  beforeEach(reset);

  it('records state=sent, sentAt, inviteSentAt, and fires sent analytics exactly once', async () => {
    addCampaign();
    addUser('u1');
    await runFeedbackCampaignComms(T0);
    const comm = communications.find((c) => c.kind === 'invite_email');
    expect(comm?.state).toBe('sent');
    expect(comm?.sentAt).not.toBeNull();
    const participation = participations.find((p) => p.userId === 'u1');
    expect(participation?.inviteSentAt).not.toBeNull();
    expect(analyticsCalls.filter((a) => a.eventType === 'feedback_invite_email_sent')).toHaveLength(1);
  });
});

describe('runFeedbackCampaignComms — ambiguous invite failure', () => {
  beforeEach(reset);

  it('a network-level exception is classified ambiguous, not sent, with no inviteSentAt and no retry', async () => {
    addCampaign();
    addUser('u1');
    sendMailBehavior = 'network_error';
    const result = await runFeedbackCampaignComms(T0);
    expect(result.invitesSent).toBe(0);
    const comm = communications.find((c) => c.kind === 'invite_email');
    expect(comm?.state).toBe('ambiguous');
    expect(comm?.sentAt).toBeNull();
    const participation = participations.find((p) => p.userId === 'u1');
    expect(participation?.inviteSentAt ?? null).toBeNull();

    // A later run must not retry — the row already exists.
    sendMailBehavior = 'success';
    sendMailCalls.length = 0;
    await runFeedbackCampaignComms(new Date(T0.getTime() + 3600_000));
    expect(sendMailCalls).toHaveLength(0);
  });
});

describe('runFeedbackCampaignComms — definite failed email', () => {
  beforeEach(reset);

  it('a definite Resend rejection is classified failed, with no sentAt and no sent analytics', async () => {
    addCampaign();
    addUser('u1');
    sendMailBehavior = 'reject';
    const result = await runFeedbackCampaignComms(T0);
    expect(result.invitesSent).toBe(0);
    const comm = communications.find((c) => c.kind === 'invite_email');
    expect(comm?.state).toBe('failed');
    expect(comm?.sentAt).toBeNull();
    expect(analyticsCalls.filter((a) => a.eventType === 'feedback_invite_email_sent')).toHaveLength(0);
  });
});

describe('runFeedbackCampaignComms — push no_channel', () => {
  beforeEach(reset);

  it('a definite no-channel result is state=no_channel, pushSentAt stays null, no sent analytics', async () => {
    const campaign = addCampaign();
    addUser('u1');
    seedInvited(campaign, 'u1', 6);
    pushBehavior = 'no_channel';
    const result = await runFeedbackCampaignComms(T0);
    expect(result.pushSent).toBe(0);
    const comm = communications.find((c) => c.kind === 'reminder_push');
    expect(comm?.state).toBe('no_channel');
    const participation = participations.find((p) => p.userId === 'u1');
    expect(participation?.pushSentAt).toBeNull();
    expect(analyticsCalls.filter((a) => a.eventType === 'feedback_push_sent')).toHaveLength(0);
  });
});

describe('runFeedbackCampaignComms — push success', () => {
  beforeEach(reset);

  it('a delivered push is state=sent, pushSentAt populated, sent analytics fires once', async () => {
    const campaign = addCampaign();
    addUser('u1');
    seedInvited(campaign, 'u1', 6);
    pushBehavior = 'delivered';
    const result = await runFeedbackCampaignComms(T0);
    expect(result.pushSent).toBe(1);
    const comm = communications.find((c) => c.kind === 'reminder_push');
    expect(comm?.state).toBe('sent');
    const participation = participations.find((p) => p.userId === 'u1');
    expect(participation?.pushSentAt).not.toBeNull();
    expect(analyticsCalls.filter((a) => a.eventType === 'feedback_push_sent')).toHaveLength(1);
  });
});

describe('runFeedbackCampaignComms — reminder delay anchored to confirmed sentAt', () => {
  beforeEach(reset);

  it('a reminder does not fire before the delay has elapsed since the confirmed invite send', async () => {
    const campaign = addCampaign();
    addUser('u1');
    seedInvited(campaign, 'u1', 2); // only 2 days ago, default delay is 6
    const result = await runFeedbackCampaignComms(T0);
    expect(result.remindersSent).toBe(0);
  });

  it('fires once the delay has elapsed since the confirmed invite send', async () => {
    const campaign = addCampaign();
    addUser('u1');
    seedInvited(campaign, 'u1', 6);
    const result = await runFeedbackCampaignComms(T0);
    expect(result.remindersSent).toBe(1);
  });
});

describe('runFeedbackCampaignComms — any existing communication row blocks automated resend', () => {
  beforeEach(reset);

  it.each(['claimed', 'sent', 'ambiguous', 'failed', 'no_channel'])('an existing invite_email row in state=%s blocks a new invite attempt', async (state) => {
    const campaign = addCampaign();
    addUser('u1');
    communications.push({ id: 'existing', campaignId: campaign.id, userId: 'u1', kind: 'invite_email', state, attemptedAt: T0, sentAt: null, lastError: null });
    const result = await runFeedbackCampaignComms(T0);
    expect(result.invitesSent).toBe(0);
    expect(sendMailCalls).toHaveLength(0);
  });

  it('an existing reminder_push row in state=no_channel blocks a subsequent run from calling sendUserPush again', async () => {
    const campaign = addCampaign();
    addUser('u1');
    seedInvited(campaign, 'u1', 6);
    communications.push({ id: 'existing-push', campaignId: campaign.id, userId: 'u1', kind: 'reminder_push', state: 'no_channel', attemptedAt: T0, sentAt: null, lastError: null });
    const result = await runFeedbackCampaignComms(new Date(T0.getTime() + 3600_000));
    expect(result.pushSent).toBe(0);
    expect(pushCalls).toHaveLength(0); // P2002 on the claim — sendUserPush never called again
    expect(communications.filter((c) => c.kind === 'reminder_push')).toHaveLength(1); // no second row, no automatic retry
  });
});

describe('runFeedbackCampaignComms — never sends to a submitted user', () => {
  beforeEach(reset);

  it('does not invite a user who already submitted feedback', async () => {
    const campaign = addCampaign();
    addUser('u1');
    participations.push(newParticipation({ campaignId: campaign.id, userId: 'u1', submittedAt: T0 }));
    const result = await runFeedbackCampaignComms(T0);
    expect(result.invitesSent).toBe(0);
  });

  it('does not remind or push a user who submitted after being invited', async () => {
    const campaign = addCampaign();
    addUser('u1');
    seedInvited(campaign, 'u1', 6, { submittedAt: new Date(T0.getTime() - 86_400_000) });
    const result = await runFeedbackCampaignComms(T0);
    expect(result.remindersSent).toBe(0);
    expect(result.pushSent).toBe(0);
  });
});

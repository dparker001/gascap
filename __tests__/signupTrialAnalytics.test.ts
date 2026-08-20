/**
 * Growth Sprint 1, P0C-1A — regression coverage for signup_completed and
 * trial_started.
 *
 * Google path (createGoogleUser): a plain exported function with a
 * mockable prisma client, tested directly below — including its
 * { user, created } return contract from the P0C-1A Google-race
 * correction (a race-losing call must report created: false, never a bare
 * StoredUser indistinguishable from a genuine new signup).
 *
 * Both major behavioral surfaces now have PRIMARY behavioral proof, not
 * source-inspection:
 *   - OTP's authorize() callback — __tests__/otpSignupBehavioral.test.ts,
 *     invoking the actual captured authorize() function with mocked
 *     pgPool/findByEmail/grantNewSignupProTrial. No live database.
 *   - Google's outer signIn() callback (including the race-case
 *     regression that motivated the P0C-1A correction) —
 *     __tests__/googleSigninBehavioral.test.ts, invoking the actual
 *     captured signIn() callback with a mocked createGoogleUser().
 *
 * The source-inspection block below is SUPPLEMENTAL — a guardrail against
 * a future refactor silently reordering the wiring — not the primary
 * evidence of correctness for either path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Google path: createGoogleUser() ─────────────────────────────────────────

const userFindFirst = vi.fn(async () => null as unknown);
const userCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
  id: args.data.id, email: args.data.email, name: args.data.name, plan: 'free',
  createdAt: args.data.createdAt, isProTrial: false, trialExpiresAt: null,
  activeDays: [], badges: [], ambassadorTierRewardsSent: [],
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: (...a: unknown[]) => userFindFirst(...(a as [])),
      create: (args: { data: Record<string, unknown> }) => userCreate(args),
    },
  },
}));

class MockPrismaKnownRequestError extends Error {
  code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}
vi.mock('@/lib/generated/prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: MockPrismaKnownRequestError },
}));

const recordAnalyticsEvent = vi.fn(async (..._a: unknown[]) => ({ outcome: 'written' as const, id: 'evt_1' }));
vi.mock('@/lib/analyticsEvents', () => ({
  recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  userFindFirst.mockResolvedValue(null);
  recordAnalyticsEvent.mockResolvedValue({ outcome: 'written', id: 'evt_1' });
});

describe('signup_completed — lib/users.ts createGoogleUser()', () => {
  it('S5. actual prisma.user.create — exactly one signup_completed, signupMethod google, originPlatform unknown', async () => {
    const { createGoogleUser } = await import('@/lib/users');
    const result = await createGoogleUser('new@example.com', 'New User', null);
    expect(result.created).toBe(true);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({
      eventType: 'signup_completed', emitter: 'server', originPlatform: 'unknown',
      userId: result.user.id, source: 'auth_signup',
      idempotencyKey: `signup_completed:${result.user.id}`,
    });
    expect((call.metadata as Record<string, unknown>).signupMethod).toBe('google');
  });

  it('S6. existing-user early return — no signup_completed, created is false', async () => {
    userFindFirst.mockResolvedValueOnce({
      id: 'existing-1', email: 'existing@example.com', name: 'Existing', plan: 'pro',
      createdAt: '2026-01-01T00:00:00.000Z', isProTrial: false, trialExpiresAt: null,
      activeDays: [], badges: [], ambassadorTierRewardsSent: [],
    });
    const { createGoogleUser } = await import('@/lib/users');
    const result = await createGoogleUser('existing@example.com', 'Existing', null);
    expect(result.created).toBe(false);
    expect(result.user.id).toBe('existing-1');
    expect(userCreate).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('GOOGLE6. DB-level unique-constraint race — this call\'s own findByEmail found nothing, but prisma.user.create hits a P2002 because a concurrent request\'s INSERT landed first; recovers by re-reading the row and reports created:false, no signup_completed', async () => {
    // First findFirst (this call's own pre-create existence check): nothing yet.
    userFindFirst.mockResolvedValueOnce(null);
    // create() loses the race — a concurrent request's INSERT already landed.
    userCreate.mockRejectedValueOnce(new MockPrismaKnownRequestError('Unique constraint failed on the fields: (`email`)', 'P2002'));
    // Re-read after the P2002: the concurrent request's row is now visible.
    userFindFirst.mockResolvedValueOnce({
      id: 'raced-user-1', email: 'race@example.com', name: 'Race Winner', plan: 'free',
      createdAt: '2026-08-20T00:00:00.000Z', isProTrial: false, trialExpiresAt: null,
      activeDays: [], badges: [], ambassadorTierRewardsSent: [],
    });

    const { createGoogleUser } = await import('@/lib/users');
    const result = await createGoogleUser('race@example.com', 'Race Loser', null);

    expect(result.created).toBe(false);
    expect(result.user.id).toBe('raced-user-1');
    expect(recordAnalyticsEvent).not.toHaveBeenCalled(); // no signup_completed for the race loser
  });

  it('GOOGLE7. non-unique create failure — NOT converted into created:false, error propagates unchanged, no analytics falsely emitted', async () => {
    userFindFirst.mockResolvedValueOnce(null); // no existing user
    userCreate.mockRejectedValueOnce(new Error('connection terminated unexpectedly')); // unrelated DB error, not P2002

    const { createGoogleUser } = await import('@/lib/users');
    await expect(createGoogleUser('outage@example.com', 'Outage User', null)).rejects.toThrow('connection terminated unexpectedly');
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('GOOGLE7b. a P2002 that is NOT actually recoverable (re-read still finds nothing) re-throws rather than silently returning a bogus result', async () => {
    userFindFirst.mockResolvedValueOnce(null);
    userCreate.mockRejectedValueOnce(new MockPrismaKnownRequestError('Unique constraint failed on the fields: (`email`)', 'P2002'));
    userFindFirst.mockResolvedValueOnce(null); // re-read still finds nothing — genuinely unexpected

    const { createGoogleUser } = await import('@/lib/users');
    await expect(createGoogleUser('ghost@example.com', 'Ghost User', null)).rejects.toThrow('Unique constraint failed');
  });

  it('analytics writer throws — account creation still returns normally, created remains true', async () => {
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('db unavailable'));
    const { createGoogleUser } = await import('@/lib/users');
    const result = await createGoogleUser('new2@example.com', 'New User Two', null);
    expect(result.created).toBe(true);
    expect(result.user.email).toBe('new2@example.com');
  });

  it('no email/name/PII beyond userId in metadata', async () => {
    const { createGoogleUser } = await import('@/lib/users');
    await createGoogleUser('secret@example.com', 'Secret Name', null);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain('secret@example.com');
    expect(serialized).not.toContain('Secret Name');
  });
});

// ── OTP path + Google signIn() trial orchestration: source inspection ──────
// Matches the established pattern in __tests__/otpVerifyThrottle.test.ts —
// authorize()/signIn() cannot be invoked without a live database.

describe('signup_completed / trial_started wiring in lib/auth.ts (source inspection)', () => {
  const src = readFileSync(join(process.cwd(), 'lib/auth.ts'), 'utf8');

  it('OTP: signup_completed is emitted using the INSERT...RETURNING id, not a later lookup', () => {
    const insertAt = src.indexOf('INSERT INTO "User"');
    const returningIdAt = src.indexOf('const newUserId = created[0].id');
    const signupEventAt = src.indexOf("eventType: 'signup_completed'");
    expect(insertAt).toBeGreaterThan(-1);
    expect(returningIdAt).toBeGreaterThan(insertAt);
    expect(signupEventAt).toBeGreaterThan(returningIdAt);
  });

  it('OTP: signup_completed fires BEFORE the trial grant is attempted — independent of trial success', () => {
    const signupEventAt = src.indexOf("eventType: 'signup_completed'");
    const trialGrantAt = src.indexOf('const grantedTrial = await grantNewSignupProTrial(user!.id, 30)');
    expect(signupEventAt).toBeGreaterThan(-1);
    expect(trialGrantAt).toBeGreaterThan(signupEventAt);
  });

  it('OTP: trial_started is gated on grantedTrial !== null, not a bare .catch()', () => {
    const grantAt = src.indexOf('const grantedTrial = await grantNewSignupProTrial(user!.id, 30)');
    const guardAt = src.indexOf('if (grantedTrial !== null) {', grantAt);
    const trialEventAt = src.indexOf("eventType: 'trial_started'", grantAt);
    expect(grantAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(grantAt);
    expect(trialEventAt).toBeGreaterThan(guardAt);
  });

  it('OTP: originPlatform uses the already-validated OTP signup platform variable', () => {
    const otpSignupBlock = src.slice(src.indexOf('INSERT INTO "User"'), src.indexOf("eventType: 'trial_started'"));
    expect(otpSignupBlock).toContain('originPlatform: platform');
  });

  it('Google: signIn() callback captures grantedTrial and gates trial_started on it, not a bare await', () => {
    const googleGrantAt = src.indexOf('const grantedTrial = await grantNewSignupProTrial(dbUser.id, 30)');
    const guardAt = src.indexOf('if (grantedTrial !== null) {', googleGrantAt);
    const trialEventAt = src.indexOf("eventType: 'trial_started'", googleGrantAt);
    expect(googleGrantAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(googleGrantAt);
    expect(trialEventAt).toBeGreaterThan(guardAt);
  });

  it('Google: signIn() callback does NOT emit signup_completed itself — that lives inside createGoogleUser()', () => {
    const signInCallbackStart = src.indexOf('async signIn({ user, account, profile })');
    const signInCallbackBody = src.slice(signInCallbackStart, src.indexOf('async jwt(', signInCallbackStart));
    expect(signInCallbackBody).not.toContain("eventType: 'signup_completed'");
  });

  it('trial_started idempotency key is bare userId, not userId+expiry (both OTP and Google paths)', () => {
    const matches = src.match(/idempotencyKey: `trial_started:\$\{[^}]+\}`/g) ?? [];
    expect(matches.length).toBe(2);
    for (const m of matches) expect(m).not.toContain(':trialExpiresAt');
  });

  it('S2. OTP: both signup_completed and trial_started sites are inside the `if (!user)` / `if (isNew)` new-account branches, not reachable on a returning login', () => {
    const notUserBranchAt = src.indexOf('if (!user) {');
    const elseBranchAt = src.indexOf('} else {\n          await pgPool.query(`UPDATE "User" SET "emailVerified"=true');
    const isNewBranchAt = src.indexOf('if (isNew) {');
    const signupEventAt = src.indexOf("eventType: 'signup_completed'");
    const trialEventAt = src.indexOf("eventType: 'trial_started'", isNewBranchAt);
    expect(notUserBranchAt).toBeGreaterThan(-1);
    expect(elseBranchAt).toBeGreaterThan(notUserBranchAt);
    // signup_completed sits between the INSERT branch open and the else branch.
    expect(signupEventAt).toBeGreaterThan(notUserBranchAt);
    expect(signupEventAt).toBeLessThan(elseBranchAt);
    // trial_started sits inside the isNew-only block, which starts after the else branch.
    expect(isNewBranchAt).toBeGreaterThan(elseBranchAt);
    expect(trialEventAt).toBeGreaterThan(isNewBranchAt);
  });

  it('S7/GOOGLE-race guardrail: trial_started sits inside the `if (result.created)` branch, not merely inside the outer dbUser-not-found else — a race-losing createGoogleUser() result must never reach it', () => {
    const dbUserCheckAt = src.indexOf('if (dbUser) {');
    const outerElseAt = src.indexOf('} else {', dbUserCheckAt);
    const createdCheckAt = src.indexOf('if (result.created) {', outerElseAt);
    const trialEventAt = src.indexOf("eventType: 'trial_started'", createdCheckAt);
    const raceElseAt = src.indexOf('} else {', createdCheckAt); // the result.created === false branch
    expect(dbUserCheckAt).toBeGreaterThan(-1);
    expect(outerElseAt).toBeGreaterThan(dbUserCheckAt);
    expect(createdCheckAt).toBeGreaterThan(outerElseAt);
    expect(trialEventAt).toBeGreaterThan(createdCheckAt);
    expect(trialEventAt).toBeLessThan(raceElseAt);
  });
});

describe('P0C-1A global rules (G1-G5, source inspection)', () => {
  const files = [
    'lib/auth.ts', 'lib/users.ts', 'lib/savedVehicles.ts', 'lib/fillups.ts',
    'lib/rentalSessions.ts', 'app/api/gig/fillups/route.ts', 'app/api/cron/trial-expire/route.ts',
  ].map((f) => ({ f, src: readFileSync(join(process.cwd(), f), 'utf8') }));

  it('G1. every P0C-1A recordAnalyticsEvent call in these files uses emitter: \'server\'', () => {
    for (const { f, src } of files) {
      const blocks = src.split('recordAnalyticsEvent({').slice(1);
      for (const b of blocks) {
        const closeIdx = b.indexOf('});');
        const block = b.slice(0, closeIdx);
        expect(/emitter:\s*'server'/.test(block), `${f} missing emitter:'server'`).toBe(true);
      }
    }
  });

  it('G2. vehicle_saved/fillup_logged/rental_setup_completed/trial_expired all use originPlatform: \'unknown\'', () => {
    const targets = ['vehicle_saved', 'fillup_logged', 'rental_setup_completed', 'trial_expired'];
    for (const { src } of files) {
      for (const t of targets) {
        const idx = src.indexOf(`eventType: '${t}'`);
        if (idx === -1) continue;
        const surrounding = src.slice(Math.max(0, idx - 300), idx + 300);
        expect(surrounding).toContain("originPlatform: 'unknown'");
      }
    }
  });

  it('G5. server-authoritative paths call the trusted recordAnalyticsEvent from lib/analyticsEvents, never the public /api/analytics/event route', () => {
    for (const { f, src } of files) {
      expect(src, `${f} should not call the public ingest route`).not.toContain('/api/analytics/event');
    }
  });
});

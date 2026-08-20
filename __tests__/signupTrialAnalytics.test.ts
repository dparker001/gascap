/**
 * Growth Sprint 1, P0C-1A — regression coverage for signup_completed and
 * trial_started.
 *
 * Google path: createGoogleUser() is a plain exported function with a
 * mockable prisma client, tested directly below.
 *
 * OTP path: the PRIMARY behavioral proof for the OTP authorize() callback
 * (new user, returning user, null trial grant, analytics-failure isolation)
 * now lives in __tests__/otpSignupBehavioral.test.ts, which invokes the
 * actual captured authorize() function with mocked pgPool/findByEmail/
 * grantNewSignupProTrial — no live database. The source-inspection block
 * below (and the Google signIn() callback ordering checks, which remain
 * source-inspection since createGoogleUser() itself is covered behaviorally
 * above but the outer signIn() callback still isn't) are SUPPLEMENTAL
 * guardrails against a future refactor silently reordering the wiring —
 * not the primary evidence of correctness.
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
    const user = await createGoogleUser('new@example.com', 'New User', null);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({
      eventType: 'signup_completed', emitter: 'server', originPlatform: 'unknown',
      userId: user.id, source: 'auth_signup',
      idempotencyKey: `signup_completed:${user.id}`,
    });
    expect((call.metadata as Record<string, unknown>).signupMethod).toBe('google');
  });

  it('S6. existing-user early return — no signup_completed', async () => {
    userFindFirst.mockResolvedValueOnce({
      id: 'existing-1', email: 'existing@example.com', name: 'Existing', plan: 'pro',
      createdAt: '2026-01-01T00:00:00.000Z', isProTrial: false, trialExpiresAt: null,
      activeDays: [], badges: [], ambassadorTierRewardsSent: [],
    });
    const { createGoogleUser } = await import('@/lib/users');
    const user = await createGoogleUser('existing@example.com', 'Existing', null);
    expect(user.id).toBe('existing-1');
    expect(userCreate).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('analytics writer throws — account creation still returns normally, return contract unchanged', async () => {
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('db unavailable'));
    const { createGoogleUser } = await import('@/lib/users');
    const user = await createGoogleUser('new2@example.com', 'New User Two', null);
    expect(user.email).toBe('new2@example.com');
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

  it('S7. Google: both events are inside the `else` (new-user) branch of the dbUser check, not the existing-account branch', () => {
    const dbUserCheckAt = src.indexOf('if (dbUser) {');
    const elseAt = src.indexOf('} else {\n            // New Google user', dbUserCheckAt);
    const trialEventAt = src.indexOf("eventType: 'trial_started'", elseAt);
    expect(dbUserCheckAt).toBeGreaterThan(-1);
    expect(elseAt).toBeGreaterThan(dbUserCheckAt);
    expect(trialEventAt).toBeGreaterThan(elseAt);
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

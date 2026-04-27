/**
 * User store — backed by Railway PostgreSQL via Prisma.
 * All function signatures are identical to the previous JSON-file version;
 * callers only need to add `await` where they previously called synchronously.
 */
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { findNewBadges, type UserStats } from './badges';
import { getVehiclesForUser } from './savedVehicles';
import type { User as PrismaUser } from './generated/prisma/client';
import { Prisma } from './generated/prisma/client';

// ── Public types (unchanged) ────────────────────────────────────────────────

export interface StoredUser {
  id:              string;
  email:           string;
  name:            string;
  passwordHash:    string;
  plan:            'free' | 'pro' | 'fleet';
  createdAt:       string;
  stripeCustomerId?:     string;
  stripeSubscriptionId?: string;
  calcCount?:       number;
  budgetCalcCount?: number;
  locationLookups?: number;
  activeDays?:      string[];
  streak?:          number;
  badges?:          string[];
  referralCode?:          string;
  referredBy?:            string;
  referralCount?:         number;
  referralProMonthsEarned?: number;
  referralRewardCredited?:  boolean;
  referralCredits?:         ReferralCredit[];
  isBetaTester?:   boolean;
  isProTrial?:     boolean;
  betaProExpiry?:  string;
  emailVerified?:      boolean;
  emailVerifyToken?:   string;
  emailVerifyExpires?: string;
  passwordResetToken?:   string;
  passwordResetExpires?: string;
  phone?:  string;
  displayName?: string;
  priceAlertThreshold?:   number;
  lastPriceAlertSentAt?:  string;
  loginCount?:    number;
  lastLoginAt?:   string;
  fillupReminderDays?:        number;
  lastFillupReminderSentAt?:  string;
  streakMilestonesHit?: number[];
  streakCredits?: StreakCredit[];
  locale?: 'en' | 'es';
  emailCampaignStep?:       number;
  emailCampaignEnrolledAt?: string;
  emailOptOut?:             boolean;
  paidCampaignStep?:        number;
  paidCampaignEnrolledAt?:  string;
  stripeInterval?:          string;
  verifyReminderSentAt?:    string;
  isTestAccount?: boolean;
  fleetDrivers?:  string[];
}

export interface ReferralCredit {
  id:        string;
  earnedAt:  string;
  expiresAt: string;
  redeemedAt?: string;
}

export interface StreakCredit {
  id:          string;
  milestone:   number;
  earnedAt:    string;
  expiresAt:   string;
  redeemedAt?: string;
}

export const STREAK_MILESTONES: { days: number; months: number }[] = [
  { days: 30,  months: 1 },
  { days: 90,  months: 1 },
  { days: 180, months: 1 },
  { days: 365, months: 1 },
];

export type ActivityEvent = 'calc' | 'budget_calc' | 'location_lookup' | 'visit';

// ── Prisma → StoredUser conversion ─────────────────────────────────────────

function toStoredUser(u: PrismaUser): StoredUser {
  return {
    ...u,
    plan:               u.plan as 'free' | 'pro' | 'fleet',
    locale:             u.locale as 'en' | 'es' | undefined,
    referralCredits:    (u.referralCredits as unknown as ReferralCredit[]) ?? [],
    streakCredits:      (u.streakCredits   as unknown as StreakCredit[])   ?? [],
    stripeCustomerId:   u.stripeCustomerId    ?? undefined,
    stripeSubscriptionId: u.stripeSubscriptionId ?? undefined,
    betaProExpiry:      u.betaProExpiry       ?? undefined,
    emailVerifyToken:   u.emailVerifyToken    ?? undefined,
    emailVerifyExpires: u.emailVerifyExpires  ?? undefined,
    passwordResetToken: u.passwordResetToken  ?? undefined,
    passwordResetExpires: u.passwordResetExpires ?? undefined,
    referralCode:       u.referralCode        ?? undefined,
    referredBy:         u.referredBy          ?? undefined,
    phone:              u.phone               ?? undefined,
    displayName:        u.displayName         ?? undefined,
    lastPriceAlertSentAt: u.lastPriceAlertSentAt ?? undefined,
    lastLoginAt:        u.lastLoginAt         ?? undefined,
    lastFillupReminderSentAt: u.lastFillupReminderSentAt ?? undefined,
    emailCampaignEnrolledAt: u.emailCampaignEnrolledAt ?? undefined,
    emailCampaignStep:  u.emailCampaignStep   ?? undefined,
    paidCampaignStep:       u.paidCampaignStep       ?? undefined,
    paidCampaignEnrolledAt: u.paidCampaignEnrolledAt ?? undefined,
    stripeInterval:         u.stripeInterval         ?? undefined,
    verifyReminderSentAt:   u.verifyReminderSentAt   ?? undefined,
    fillupReminderDays: u.fillupReminderDays  ?? undefined,
    priceAlertThreshold: u.priceAlertThreshold ?? undefined,
    loginCount:         u.loginCount,
    calcCount:          u.calcCount,
    budgetCalcCount:    u.budgetCalcCount,
    locationLookups:    u.locationLookups,
    streak:             u.streak,
    activeDays:         u.activeDays,
    badges:             u.badges,
    streakMilestonesHit: u.streakMilestonesHit,
    fleetDrivers:        u.fleetDrivers ?? [],
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function getAllUsers(): Promise<StoredUser[]> {
  const users = await prisma.user.findMany();
  return users.map(toStoredUser);
}

export async function findByEmail(email: string): Promise<StoredUser | undefined> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.toLowerCase().trim(), mode: 'insensitive' } },
  });
  return user ? toStoredUser(user) : undefined;
}

export async function findById(id: string): Promise<StoredUser | undefined> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? toStoredUser(user) : undefined;
}

export async function createUser(
  name: string,
  email: string,
  password: string,
  locale: 'en' | 'es' = 'en',
): Promise<StoredUser> {
  const existing = await findByEmail(email);
  if (existing) throw new Error('An account with that email already exists.');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      id:           crypto.randomUUID(),
      email:        email.toLowerCase().trim(),
      name:         name.trim(),
      passwordHash,
      plan:         'free',
      createdAt:    new Date().toISOString(),
      locale,
    },
  });
  return toStoredUser(user);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── Plan management ─────────────────────────────────────────────────────────

export async function setUserPlan(
  userId: string,
  plan: 'free' | 'pro' | 'fleet',
  stripe?: { customerId?: string; subscriptionId?: string },
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      plan,
      ...(stripe?.customerId     ? { stripeCustomerId:     stripe.customerId }     : {}),
      ...(stripe?.subscriptionId ? { stripeSubscriptionId: stripe.subscriptionId } : {}),
    },
  });
}

export async function findByStripeCustomer(customerId: string): Promise<StoredUser | undefined> {
  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
  return user ? toStoredUser(user) : undefined;
}

// ── Beta / Pro trial ────────────────────────────────────────────────────────

export async function grantBetaTrial(userId: string, days = 30): Promise<StoredUser | null> {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      plan:          'pro',
      isBetaTester:  true,
      betaProExpiry: expiry.toISOString(),
    },
  }).catch(() => null);
  return user ? toStoredUser(user) : null;
}

export async function revokeBetaTrial(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { plan: 'free', betaProExpiry: null },
  });
}

export async function grantNewSignupProTrial(userId: string, days = 30): Promise<StoredUser | null> {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      plan:          'pro',
      isProTrial:    true,
      betaProExpiry: expiry.toISOString(),
    },
  }).catch(() => null);
  return user ? toStoredUser(user) : null;
}

// ── Email campaign ──────────────────────────────────────────────────────────

export async function enrollEmailCampaign(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      emailCampaignEnrolledAt: new Date().toISOString(),
      emailCampaignStep:       1,
    },
  });
}

export async function advanceEmailCampaignStep(userId: string, step: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { emailCampaignStep: step },
  });
}

export async function optOutEmailCampaign(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { emailOptOut: true },
  });
}

export async function getUsersPendingCampaignStep(step: number, minDays: number): Promise<StoredUser[]> {
  const cutoff = new Date(Date.now() - minDays * 86_400_000).toISOString();
  const users = await prisma.user.findMany({
    where: {
      emailOptOut:             false,
      stripeSubscriptionId:    null,
      emailCampaignStep:       step - 1,
      emailCampaignEnrolledAt: { not: null, lte: cutoff },
    },
  });
  return users.map(toStoredUser);
}

// ── Paid campaign ───────────────────────────────────────────────────────────

/**
 * Enroll a user in the paid drip sequence on their first upgrade.
 * Sets step=1 (P1 already sent), records enrollment timestamp + billing interval.
 */
export async function enrollPaidCampaign(
  userId: string,
  interval: 'monthly' | 'annual',
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      paidCampaignStep:       1,
      paidCampaignEnrolledAt: new Date().toISOString(),
      stripeInterval:         interval,
    },
  });
}

export async function advancePaidCampaignStep(userId: string, step: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { paidCampaignStep: step },
  });
}

/**
 * Find paying users whose next paid drip email is due.
 * step 2 = P2 at day 30, step 3 = P3 at day 60, step 4 = P4 at day 330 (annual only)
 */
export async function getUsersPendingPaidCampaignStep(
  step: 2 | 3 | 4,
  minDays: number,
): Promise<StoredUser[]> {
  const cutoff = new Date(Date.now() - minDays * 86_400_000).toISOString();
  // P4 only fires for annual subscribers
  const users = await prisma.user.findMany({
    where: {
      emailOptOut:            false,
      paidCampaignStep:       step - 1,
      paidCampaignEnrolledAt: { not: null, lte: cutoff },
      stripeSubscriptionId:   { not: null },
      ...(step === 4 ? { stripeInterval: 'annual' } : {}),
    },
  });
  return users.map(toStoredUser);
}

// ── Email verification reminder ─────────────────────────────────────────────

/**
 * Find users who have not verified their email, signed up 3+ days ago,
 * and have not yet received a reminder nudge.
 * Cap at 30 days so we don't keep nudging very stale accounts.
 */
export async function getUnverifiedUsersForReminder(): Promise<StoredUser[]> {
  const threeDaysAgo   = new Date(Date.now() - 3  * 86_400_000).toISOString();
  const thirtyDaysAgo  = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const users = await prisma.user.findMany({
    where: {
      emailVerified:        false,
      emailOptOut:          false,
      verifyReminderSentAt: null,            // no reminder sent yet
      createdAt:            { lte: threeDaysAgo, gte: thirtyDaysAgo },
    },
  });
  return users.map(toStoredUser);
}

export async function markVerifyReminderSent(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { verifyReminderSentAt: new Date().toISOString() },
  });
}

export async function getExpiredBetaUsers(): Promise<StoredUser[]> {
  const now = new Date().toISOString();
  const users = await prisma.user.findMany({
    where: {
      OR: [{ isBetaTester: true }, { isProTrial: true }],
      plan:                 'pro',
      stripeSubscriptionId: null,
      betaProExpiry:        { not: null, lt: now },
    },
  });
  return users.map(toStoredUser);
}

export async function getActiveBetaUsers(): Promise<StoredUser[]> {
  const now = new Date().toISOString();
  const users = await prisma.user.findMany({
    where: {
      OR: [{ isBetaTester: true }, { isProTrial: true }],
      plan:         'pro',
      betaProExpiry: { not: null, gte: now },
    },
  });
  return users.map(toStoredUser);
}

// ── Activity + badge tracking ───────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function calcStreak(activeDays: string[]): number {
  if (activeDays.length === 0) return 0;
  const sorted = [...activeDays].sort().reverse();
  const today  = todayStr();
  if (sorted[0] !== today) {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    if (sorted[0] !== yesterday) return 1;
  }
  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = Math.round((prev.getTime() - curr.getTime()) / 86400_000);
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

function awardStreakMilestones(
  streakMilestonesHit: number[],
  streakCredits: StreakCredit[],
  streak: number,
): { newlyHit: number[]; updatedCredits: StreakCredit[] } {
  const newlyHit = STREAK_MILESTONES
    .filter((m) => streak >= m.days && !streakMilestonesHit.includes(m.days))
    .map((m) => m.days);

  if (newlyHit.length === 0) return { newlyHit: [], updatedCredits: streakCredits };

  const now    = new Date();
  const expiry = new Date(now);
  expiry.setFullYear(expiry.getFullYear() + 1);

  const newCredits: StreakCredit[] = newlyHit.map((days) => ({
    id:        crypto.randomUUID(),
    milestone: days,
    earnedAt:  now.toISOString(),
    expiresAt: expiry.toISOString(),
  }));

  return {
    newlyHit,
    updatedCredits: [...streakCredits, ...newCredits],
  };
}

export interface ActivityResult {
  newBadges:        string[];
  badges:           string[];
  streak:           number;
  newMilestonesHit: number[];
}

export async function recordActivity(userId: string, event: ActivityEvent): Promise<ActivityResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { newBadges: [], badges: [], streak: 0, newMilestonesHit: [] };

  const today      = todayStr();
  const activeDays = user.activeDays ?? [];
  const badges     = user.badges     ?? [];

  let calcCount       = user.calcCount       ?? 0;
  let budgetCalcCount = user.budgetCalcCount ?? 0;
  let locationLookups = user.locationLookups ?? 0;

  if (event === 'calc')            calcCount++;
  if (event === 'budget_calc')     budgetCalcCount++;
  if (event === 'location_lookup') locationLookups++;

  const updatedDays = activeDays.includes(today) ? activeDays : [...activeDays, today];
  const streak      = calcStreak(updatedDays);

  const vehicleCount = (await getVehiclesForUser(userId)).length;
  const stats: UserStats = {
    calcCount,
    budgetCalcCount,
    locationLookups,
    streak,
    vehicleCount,
    daysActive: updatedDays.length,
  };

  const newBadges    = findNewBadges(stats, badges);
  const updatedBadges = [...badges, ...newBadges];

  const { newlyHit, updatedCredits } = awardStreakMilestones(
    user.streakMilestonesHit ?? [],
    (user.streakCredits as unknown as StreakCredit[]) ?? [],
    streak,
  );

  await prisma.user.update({
    where: { id: userId },
    data: {
      calcCount,
      budgetCalcCount,
      locationLookups,
      activeDays:         updatedDays,
      streak,
      badges:             updatedBadges,
      streakMilestonesHit: [...(user.streakMilestonesHit ?? []), ...newlyHit],
      streakCredits:      updatedCredits as unknown as Prisma.InputJsonValue,
    },
  });

  return { newBadges, badges: updatedBadges, streak, newMilestonesHit: newlyHit };
}

// ── Referral system ─────────────────────────────────────────────────────────

export function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return '';
  if (user.referralCode?.includes('-')) return user.referralCode;

  const firstName = user.name.split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10) || 'USER';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code: string;
  do {
    const suffix = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    code = `${firstName}-${suffix}`;
  } while (await prisma.user.findFirst({ where: { referralCode: code } }));

  await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
  return code;
}

export async function findByReferralCode(code: string): Promise<StoredUser | undefined> {
  const user = await prisma.user.findFirst({
    where: { referralCode: { equals: code.toUpperCase(), mode: 'insensitive' } },
  });
  return user ? toStoredUser(user) : undefined;
}

const MAX_REFERRAL_REWARDS = 10;
const MAX_REDEEM_AT_ONCE   = 3;
const CREDIT_EXPIRY_MONTHS = 6;

export function getActiveCredits(user: StoredUser): ReferralCredit[] {
  const now = new Date();
  return (user.referralCredits ?? []).filter(
    (c) => !c.redeemedAt && new Date(c.expiresAt) > now,
  );
}

export function getRedeemableMonths(user: StoredUser): number {
  return Math.min(getActiveCredits(user).length, MAX_REDEEM_AT_ONCE);
}

export async function recordReferral(referrerId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: referrerId } });
  if (!user) return;
  const current = user.referralCount ?? 0;
  if (current >= MAX_REFERRAL_REWARDS) return;

  const now    = new Date();
  const expiry = new Date(now);
  expiry.setMonth(expiry.getMonth() + CREDIT_EXPIRY_MONTHS);

  const credit: ReferralCredit = {
    id:        crypto.randomUUID(),
    earnedAt:  now.toISOString(),
    expiresAt: expiry.toISOString(),
  };

  const existing = (user.referralCredits as unknown as ReferralCredit[]) ?? [];
  await prisma.user.update({
    where: { id: referrerId },
    data: {
      referralCount:           current + 1,
      referralProMonthsEarned: (user.referralProMonthsEarned ?? 0) + 1,
      referralCredits:         [...existing, credit] as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function redeemReferralCredits(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return 0;
  if (user.plan !== 'pro' && user.plan !== 'fleet') return 0;

  const stored = toStoredUser(user);
  const active   = getActiveCredits(stored);
  const toRedeem = active.slice(0, MAX_REDEEM_AT_ONCE);
  if (toRedeem.length === 0) return 0;

  const now = new Date().toISOString();
  const updated = (user.referralCredits as unknown as ReferralCredit[]).map((c) =>
    toRedeem.find((r) => r.id === c.id) ? { ...c, redeemedAt: now } : c,
  );
  await prisma.user.update({ where: { id: userId }, data: { referralCredits: updated as unknown as Prisma.InputJsonValue } });
  return toRedeem.length;
}

export async function setReferredBy(userId: string, referralCode: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { referredBy: referralCode } });
}

export async function creditVerifiedReferral(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.referralRewardCredited || !user.referredBy) return false;

  const referrer = await prisma.user.findFirst({
    where: { referralCode: { equals: user.referredBy, mode: 'insensitive' } },
  });
  if (!referrer || referrer.id === userId) return false;

  // Atomic compare-and-swap: updateMany with the un-credited condition as a
  // WHERE clause. PostgreSQL guarantees only one concurrent writer wins — if
  // a duplicate webhook fires simultaneously, the second update sees count=0
  // and short-circuits before calling recordReferral, preventing double credit.
  const result = await prisma.user.updateMany({
    where: { id: userId, referralRewardCredited: false },
    data:  { referralRewardCredited: true },
  });
  if (result.count === 0) return false; // another process already claimed it

  const current = referrer.referralCount ?? 0;
  if (current < MAX_REFERRAL_REWARDS) {
    await recordReferral(referrer.id);
    return true;
  }
  return false;
}

// ── Profile ─────────────────────────────────────────────────────────────────

export async function updateUserProfile(
  userId: string,
  fields: { displayName?: string; phone?: string },
): Promise<StoredUser | null> {
  // `undefined` → field not included in the request; leave as-is.
  // `''` (empty string) → user explicitly cleared the field; store null.
  // Any other string → trim and save.
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(fields.displayName !== undefined
        ? { displayName: fields.displayName.trim() || null }
        : {}),
      ...(fields.phone !== undefined
        ? { phone: fields.phone.trim() || null }
        : {}),
    },
  }).catch(() => null);
  return user ? toStoredUser(user) : null;
}

export async function recordLogin(userId: string): Promise<void> {
  // Also add today to activeDays so each login day earns a giveaway entry
  const today = todayStr();
  const user  = await prisma.user.findUnique({ where: { id: userId }, select: { activeDays: true } });
  const activeDays = user?.activeDays ?? [];
  const updatedDays = activeDays.includes(today) ? activeDays : [...activeDays, today];

  await prisma.user.update({
    where: { id: userId },
    data: {
      loginCount:  { increment: 1 },
      lastLoginAt: new Date().toISOString(),
      activeDays:  updatedDays,
    },
  });
}

export async function setFillupReminderDays(userId: string, days: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { fillupReminderDays: days } });
}

export async function setLastFillupReminderSent(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lastFillupReminderSentAt: new Date().toISOString() },
  });
}

// ── Fleet driver roster (Phase 1) ────────────────────────────────────────────

export const FLEET_DRIVER_LIMIT = 10;

/** Return the fleet driver name list for a user */
export async function getFleetDrivers(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { fleetDrivers: true },
  });
  return user?.fleetDrivers ?? [];
}

/**
 * Add a driver name to the roster.
 * Silently no-ops if the name already exists or the limit is reached.
 * Returns the updated list.
 */
export async function addFleetDriver(userId: string, name: string): Promise<string[]> {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return getFleetDrivers(userId);
  const current = await getFleetDrivers(userId);
  if (current.includes(trimmed) || current.length >= FLEET_DRIVER_LIMIT) return current;
  const updated = [...current, trimmed];
  await prisma.user.update({ where: { id: userId }, data: { fleetDrivers: updated } });
  return updated;
}

/**
 * Remove a driver name from the roster.
 * Historical fill-up records keep their driverLabel for audit purposes.
 * Returns the updated list.
 */
export async function removeFleetDriver(userId: string, name: string): Promise<string[]> {
  const current = await getFleetDrivers(userId);
  const updated = current.filter((d) => d !== name);
  await prisma.user.update({ where: { id: userId }, data: { fleetDrivers: updated } });
  return updated;
}

export async function setPriceAlertThreshold(userId: string, threshold: number | null): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { priceAlertThreshold: threshold ?? undefined },
  });
}

// ── Email verification ──────────────────────────────────────────────────────

export async function createEmailVerifyToken(userId: string): Promise<string> {
  const token   = crypto.randomUUID().replace(/-/g, '');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await prisma.user.update({
    where: { id: userId },
    data: {
      emailVerifyToken:   token,
      emailVerifyExpires: expires,
      emailVerified:      false,
    },
  });
  return token;
}

export async function verifyEmailToken(token: string): Promise<{ ok: boolean; userId?: string; error?: string }> {
  const user = await prisma.user.findFirst({ where: { emailVerifyToken: token } });
  if (!user) return { ok: false, error: 'Invalid or already used verification link.' };
  if (user.emailVerifyExpires && new Date(user.emailVerifyExpires) < new Date()) {
    return { ok: false, error: 'Verification link has expired. Please request a new one.' };
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified:      true,
      emailVerifyToken:   null,
      emailVerifyExpires: null,
    },
  });
  return { ok: true, userId: user.id };
}

export async function resendVerificationToken(userId: string): Promise<string> {
  return createEmailVerifyToken(userId);
}

// ── Password reset ──────────────────────────────────────────────────────────

export async function createPasswordResetToken(
  email: string,
): Promise<{ token: string; user: StoredUser } | null> {
  const token   = crypto.randomUUID().replace(/-/g, '');
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const user = await prisma.user.update({
    where: { email: email.toLowerCase().trim() },
    data: { passwordResetToken: token, passwordResetExpires: expires },
  }).catch(() => null);
  if (!user) return null;
  return { token, user: toStoredUser(user) };
}

export async function consumePasswordResetToken(
  token: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await prisma.user.findFirst({ where: { passwordResetToken: token } });
  if (!user) return { ok: false, error: 'Invalid or expired reset link.' };
  if (user.passwordResetExpires && new Date(user.passwordResetExpires) < new Date()) {
    return { ok: false, error: 'Reset link has expired. Please request a new one.' };
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetToken:   null,
      passwordResetExpires: null,
    },
  });
  return { ok: true };
}

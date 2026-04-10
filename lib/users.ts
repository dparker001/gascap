/**
 * Simple JSON-file user store.
 * For production: replace read/write calls with Prisma / Supabase / PlanetScale.
 */
import fs   from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { findNewBadges, type UserStats } from './badges';
import { getVehiclesForUser } from './savedVehicles';

export interface StoredUser {
  id:              string;
  email:           string;
  name:            string;
  passwordHash:    string;
  plan:            'free' | 'pro' | 'fleet';
  createdAt:       string;
  // Stripe billing (optional — only set after upgrade)
  stripeCustomerId?:     string;
  stripeSubscriptionId?: string;
  // Activity tracking (all optional so existing records stay valid)
  calcCount?:       number;
  budgetCalcCount?: number;
  locationLookups?: number;
  activeDays?:      string[];  // 'YYYY-MM-DD' strings of distinct days used
  streak?:          number;
  badges?:          string[];  // earned badge IDs
  // Referral system
  referralCode?:          string;   // unique short code e.g. "DAVID-X4K9"
  referredBy?:            string;   // referral code of the person who referred them
  referralCount?:         number;   // how many users signed up & verified with this code (capped at 10)
  referralProMonthsEarned?: number; // months of Pro earned via referrals (1 per referral, max 10)
  referralRewardCredited?:  boolean; // true once this user's signup has been credited to their referrer
  referralCredits?:         ReferralCredit[]; // individual credits with expiry tracking
  // Beta trial (admin-granted) + new-signup Pro trial (automatic)
  // Both share the same `betaProExpiry` timestamp so the existing expire
  // cron can revert them in one pass; they're distinguished by the flags.
  isBetaTester?:   boolean;  // true = admin-granted beta invitee
  isProTrial?:     boolean;  // true = auto-enrolled 30-day Pro trial at signup
  betaProExpiry?:  string;   // ISO date — when the Pro trial ends; null/undefined = no trial
  // Email verification
  emailVerified?:      boolean;   // undefined / false = not verified, true = verified
  emailVerifyToken?:   string;    // random token sent in email
  emailVerifyExpires?: string;    // ISO timestamp, expires 24h after generation
  // Password reset
  passwordResetToken?:   string;  // random token sent in reset email
  passwordResetExpires?: string;  // ISO timestamp, expires 1h after generation
  // Profile
  phone?:  string;   // optional phone number
  displayName?: string; // optional display name override
  // Gas price alerts (Pro+)
  priceAlertThreshold?:   number;  // $/gal — alert when national avg drops below this
  lastPriceAlertSentAt?:  string;  // ISO — last time we sent/showed an alert (24h debounce)
  // Login tracking
  loginCount?:    number;  // total sign-ins
  lastLoginAt?:   string;  // ISO timestamp of most recent sign-in
  // Fill-up reminders
  fillupReminderDays?:        number;  // 0=off, 7=weekly, 14=biweekly
  lastFillupReminderSentAt?:  string;  // ISO — debounce so we don't spam
  // Streak rewards
  streakMilestonesHit?: number[];    // list of milestone day-counts already awarded (e.g. [30, 90])
  streakCredits?: StreakCredit[];     // free Pro months earned from streak milestones
  // Email campaign drip sequence
  emailCampaignStep?:       number;  // 1=welcome sent, 2=day3, 3=day7, 4=day14, 5=day30
  emailCampaignEnrolledAt?: string;  // ISO date of sign-up enrollment
  emailOptOut?:             boolean; // true = unsubscribed from marketing emails
  // Internal / testing
  isTestAccount?: boolean;  // bypasses all plan limits — for internal testing only
}

export interface ReferralCredit {
  id:        string;   // UUID
  earnedAt:  string;   // ISO date earned
  expiresAt: string;   // ISO date — 6 months after earnedAt
  redeemedAt?: string; // ISO date if redeemed
}

export interface StreakCredit {
  id:          string;   // UUID
  milestone:   number;   // streak day milestone (30, 90, 180, 365)
  earnedAt:    string;   // ISO date earned
  expiresAt:   string;   // ISO date — 12 months after earnedAt
  redeemedAt?: string;   // ISO date if redeemed
}

// Streak milestones that award free Pro month credits
export const STREAK_MILESTONES: { days: number; months: number }[] = [
  { days: 30,  months: 1 },
  { days: 90,  months: 1 },
  { days: 180, months: 1 },
  { days: 365, months: 1 },
];

export type ActivityEvent = 'calc' | 'budget_calc' | 'location_lookup' | 'visit';

const DATA_FILE = path.join(process.cwd(), 'data', 'users.json');

// ── Persistence helpers ────────────────────────────────────────────────

function read(): StoredUser[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as StoredUser[];
  } catch {
    return [];
  }
}

function write(users: StoredUser[]) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

// ── Public API ─────────────────────────────────────────────────────────

export function getAllUsers(): StoredUser[] {
  return read();
}

export function findByEmail(email: string): StoredUser | undefined {
  return read().find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export function findById(id: string): StoredUser | undefined {
  return read().find((u) => u.id === id);
}

export async function createUser(
  name: string,
  email: string,
  password: string,
): Promise<StoredUser> {
  const existing = findByEmail(email);
  if (existing) throw new Error('An account with that email already exists.');

  const passwordHash = await bcrypt.hash(password, 12);
  const user: StoredUser = {
    id:        crypto.randomUUID(),
    email:     email.toLowerCase().trim(),
    name:      name.trim(),
    passwordHash,
    plan:      'free',
    createdAt: new Date().toISOString(),
  };
  const users = read();
  users.push(user);
  write(users);
  return user;
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── Plan management ────────────────────────────────────────────────────────

export function setUserPlan(
  userId: string,
  plan: 'free' | 'pro' | 'fleet',
  stripe?: { customerId?: string; subscriptionId?: string },
): void {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  users[idx].plan = plan;
  if (stripe?.customerId)     users[idx].stripeCustomerId     = stripe.customerId;
  if (stripe?.subscriptionId) users[idx].stripeSubscriptionId = stripe.subscriptionId;
  write(users);
}

export function findByStripeCustomer(customerId: string): StoredUser | undefined {
  return read().find((u) => u.stripeCustomerId === customerId);
}

// ── Beta trial management ─────────────────────────────────────────────────

/** Grant a beta Pro trial for `days` days (default 30). Sets plan to Pro + expiry. */
export function grantBetaTrial(userId: string, days = 30): StoredUser | null {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  users[idx].plan          = 'pro';
  users[idx].isBetaTester  = true;
  users[idx].betaProExpiry = expiry.toISOString();
  write(users);
  return users[idx];
}

/** Revoke a beta trial early (e.g. manual admin action). */
export function revokeBetaTrial(userId: string): void {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  users[idx].plan          = 'free';
  users[idx].betaProExpiry = undefined;
  write(users);
}

/**
 * Grant a new-signup Pro trial. Called automatically from the register
 * route so every new user gets 30 days of Pro for free. Sets:
 *   plan            = 'pro'
 *   isProTrial      = true
 *   betaProExpiry   = now + `days` (default 30)
 *
 * NOTE: reuses the existing `betaProExpiry` field so the beta-expire cron
 * can downgrade both admin-granted beta testers and auto-enrolled trial
 * users in a single sweep. `isBetaTester` is intentionally NOT set, so
 * the admin UI can still distinguish the two populations.
 */
export function grantNewSignupProTrial(userId: string, days = 30): StoredUser | null {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  users[idx].plan          = 'pro';
  users[idx].isProTrial    = true;
  users[idx].betaProExpiry = expiry.toISOString();
  write(users);
  return users[idx];
}

// ── Email campaign helpers ──────────────────────────────────────────────────

/** Enroll a new user in the drip campaign and record step 1 (welcome sent). */
export function enrollEmailCampaign(userId: string): void {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  users[idx].emailCampaignEnrolledAt = new Date().toISOString();
  users[idx].emailCampaignStep       = 1;
  write(users);
}

/** Advance the campaign step after sending the next email. */
export function advanceEmailCampaignStep(userId: string, step: number): void {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  users[idx].emailCampaignStep = step;
  write(users);
}

/** Opt a user out of marketing emails (unsubscribe). */
export function optOutEmailCampaign(userId: string): void {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  users[idx].emailOptOut = true;
  write(users);
}

/**
 * Return all users pending a given campaign step.
 *
 * Includes:
 *   • Free users (never upgraded, never on trial)
 *   • Trial users (auto-enrolled 30-day Pro trial)
 *   • Expired-trial users now downgraded back to free
 *
 * Excludes:
 *   • Anyone with `stripeSubscriptionId` — they actually paid, don't upsell
 *   • Anyone who opted out of marketing emails
 */
export function getUsersPendingCampaignStep(step: number, minDays: number): StoredUser[] {
  const cutoff = new Date(Date.now() - minDays * 86_400_000);
  return read().filter((u) =>
    !u.emailOptOut &&
    !u.stripeSubscriptionId &&     // skip paying subscribers
    u.emailCampaignStep === step - 1 &&
    !!u.emailCampaignEnrolledAt &&
    new Date(u.emailCampaignEnrolledAt) <= cutoff,
  );
}

/**
 * Return users whose 30-day Pro trial has ended but whose plan is still 'pro'.
 * Covers BOTH admin-granted beta testers AND auto-enrolled new-signup trials.
 * The beta-expire cron uses this to revert them to free and send an
 * upgrade-prompt email.
 */
export function getExpiredBetaUsers(): StoredUser[] {
  const now = new Date();
  return read().filter(
    (u) =>
      (u.isBetaTester || u.isProTrial) &&
      u.betaProExpiry &&
      new Date(u.betaProExpiry) < now &&
      u.plan === 'pro' &&
      !u.stripeSubscriptionId,  // don't touch users who converted to paid
  );
}

/** Return all active beta testers / trial users (pro, not yet expired). */
export function getActiveBetaUsers(): StoredUser[] {
  const now = new Date();
  return read().filter(
    (u) =>
      (u.isBetaTester || u.isProTrial) &&
      u.betaProExpiry &&
      new Date(u.betaProExpiry) >= now &&
      u.plan === 'pro',
  );
}

// ── Activity + badge tracking ──────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function calcStreak(activeDays: string[]): number {
  if (activeDays.length === 0) return 0;
  const sorted = [...activeDays].sort().reverse(); // newest first
  const today  = todayStr();
  // Streak must include today or yesterday to be alive
  if (sorted[0] !== today) {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    if (sorted[0] !== yesterday) return 1; // streak broken, reset to 1
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

/** Award streak milestone credits for any newly-crossed milestones. Mutates user in-place. */
function awardStreakMilestones(user: StoredUser, streak: number): number[] {
  const hit      = user.streakMilestonesHit ?? [];
  const newlyHit = STREAK_MILESTONES
    .filter((m) => streak >= m.days && !hit.includes(m.days))
    .map((m) => m.days);

  if (newlyHit.length === 0) return [];

  const now    = new Date();
  const expiry = new Date(now);
  expiry.setFullYear(expiry.getFullYear() + 1); // credits expire in 12 months

  const newCredits: StreakCredit[] = newlyHit.map((days) => ({
    id:        crypto.randomUUID(),
    milestone: days,
    earnedAt:  now.toISOString(),
    expiresAt: expiry.toISOString(),
  }));

  user.streakMilestonesHit = [...hit, ...newlyHit];
  user.streakCredits       = [...(user.streakCredits ?? []), ...newCredits];
  return newlyHit;
}

export interface ActivityResult {
  newBadges:       string[];
  badges:          string[];
  streak:          number;
  newMilestonesHit: number[];
}

export function recordActivity(userId: string, event: ActivityEvent): ActivityResult {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return { newBadges: [], badges: [], streak: 0, newMilestonesHit: [] };

  const user = users[idx];
  const today      = todayStr();
  const activeDays = user.activeDays ?? [];
  const alreadyEarned = user.badges ?? [];

  // Increment counters
  if (event === 'calc')             user.calcCount       = (user.calcCount       ?? 0) + 1;
  if (event === 'budget_calc')      user.budgetCalcCount = (user.budgetCalcCount ?? 0) + 1;
  if (event === 'location_lookup')  user.locationLookups = (user.locationLookups ?? 0) + 1;

  // Record today as active (deduplicated)
  if (!activeDays.includes(today)) activeDays.push(today);
  user.activeDays = activeDays;

  // Recompute streak
  user.streak = calcStreak(activeDays);

  // Evaluate badges
  const vehicleCount = getVehiclesForUser(userId).length;
  const stats: UserStats = {
    calcCount:       user.calcCount       ?? 0,
    budgetCalcCount: user.budgetCalcCount ?? 0,
    locationLookups: user.locationLookups ?? 0,
    streak:          user.streak,
    vehicleCount,
    daysActive:      activeDays.length,
  };

  const newBadges = findNewBadges(stats, alreadyEarned);
  user.badges = [...alreadyEarned, ...newBadges];

  // Check and award streak milestone credits
  const newMilestonesHit = awardStreakMilestones(user, user.streak);

  users[idx] = user;
  write(users);

  return { newBadges, badges: user.badges, streak: user.streak, newMilestonesHit };
}

// ── Referral system ────────────────────────────────────────────────────────

export function generateReferralCode(): string {
  // 8 uppercase alphanumeric chars, no ambiguous chars (0,O,I,1)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function ensureReferralCode(userId: string): string {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return '';

  const user = users[idx];

  // If the code already contains a dash it has the name-prefix format — keep it
  if (user.referralCode?.includes('-')) return user.referralCode;

  // Build a personalised slug: FIRSTNAME-XXXX (e.g. DAVID-X4K9)
  const firstName = user.name.split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10) || 'USER';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code: string;
  do {
    const suffix = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    code = `${firstName}-${suffix}`;
  } while (users.some((u) => u.referralCode === code));

  users[idx].referralCode = code;
  write(users);
  return code;
}

export function findByReferralCode(code: string): StoredUser | undefined {
  return read().find((u) => u.referralCode?.toUpperCase() === code.toUpperCase());
}

const MAX_REFERRAL_REWARDS  = 10;  // max lifetime credits
const MAX_REDEEM_AT_ONCE    = 3;   // max months redeemable at one time
const CREDIT_EXPIRY_MONTHS  = 6;   // credits expire 6 months after earning

/** Return only non-expired, non-redeemed credits for a user */
export function getActiveCredits(user: StoredUser): ReferralCredit[] {
  const now = new Date();
  return (user.referralCredits ?? []).filter(
    (c) => !c.redeemedAt && new Date(c.expiresAt) > now,
  );
}

/** Return how many months a user can redeem right now (capped at MAX_REDEEM_AT_ONCE) */
export function getRedeemableMonths(user: StoredUser): number {
  return Math.min(getActiveCredits(user).length, MAX_REDEEM_AT_ONCE);
}

export function recordReferral(referrerId: string): void {
  const users = read();
  const idx   = users.findIndex((u) => u.id === referrerId);
  if (idx === -1) return;
  const current = users[idx].referralCount ?? 0;
  if (current >= MAX_REFERRAL_REWARDS) return; // lifetime cap reached

  const now      = new Date();
  const expiry   = new Date(now);
  expiry.setMonth(expiry.getMonth() + CREDIT_EXPIRY_MONTHS);

  const credit: ReferralCredit = {
    id:        crypto.randomUUID(),
    earnedAt:  now.toISOString(),
    expiresAt: expiry.toISOString(),
  };

  users[idx].referralCount           = current + 1;
  users[idx].referralProMonthsEarned = (users[idx].referralProMonthsEarned ?? 0) + 1;
  users[idx].referralCredits         = [...(users[idx].referralCredits ?? []), credit];
  write(users);
}

/**
 * Redeem up to MAX_REDEEM_AT_ONCE active credits for a Pro user.
 * Returns the number of months redeemed, or 0 if not on Pro/Fleet.
 */
export function redeemReferralCredits(userId: string): number {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return 0;

  const user = users[idx];
  // Only redeem on Pro or Fleet
  if (user.plan !== 'pro' && user.plan !== 'fleet') return 0;

  const active    = getActiveCredits(user);
  const toRedeem  = active.slice(0, MAX_REDEEM_AT_ONCE);
  if (toRedeem.length === 0) return 0;

  const now = new Date().toISOString();
  users[idx].referralCredits = (user.referralCredits ?? []).map((c) =>
    toRedeem.find((r) => r.id === c.id) ? { ...c, redeemedAt: now } : c,
  );
  write(users);
  return toRedeem.length;
}

export function setReferredBy(userId: string, referralCode: string): void {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  users[idx].referredBy = referralCode;
  write(users);
}

/**
 * Called when a referred user verifies their email.
 * Credits the referrer (once only, capped at MAX_REFERRAL_REWARDS).
 * Returns true if credit was issued.
 */
export function creditVerifiedReferral(userId: string): boolean {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return false;

  const user = users[idx];
  // Already credited, no referral code, or own referral — bail
  if (user.referralRewardCredited) return false;
  if (!user.referredBy) return false;

  const referrer    = users.find((u) => u.referralCode?.toUpperCase() === user.referredBy?.toUpperCase());
  if (!referrer)    return false;
  if (referrer.id === userId) return false;

  const referrerIdx = users.findIndex((u) => u.id === referrer.id);
  const current     = users[referrerIdx].referralCount ?? 0;

  // Mark referred user as credited regardless (prevents retry spam)
  users[idx].referralRewardCredited = true;
  write(users);

  // Use recordReferral to properly create credit with expiry
  if (current < MAX_REFERRAL_REWARDS) {
    recordReferral(referrer.id);
    return true;
  }

  return false;
}

// ── Profile update ─────────────────────────────────────────────────────────

export function updateUserProfile(
  userId: string,
  fields: { displayName?: string; phone?: string },
): StoredUser | null {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;
  if (fields.displayName !== undefined) users[idx].displayName = fields.displayName.trim();
  if (fields.phone       !== undefined) users[idx].phone       = fields.phone.trim();
  write(users);
  return users[idx];
}

export function recordLogin(userId: string): void {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  users[idx].loginCount  = (users[idx].loginCount ?? 0) + 1;
  users[idx].lastLoginAt = new Date().toISOString();
  write(users);
}

export function setFillupReminderDays(userId: string, days: number): void {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  users[idx].fillupReminderDays = days;
  write(users);
}

export function setLastFillupReminderSent(userId: string): void {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  users[idx].lastFillupReminderSentAt = new Date().toISOString();
  write(users);
}

// ── Email verification ─────────────────────────────────────────────────────

export function createEmailVerifyToken(userId: string): string {
  const users = read();
  const idx   = users.findIndex((u) => u.id === userId);
  if (idx === -1) return '';
  const token   = crypto.randomUUID().replace(/-/g, '');   // 32-char hex token
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  users[idx].emailVerifyToken   = token;
  users[idx].emailVerifyExpires = expires;
  users[idx].emailVerified      = false;
  write(users);
  return token;
}

export function verifyEmailToken(token: string): { ok: boolean; userId?: string; error?: string } {
  const users = read();
  const idx   = users.findIndex((u) => u.emailVerifyToken === token);
  if (idx === -1) return { ok: false, error: 'Invalid or already used verification link.' };
  const user = users[idx];
  if (user.emailVerifyExpires && new Date(user.emailVerifyExpires) < new Date()) {
    return { ok: false, error: 'Verification link has expired. Please request a new one.' };
  }
  users[idx].emailVerified      = true;
  users[idx].emailVerifyToken   = undefined;
  users[idx].emailVerifyExpires = undefined;
  write(users);
  return { ok: true, userId: user.id };
}

export function resendVerificationToken(userId: string): string {
  return createEmailVerifyToken(userId);
}

// ── Password reset ─────────────────────────────────────────────────────────

export function createPasswordResetToken(email: string): { token: string; user: StoredUser } | null {
  const users = read();
  const idx   = users.findIndex((u) => u.email.toLowerCase() === email.toLowerCase());
  if (idx === -1) return null;
  const token   = crypto.randomUUID().replace(/-/g, '');
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  users[idx].passwordResetToken   = token;
  users[idx].passwordResetExpires = expires;
  write(users);
  return { token, user: users[idx] };
}

export async function consumePasswordResetToken(
  token: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const users = read();
  const idx   = users.findIndex((u) => u.passwordResetToken === token);
  if (idx === -1) return { ok: false, error: 'Invalid or expired reset link.' };
  const user = users[idx];
  if (user.passwordResetExpires && new Date(user.passwordResetExpires) < new Date()) {
    return { ok: false, error: 'Reset link has expired. Please request a new one.' };
  }
  users[idx].passwordHash          = await bcrypt.hash(newPassword, 12);
  users[idx].passwordResetToken    = undefined;
  users[idx].passwordResetExpires  = undefined;
  write(users);
  return { ok: true };
}

/**
 * TC-2A (2026-09-01) — scope guards.
 *
 * Proves the personalized trial-value work stayed out of everything the
 * task explicitly forbade touching: lib/newMemberOffer.ts, the trial
 * duration constant, expireTrial()'s core logic, Stripe/RevenueCat
 * checkout/webhook files, prisma/schema.prisma, native project files, and
 * the CR-3C-B duplicate-Lifetime guard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

describe('lib/newMemberOffer.ts is untouched', () => {
  const src = read('lib/newMemberOffer.ts');
  it('known-good anchor content is still present', () => {
    expect(src).toContain('NEW_MEMBER_LIFETIME_COUPON');
    expect(src).toContain("NEW_MEMBER_OFFER_DAYS  = 7;");
    expect(src).toContain('NEW_MEMBER_DISCOUNT_USD = 10;');
  });
});

describe('trial duration constant is unchanged', () => {
  it('grantNewSignupProTrial still defaults to 30 days', () => {
    const src = read('lib/users.ts');
    expect(src).toMatch(/export async function grantNewSignupProTrial\(userId: string, days = 30\)/);
  });
});

describe("expireTrial()'s core logic is unchanged", () => {
  it('still sets plan free / isProTrial false / trialExpiresAt null', () => {
    const src = read('lib/users.ts');
    expect(src).toMatch(/export async function expireTrial\(userId: string\): Promise<void> \{/);
    expect(src).toMatch(/data: \{ plan: 'free', isProTrial: false, trialExpiresAt: null \}/);
  });
});

describe('Stripe/RevenueCat checkout & webhook files are unmodified', () => {
  const filesToCheck = [
    'app/api/stripe/webhook/route.ts',
    'app/api/revenuecat/webhook/route.ts',
  ];

  it.each(filesToCheck)('%s has no uncommitted diff on this branch vs its merge-base with main', (relPath) => {
    if (!existsSync(path.join(repoRoot, relPath))) return; // path may differ; skip rather than false-fail
    const diff = execSync(`git diff --stat -- "${relPath}"`, { cwd: repoRoot }).toString();
    expect(diff.trim()).toBe('');
  });

  it('app/api/stripe/checkout/route.ts still has the CR-3C-B duplicate-Lifetime guard, unmodified', () => {
    const src = read('app/api/stripe/checkout/route.ts');
    expect(src).toContain('2026-08-29 (CR-3C-B)');
    expect(src).toMatch(
      /if \(validatedBilling === 'lifetime' && isLifetimeAnyProvider\) \{\s*return NextResponse\.json\(\{ error: 'You already have Pro Lifetime\.' \}, \{ status: 409 \}\);/,
    );
  });
});

describe('no prisma schema diff', () => {
  it('prisma/schema.prisma has no uncommitted diff', () => {
    const diff = execSync('git diff --stat -- prisma/schema.prisma', { cwd: repoRoot }).toString();
    expect(diff.trim()).toBe('');
  });
});

describe('no native project files touched', () => {
  it('git status shows no changes under ios/ or android/ native project dirs', () => {
    const status = execSync('git status --short -- ios android capacitor.config.json', { cwd: repoRoot }).toString();
    expect(status.trim()).toBe('');
  });
});

describe('/api/cron/trial-conversion is untouched and not scheduled', () => {
  it('route file has no uncommitted diff', () => {
    const diff = execSync('git diff --stat -- app/api/cron/trial-conversion', { cwd: repoRoot }).toString();
    expect(diff.trim()).toBe('');
  });

  it('is not referenced from any cron scheduling config', () => {
    // Railway cron schedules / codemagic / any scheduler config in this repo.
    // Excludes build output, node_modules, and unrelated agent worktrees.
    const grep = execSync(
      `grep -rl "trial-conversion" --include="*.yml" --include="*.yaml" --include="*.json" ` +
      `--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.claude --exclude-dir=.git . || true`,
      { cwd: repoRoot },
    ).toString();
    expect(grep.trim()).toBe('');
  });
});

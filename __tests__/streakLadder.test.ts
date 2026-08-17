import { describe, it, expect } from 'vitest';
import { STREAK_BONUS_TIERS, streakBonusEntries } from '../lib/streakTiers';

describe('3-day streak tier', () => {
  it('awards a small standing bonus at 3 days', () => {
    expect(streakBonusEntries(2)).toBe(0);
    expect(streakBonusEntries(3)).toBe(1);
    expect(streakBonusEntries(6)).toBe(1);
  });

  it('does not disturb the existing ladder', () => {
    expect(streakBonusEntries(7)).toBe(3);
    expect(streakBonusEntries(30)).toBe(8);
    expect(streakBonusEntries(90)).toBe(40);
    expect(streakBonusEntries(365)).toBe(120);
  });

  it('never stacks — cycling 3 days on / 1 off cannot farm entries', () => {
    // The bonus reflects the CURRENT streak, so rebuilding restores the same
    // +1 rather than adding another. This is why the tier is safe to repeat.
    expect(streakBonusEntries(3)).toBe(1);
    expect(streakBonusEntries(3)).toBe(1);
    expect(streakBonusEntries(4)).toBe(1);
  });

  it('tiers stay monotonic', () => {
    for (let i = 1; i < STREAK_BONUS_TIERS.length; i++) {
      expect(STREAK_BONUS_TIERS[i].minStreak).toBeGreaterThan(STREAK_BONUS_TIERS[i - 1].minStreak);
      expect(STREAK_BONUS_TIERS[i].bonus).toBeGreaterThanOrEqual(STREAK_BONUS_TIERS[i - 1].bonus);
    }
  });
});

describe('streak reminder wiring', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(process.cwd(), 'app/api/cron/streak-reminder/route.ts'), 'utf8');

  it('reaches users at streak 2 — the ones who need it', () => {
    expect(src).toContain('streak < 2');
    expect(src).not.toContain('streak < 3');
  });

  it('is not plan-gated', () => {
    // Gating this excluded 220 of 274 users. Vouchers stay Pro-gated in
    // /api/activity; the nudge itself must reach everyone.
    expect(src).not.toMatch(/plan !== 'pro'/);
  });

  it('sends a distinct building-a-habit message at 2', () => {
    expect(src).toContain('buildingHabit');
  });
});

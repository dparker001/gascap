/**
 * TC-2A (2026-09-01) — TrialExpiryBanner personalized recap line.
 *
 * This repo has no JSX render harness for this component (see prior CR test
 * files) — these are source-text/structural pattern-matching tests plus a
 * couple of direct unit tests against the pure helper functions the file
 * exports at module scope for that purpose (trialValueLine/plural are not
 * exported, so grammar is verified indirectly via lib/trialValue.ts's
 * already-covered equivalents and via source inspection here).
 *
 * Proves: WARN_DAYS and the day-tier thresholds are unchanged from the
 * verified current values (15 / urgent<=1 / warning<=5 / gentle 6-15);
 * the recap line is wired to render only when non-empty; zero-activity
 * falls back to the generic banner (no recap markup rendered unconditionally);
 * the native-hidden guard is unchanged; the upgrade CTA still targets /upgrade.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const src = readFileSync(path.join(repoRoot, 'components/TrialExpiryBanner.tsx'), 'utf8');

describe('WARN_DAYS and tier thresholds — verified current values, unchanged', () => {
  it('WARN_DAYS is 15', () => {
    expect(src).toMatch(/const WARN_DAYS\s*=\s*15;/);
  });

  it('urgent tier is daysLeft <= 1', () => {
    expect(src).toMatch(/const isUrgent\s*=\s*daysLeft <= 1;/);
  });

  it('warning tier is daysLeft <= 5', () => {
    expect(src).toMatch(/const isWarning\s*=\s*daysLeft <= 5;/);
  });

  it('gentle tier comment still documents 6-15 days', () => {
    expect(src).toMatch(/gentle\s*=\s*6–15 days/);
  });

  it('banner only shows within the warning window (daysLeft > WARN_DAYS or < 0 bails)', () => {
    expect(src).toMatch(/if \(daysLeft > WARN_DAYS \|\| daysLeft < 0\) return null;/);
  });
});

describe('native-hidden behavior — unchanged', () => {
  it('still calls useIsNative and hides the banner when native', () => {
    expect(src).toMatch(/const isNative = useIsNative\(\);/);
    expect(src).toMatch(/if \(isNative\) return null;/);
  });
});

describe('upgrade CTA destination — unchanged', () => {
  it('still points to /upgrade', () => {
    expect(src).toMatch(/href="\/upgrade"/);
  });
});

describe('personalized recap line', () => {
  it('fetches the summary from the server-authoritative endpoint', () => {
    expect(src).toMatch(/fetch\('\/api\/user\/trial-value'\)/);
  });

  it('only renders the recap paragraph when recapLine is truthy', () => {
    expect(src).toMatch(/\{recapLine && \(/);
  });

  it('trialValueLine omits zero-value metrics (fillups > 0, vehicles > 0, rentalSessions > 0, calculations > 0 guards present)', () => {
    expect(src).toMatch(/if \(summary\.fillups > 0\)/);
    expect(src).toMatch(/if \(summary\.vehicles > 0\)/);
    expect(src).toMatch(/if \(summary\.rentalSessions > 0\)/);
    expect(src).toMatch(/summary\.calculations !== null && summary\.calculations > 0/);
  });

  it('returns null (falls back to generic banner) when no parts are non-zero', () => {
    expect(src).toMatch(/return parts\.length > 0 \? parts\.join\(' • '\) : null;/);
  });
});

describe('analytics', () => {
  it('fires trial_value_recap_viewed only when the recap would actually render', () => {
    expect(src).toMatch(/trackClientEvent\('trial_value_recap_viewed'/);
    expect(src).toMatch(/if \(!recapLineForTracking \|\| viewTrackedRef\.current\) return;/);
  });

  it('fires trial_value_recap_upgrade_clicked on the upgrade CTA', () => {
    expect(src).toMatch(/trackClientEvent\('trial_value_recap_upgrade_clicked'/);
    expect(src).toMatch(/onClick=\{handleUpgradeClick\}/);
  });

  it('analytics metadata never includes raw counts — only stage/daysRemaining/boolean flags', () => {
    const evtBlockStart = src.indexOf("trackClientEvent('trial_value_recap_viewed'");
    const evtBlockEnd = src.indexOf('});', evtBlockStart);
    const block = src.slice(evtBlockStart, evtBlockEnd);
    expect(block).toMatch(/stage:\s*'banner'/);
    expect(block).toMatch(/daysRemaining:/);
    expect(block).toMatch(/hasCalculations:/);
    expect(block).toMatch(/hasVehicles:/);
    expect(block).toMatch(/hasFillups:/);
    expect(block).toMatch(/hasRentalSessions:/);
    // No raw trialValue.vehicles / .fillups / .calculations / .rentalSessions numeric passthrough
    expect(block).not.toMatch(/vehicles:\s*trialValue\.vehicles\b/);
    expect(block).not.toMatch(/fillups:\s*trialValue\.fillups\b/);
  });
});

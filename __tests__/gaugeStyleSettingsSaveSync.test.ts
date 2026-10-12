/**
 * Regression test for the "global fuel-gauge style doesn't take effect on
 * native/PWA" bug (found 2026-10-11).
 *
 * Root cause: handleGaugeStyleChange in app/settings/page.tsx persisted the
 * User-level global fuelGaugeStyle default to Postgres correctly, but — unlike
 * the Vehicle-level override save in components/SavedVehicles.tsx, which
 * dispatches a 'vehicle-saved' event right after its PATCH succeeds — it
 * never notified the already-mounted calculator components that listen for
 * that event (BudgetForm, TargetFillForm, TripCostEstimator) to refresh their
 * cached userGaugeStyle.
 *
 * On the web this is masked by a full page navigation to/from /settings,
 * which remounts everything. It reproduces every time on native/PWA, where
 * NativeAppShell keeps every tab mounted and only hides them: change the
 * style in Settings, see "Saved", switch to a calculator tab, and the old
 * style is still showing — indistinguishable from "it didn't save."
 *
 * This repo has no JSX render harness — these are source-text/structural
 * pattern-matching tests, same style as the CR-1/CR-2/CR-3 test files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const settingsPageSrc = readFileSync(path.join(repoRoot, 'app/settings/page.tsx'), 'utf8');
const savedVehiclesSrc = readFileSync(path.join(repoRoot, 'components/SavedVehicles.tsx'), 'utf8');

function extractFunctionBlock(src: string, signature: string, maxChars = 1400): string {
  const idx = src.indexOf(signature);
  if (idx === -1) throw new Error(`Could not find "${signature}" in source`);
  return src.slice(idx, idx + maxChars);
}

describe('global fuel-gauge style save notifies already-mounted consumers', () => {
  it('1. handleGaugeStyleChange dispatches the vehicle-saved event after a successful PATCH', () => {
    const block = extractFunctionBlock(settingsPageSrc, 'async function handleGaugeStyleChange');
    const resOkIdx = block.indexOf('if (res.ok)');
    expect(resOkIdx).toBeGreaterThan(-1);
    // The dispatch must be inside the res.ok success branch, not merely
    // present somewhere in the function (e.g. unconditionally, which would
    // fire even on a failed save).
    const successBranch = block.slice(resOkIdx);
    expect(successBranch).toMatch(/window\.dispatchEvent\(new Event\('vehicle-saved'\)\)/);
  });

  it('2. uses the exact event name the calculator components already listen for (not a new, unlistened-to event)', () => {
    expect(savedVehiclesSrc).toMatch(/window\.dispatchEvent\(new Event\('vehicle-saved'\)\)/);
    const block = extractFunctionBlock(settingsPageSrc, 'async function handleGaugeStyleChange');
    expect(block).toMatch(/'vehicle-saved'/);
  });
});

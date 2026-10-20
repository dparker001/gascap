/**
 * WS02 PR #87 review finding 3 — a deliberate clear must stay cleared.
 *
 * The PR claimed "a user's own choice, including a deliberate clear, is never
 * overridden". It wasn't true. The latch was:
 *
 *     if (selectedVehicleId) { autoAppliedRef.current = false; return; }
 *
 * which re-arms on every selection, so the NEXT transition to empty
 * auto-applies again.
 *
 * Repository truth established before fixing (components/TargetFillForm.tsx,
 * components/BudgetForm.tsx — both render SavedVehicles and keep it mounted):
 * there are FOUR paths that empty the vehicle, and all four are deliberate
 * user actions or a sign-out. None is a rental-mode exit, so the effect's
 * original "right after leaving Rental Mode" rationale (commit 5491a68, when
 * Rental Mode was a calculator toggle) no longer applies to anything.
 *
 * These are BEHAVIORAL sequence tests over the decision function — a run of
 * real user steps with state carried between them — not regexes over the
 * component and not a bare call to pickAutoSelectVehicle().
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { decideVehicleAutoApply, type AutoApplySkipReason } from '@/lib/vehicleAutoSelect';

const read = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8');

interface TestVehicle { id: string; gallons: number; isDefault?: boolean }

const CAR:   TestVehicle = { id: 'car',   gallons: 14 };
const TRUCK: TestVehicle = { id: 'truck', gallons: 26 };

/**
 * A tiny driver that mirrors the component: the latch is the only state
 * carried between steps, exactly as `appliedForUserRef` is.
 */
function makeSurface(opts: { userId: string | null; vehicles: TestVehicle[] }) {
  let appliedForUserId: string | null = null;
  let selectedVehicleId = '';
  let userId = opts.userId;
  const applied: string[] = [];

  /** One render pass of the auto-apply effect. */
  function render(): AutoApplySkipReason | 'applied' {
    const d = decideVehicleAutoApply({
      vehicles: opts.vehicles, selectedVehicleId, userId, appliedForUserId,
    });
    if (d.action === 'skip') return d.reason;
    appliedForUserId = userId;
    selectedVehicleId = d.vehicle.id;
    applied.push(d.vehicle.id);
    return 'applied';
  }

  return {
    render,
    applied,
    get selected() { return selectedVehicleId; },
    /** User taps a vehicle in the list. */
    select(id: string) { selectedVehicleId = id; },
    /** Any of the four real clear paths: tank preset, manual tank, Clear All, sign-out. */
    clear() { selectedVehicleId = ''; },
    signOut() { userId = null; selectedVehicleId = ''; },
    signInAs(id: string) { userId = id; },
  };
}

/** The shipped latch, for the before/after comparison. */
function legacyLatch(steps: ('render' | 'select' | 'clear')[], vehicles: TestVehicle[]) {
  let autoApplied = false;
  let selected = '';
  const applied: string[] = [];
  for (const step of steps) {
    if (step === 'select') { selected = 'truck'; continue; }
    if (step === 'clear')  { selected = '';      continue; }
    if (selected) { autoApplied = false; continue; }
    if (autoApplied) continue;
    const v = vehicles.find((x) => x.isDefault) ?? (vehicles.length === 1 ? vehicles[0] : undefined);
    if (v) { autoApplied = true; selected = v.id; applied.push(v.id); }
  }
  return applied;
}

describe('the bug being fixed', () => {
  it('OLD latch: a deliberate clear is immediately undone', () => {
    // load → auto-apply → user picks another → user clears → re-applied.
    expect(legacyLatch(['render', 'select', 'render', 'clear', 'render'], [CAR]))
      .toEqual(['car', 'car']);
  });

  it('NEW latch: the same sequence respects the clear', () => {
    const s = makeSurface({ userId: 'u1', vehicles: [CAR] });
    expect(s.render()).toBe('applied');
    expect(s.selected).toBe('car');

    s.select('truck');
    expect(s.render()).toBe('already-selected');

    s.clear();                                  // deliberate
    expect(s.render()).toBe('already-applied');
    expect(s.selected).toBe('');                // stays cleared
    expect(s.applied).toEqual(['car']);         // applied exactly once
  });

  it('repeated renders after a clear keep leaving it cleared', () => {
    const s = makeSurface({ userId: 'u1', vehicles: [CAR] });
    s.render();
    s.clear();
    for (let i = 0; i < 5; i++) expect(s.render()).toBe('already-applied');
    expect(s.selected).toBe('');
  });
});

describe('the four real clear paths, end to end', () => {
  // Each is the same transition from the decision layer's point of view; they
  // are enumerated so a future change to any one of them has a test naming it.
  it.each([
    ['picking a generic tank-size preset (TankPresets onPresetSelect)'],
    ['typing a tank size by hand (TankPresets onChange)'],
    ['tapping "Clear All" (handleReset → DEFAULTS)'],
  ])('%s is respected', () => {
    const s = makeSurface({ userId: 'u1', vehicles: [CAR] });
    s.render();                 // initial auto-apply
    s.clear();                  // the path under test
    expect(s.render()).toBe('already-applied');
    expect(s.selected).toBe('');
  });

  it('the damaging case: a preset tank size is not overwritten by the saved vehicle', () => {
    // This is what the old latch actually did to users: they chose "16 gal"
    // from the preset list, which clears the vehicle, and the effect
    // immediately re-applied their car — replacing the 16 with the car's tank.
    const s = makeSurface({ userId: 'u1', vehicles: [CAR] });
    s.render();
    let tankCapacity = '14';    // from the auto-applied car

    s.clear();                  // preset selected
    tankCapacity = '16';
    if (s.render() === 'applied') tankCapacity = '14';   // what the old latch did

    expect(tankCapacity).toBe('16');
  });

  it('sign-out never applies, and cannot leak the previous account s vehicle', () => {
    const s = makeSurface({ userId: 'u1', vehicles: [CAR, TRUCK] });
    s.signOut();
    expect(s.render()).toBe('no-user');
    expect(s.selected).toBe('');
  });
});

describe('the wanted auto-selection behaviour is preserved', () => {
  it('an explicit default wins, even among several', () => {
    const s = makeSurface({ userId: 'u1', vehicles: [CAR, { ...TRUCK, isDefault: true }] });
    expect(s.render()).toBe('applied');
    expect(s.selected).toBe('truck');
  });

  it('exactly one eligible vehicle auto-selects without a star', () => {
    const s = makeSurface({ userId: 'u1', vehicles: [CAR] });
    expect(s.render()).toBe('applied');
    expect(s.selected).toBe('car');
  });

  it('two or more with no default stays the user s decision', () => {
    const s = makeSurface({ userId: 'u1', vehicles: [CAR, TRUCK] });
    expect(s.render()).toBe('no-candidate');
    expect(s.selected).toBe('');
  });

  it('no-candidate does NOT consume the account s one apply', () => {
    // Three unstarred cars, then the user stars one: it must still apply.
    const vehicles: TestVehicle[] = [CAR, TRUCK, { id: 'van', gallons: 20 }];
    const s = makeSurface({ userId: 'u1', vehicles });
    expect(s.render()).toBe('no-candidate');
    vehicles[1].isDefault = true;
    expect(s.render()).toBe('applied');
    expect(s.selected).toBe('truck');
  });

  it('an empty garage waits, then applies once vehicles load', () => {
    const vehicles: TestVehicle[] = [];
    const s = makeSurface({ userId: 'u1', vehicles });
    expect(s.render()).toBe('no-candidate');
    vehicles.push(CAR);
    expect(s.render()).toBe('applied');
  });

  it('undefined vehicles (still loading) is not an error', () => {
    expect(decideVehicleAutoApply({
      vehicles: undefined, selectedVehicleId: '', userId: 'u1', appliedForUserId: null,
    })).toEqual({ action: 'skip', reason: 'no-candidate' });
  });

  it('a different account signing in gets its own one apply', () => {
    const s = makeSurface({ userId: 'u1', vehicles: [CAR] });
    s.render();
    s.clear();
    expect(s.render()).toBe('already-applied');

    s.signOut();
    expect(s.render()).toBe('no-user');

    s.signInAs('u2');
    expect(s.render()).toBe('applied');     // fresh account, fresh apply
  });

  it('an ineligible vehicle is never applied', () => {
    const s = makeSurface({ userId: 'u1', vehicles: [{ id: 'broken', gallons: 0 }] });
    expect(s.render()).toBe('no-candidate');
  });
});

describe('the component actually uses this decision', () => {
  const src = read('components/SavedVehicles.tsx');

  it('SavedVehicles calls decideVehicleAutoApply and latches on the account', () => {
    expect(src).toMatch(/decideVehicleAutoApply\(/);
    expect(src).toMatch(/appliedForUserRef/);
    expect(src).toMatch(/appliedForUserId:\s+appliedForUserRef\.current/);
  });

  it('the latch is written exactly once, and only to the current account', () => {
    // Structural, not prose-sensitive: the only assignment to the latch is the
    // one that records this account's single apply. A re-arming assignment
    // (the old `= false`) would show up as a second write.
    const writes = src.match(/appliedForUserRef\.current\s*=/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(src).toMatch(/appliedForUserRef\.current = sessionUserId;/);
  });

  it('the effect re-runs on an account change, so a new user still gets their apply', () => {
    expect(src).toMatch(/\}, \[data, selectedVehicleId, onSelect, sessionUserId\]\)/);
  });
});

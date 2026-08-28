/**
 * 2026-08-28 hardening — confirmation-gating for RentalSession.currentFuelGallons
 * (a last-known/last-reported value, never live telemetry), plus the
 * 2026-08-28 SAME-DAY correction round from independent (ChatGPT) review.
 * Covers:
 *   - the confirmation vs. RESULT invalidation split (Correction 3)
 *   - the hero no longer claiming a return-ready verdict from unconfirmed
 *     fuel (Correction 4)
 *   - genuine-observation enforcement via FuelLevelInput (Correction 5)
 *   - the manual-PATCH source allow-list, now excluding RECEIPT (Correction 6)
 *   - gallons/source pairing on the PATCH contract (Correction 7)
 *   - the in-flight-save guard against a stale async response (Correction 8)
 *   - TOCTOU/optimistic-concurrency + HTTP 409 (Corrections 9/10)
 *   - the removed requiresCurrentFuelConfirmation() helper (Correction 11,
 *     Option A)
 *   - analytics semantics (Correction 12)
 *
 * This repo has no JSX render harness — see __tests__/rentalTripFillCalculator.test.ts's
 * header comment for the established source-text-pattern-matching style,
 * used throughout this file for RentalDashboard.tsx/route.ts assertions.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { gallonsNeeded, tripFillEstimate, returnReadyStatus } from '../lib/rentalCalculations';
import { FUEL_DATA_SOURCES } from '../lib/rentalProvider';

const dashboardSrc = readFileSync(
  join(__dirname, '../components/rental-return/RentalDashboard.tsx'),
  'utf8',
);
const routeSrc = readFileSync(
  join(__dirname, '../app/api/rental-sessions/[id]/route.ts'),
  'utf8',
);
const rentalSessionsSrc = readFileSync(
  join(__dirname, '../lib/rentalSessions.ts'),
  'utf8',
);
const calculationsSrc = readFileSync(
  join(__dirname, '../lib/rentalCalculations.ts'),
  'utf8',
);

describe('Correction 11 — requiresCurrentFuelConfirmation() removed (Option A)', () => {
  it('the single-argument helper no longer exists anywhere in the calculation engine', () => {
    expect(calculationsSrc).not.toMatch(/export function requiresCurrentFuelConfirmation/);
  });

  it('RentalDashboard no longer imports or calls it — the explicit state machine is the sole enforcement', () => {
    expect(dashboardSrc).not.toMatch(/requiresCurrentFuelConfirmation/);
  });

  it('FUEL_DATA_SOURCES still contains RENTAL_COMPANY_API and VEHICLE_TELEMATICS — a future two-axis helper still has something to key off of', () => {
    expect(FUEL_DATA_SOURCES).toContain('RENTAL_COMPANY_API');
    expect(FUEL_DATA_SOURCES).toContain('VEHICLE_TELEMATICS');
  });
});

describe('Calculators are gated behind CONFIRMED fuel, never the raw last-known value', () => {
  it('tripFillEstimate()/gallonsNeeded()/returnReadyStatus() are unchanged pure formulas — the gate lives in the caller', () => {
    expect(tripFillEstimate(10, 12, 14).gallonsToAdd).toBe(2);
    expect(gallonsNeeded(14, 10)).toBe(4);
    expect(returnReadyStatus(10, 14)).toBe('needs_fuel');
  });

  it('RentalDashboard calls tripFillEstimate()/gallonsNeeded() with confirmed*, not raw session.currentFuelGallons, inside the two accordions', () => {
    const addFuelStart = dashboardSrc.indexOf('ADD FUEL DURING RENTAL');
    const addFuelEnd = dashboardSrc.indexOf('PREPARE FOR RETURN — expanded content', addFuelStart);
    const addFuelBlock = dashboardSrc.slice(addFuelStart, addFuelEnd);
    expect(addFuelBlock).toMatch(/tripFillEstimate\(\s*confirmedGallons,/);
    expect(addFuelBlock).not.toMatch(/tripFillEstimate\(\s*session\.currentFuelGallons,/);

    const prepareStart = dashboardSrc.indexOf('const prepareReturnContent');
    const prepareBlock = dashboardSrc.slice(prepareStart, prepareStart + 6000);
    expect(prepareBlock).toMatch(/gallonsNeeded\(session\.requiredReturnFuelGallons \?\? 0, confirmedGallons\)/);
  });

  it('a stored value alone never enables Calculate — both Calculate buttons are conditionally rendered behind a confirmedGallons != null check', () => {
    const addFuelStart = dashboardSrc.indexOf('ADD FUEL DURING RENTAL');
    const addFuelEnd = dashboardSrc.indexOf('PREPARE FOR RETURN — expanded content', addFuelStart);
    const addFuelBlock = dashboardSrc.slice(addFuelStart, addFuelEnd);
    expect(addFuelBlock).toMatch(/confirmedGallons != null && tripDesiredGallonsRaw != null && \(\s*<button/);

    const prepareStart = dashboardSrc.indexOf('const prepareReturnContent');
    const prepareBlock = dashboardSrc.slice(prepareStart, prepareStart + 6000);
    expect(prepareBlock).toMatch(/confirmFuelToCheckReturnStatus/);
  });
});

describe('Correction 5 — genuine observation enforced via FuelLevelInput', () => {
  it('the confirm panel resolves confirmPendingFuel exclusively through FuelLevelInput.onResolved, never a bare re-PATCH of the stored value', () => {
    const panelStart = dashboardSrc.indexOf('function renderFuelConfirmPanel');
    const panelEnd = dashboardSrc.indexOf('\n  // Whether to render live fuel state', panelStart);
    const panelBlock = dashboardSrc.slice(panelStart, panelEnd > -1 ? panelEnd : panelStart + 4000);
    expect(panelBlock).toMatch(/<FuelLevelInput[\s\S]*?onResolved=\{setConfirmPendingFuel\}/);
    // The Confirm button is disabled until FuelLevelInput has resolved a
    // value — there is no alternate path to a non-null confirmPendingFuel.
    expect(panelBlock).toMatch(/disabled=\{!confirmPendingFuel \|\| confirmSaveState === 'saving'\}/);
  });

  it('confirmCurrentFuel() only ever reads gallons/source from confirmPendingFuel (the FuelLevelInput-resolved value), never from session.currentFuelGallons directly', () => {
    const start = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
    const end = dashboardSrc.indexOf('}, [confirmPendingFuel, sessionId, session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt, session?.fuelTankCapacityGallons, load]);');
    const block = dashboardSrc.slice(start, end);
    expect(block).toMatch(/currentFuelGallons: confirmPendingFuel\.gallons/);
    expect(block).toMatch(/currentFuelSource: confirmPendingFuel\.source/);
  });

  it('re-affirming the SAME reading is a valid confirmation — nothing requires the resolved value to differ from what was already stored', () => {
    const start = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
    const block = dashboardSrc.slice(start, start + 400);
    // The guard is presence of a value, not inequality with anything.
    expect(block).toMatch(/if \(!confirmPendingFuel\) return;/);
    expect(block).not.toMatch(/confirmPendingFuel\.gallons !== session/);
  });

  it('lib/rentalSessions.ts only stamps a fresh currentFuelUpdatedAt alongside an actual currentFuelGallons value — a source-only or timestamp-only PATCH cannot refresh freshness', () => {
    const idx = rentalSessionsSrc.indexOf('if (input.currentFuelGallons !== undefined) { data.currentFuelGallons');
    expect(idx).toBeGreaterThan(-1);
    const line = rentalSessionsSrc.slice(idx, idx + 200);
    expect(line).toMatch(/data\.currentFuelUpdatedAt = now/);
    // currentFuelSource alone never touches currentFuelUpdatedAt.
    const sourceLineIdx = rentalSessionsSrc.indexOf('if (input.currentFuelSource  !== undefined)');
    const sourceLine = rentalSessionsSrc.slice(sourceLineIdx, sourceLineIdx + 120);
    expect(sourceLine).not.toMatch(/currentFuelUpdatedAt/);
  });
});

describe('Confirm-write correctness (async/failure handling)', () => {
  it('confirmCurrentFuel awaits the PATCH, checks response.ok, and derives confirmed state from the SERVER response, not the locally-typed value', () => {
    const start = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
    const end = dashboardSrc.indexOf('}, [confirmPendingFuel, sessionId, session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt, session?.fuelTankCapacityGallons, load]);');
    const block = dashboardSrc.slice(start, end);
    expect(block).toMatch(/await fetch/);
    expect(block).toMatch(/if \(!res\.ok\) throw new Error/);
    expect(block).toMatch(/const updatedSession = data\?\.session/);
    expect(block).toMatch(/setConfirmedCurrentFuelGallons\(updatedSession\.currentFuelGallons\)/);
    expect(block).toMatch(/setConfirmedCurrentFuelUpdatedAt\(updatedSession\.currentFuelUpdatedAt\)/);
  });

  it('on failure, confirmPendingFuel and showConfirmFuelInput are left untouched (retryable) and nothing is marked confirmed', () => {
    const start = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
    const end = dashboardSrc.indexOf('}, [confirmPendingFuel, sessionId, session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt, session?.fuelTankCapacityGallons, load]);');
    const block = dashboardSrc.slice(start, end);
    const catchBlock = block.slice(block.lastIndexOf('} catch'));
    expect(catchBlock).not.toMatch(/setConfirmPendingFuel\(null\)/);
    expect(catchBlock).not.toMatch(/setShowConfirmFuelInput\(false\)/);
    expect(catchBlock).toMatch(/setConfirmSaveState\('error'\)/);
  });

  it('the retry action re-invokes the same confirmCurrentFuel function, not a new/duplicate PATCH implementation', () => {
    const panelStart = dashboardSrc.indexOf('function renderFuelConfirmPanel');
    const panelBlock = dashboardSrc.slice(panelStart, panelStart + 3500);
    const errorBlock = panelBlock.slice(panelBlock.indexOf("confirmSaveState === 'error'"));
    expect(errorBlock).toMatch(/onClick=\{confirmCurrentFuel\}/);
  });

  it('savePickupOrCurrent (top-level Update Current Fuel) is also awaited and response.ok-checked', () => {
    const start = dashboardSrc.indexOf('const savePickupOrCurrent = useCallback');
    const end = dashboardSrc.indexOf('}, [pendingFuel, sessionId, t]);');
    const block = dashboardSrc.slice(start, end);
    expect(block).toMatch(/await fetch/);
    expect(block).toMatch(/if \(!res\.ok\) throw new Error/);
    expect(block).toMatch(/setSaveFuelError\(t\.rentalReturn\.fuelSaveFailed\)/);
    const catchBlock = block.slice(block.lastIndexOf('} catch'));
    expect(catchBlock).not.toMatch(/setPendingFuel\(null\)/);
    expect(catchBlock).not.toMatch(/setShowUpdateFuel\(false\)/);
    expect(catchBlock).not.toMatch(/setShowPickupFuel\(false\)/);
  });
});

describe('Correction 8 — async response-race protection (in-flight guard)', () => {
  it('the Confirm button is disabled while confirmSaveState === "saving", preventing a second concurrent submit', () => {
    const panelStart = dashboardSrc.indexOf('function renderFuelConfirmPanel');
    const panelBlock = dashboardSrc.slice(panelStart, panelStart + 3500);
    expect(panelBlock).toMatch(/disabled=\{!confirmPendingFuel \|\| confirmSaveState === 'saving'\}/);
  });

  it('confirmCurrentFuel sets confirmSaveState to "saving" before the await, so a second click while in flight is blocked by the disabled prop above', () => {
    const start = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
    const block = dashboardSrc.slice(start, start + 300);
    expect(block).toMatch(/setConfirmSaveState\('saving'\);/);
    expect(block.indexOf("setConfirmSaveState('saving')")).toBeLessThan(block.indexOf('await fetch'));
  });
});

describe('Correction 3 — confirmation vs. RESULT invalidation split', () => {
  it('invalidates confirmation on sessionId change', () => {
    const idx = dashboardSrc.indexOf('Invalidate on session id change');
    const block = dashboardSrc.slice(idx, idx + 400);
    expect(block).toMatch(/setConfirmedCurrentFuelGallons\(null\)/);
    expect(block).toMatch(/\}, \[sessionId\]\);/);
  });

  it('does NOT invalidate confirmation when the accordion closes/reopens (activeWorkflow) — the over-invalidation bug is fixed', () => {
    // The old effect keyed on `if (activeWorkflow === 'none')` that cleared
    // confirmedCurrentFuelGallons must be gone entirely.
    expect(dashboardSrc).not.toMatch(/if \(activeWorkflow === 'none'\)\s*\{\s*setConfirmedCurrentFuelGallons\(null\)/);
    // No effect anywhere is keyed on [activeWorkflow] and also clears
    // confirmedCurrentFuelGallons.
    const effectRegex = /useEffect\(\(\) => \{([\s\S]*?)\}, \[activeWorkflow\]\);/g;
    let match: RegExpExecArray | null;
    let foundInvalidatingEffect = false;
    while ((match = effectRegex.exec(dashboardSrc)) !== null) {
      if (/setConfirmedCurrentFuelGallons\(null\)/.test(match[1])) foundInvalidatingEffect = true;
    }
    expect(foundInvalidatingEffect).toBe(false);
  });

  it('invalidates confirmation when the server-side currentFuelGallons diverges from what was confirmed (covers a Fillup having just been logged)', () => {
    const idx = dashboardSrc.indexOf('Invalidate whenever the server');
    const block = dashboardSrc.slice(idx, idx + 1600);
    expect(block).toMatch(/session\?\.currentFuelGallons !== confirmedCurrentFuelGallons/);
    expect(block).toMatch(/setConfirmedCurrentFuelGallons\(null\)/);
  });

  it('a fresh confirmation (or invalidation) resets hasCalculatedTripFill/hasCalculatedReturn — CALCULATED -> READY_TO_CALCULATE', () => {
    const idx = dashboardSrc.indexOf('CALCULATED -> READY_TO_CALCULATE');
    const block = dashboardSrc.slice(idx, idx + 400);
    expect(block).toMatch(/setHasCalculatedTripFill\(false\)/);
    expect(block).toMatch(/setHasCalculatedReturn\(false\)/);
    expect(block).toMatch(/\[confirmedCurrentFuelGallons\]/);
  });

  it('desired-level change resets hasCalculatedTripFill only (RESULT), never confirmedCurrentFuelGallons', () => {
    const idx = dashboardSrc.indexOf("onResolved={(v) => { setTripDesiredFuel(v); setHasCalculatedTripFill(false); }}");
    expect(idx).toBeGreaterThan(-1);
  });

  it('trip pump-price change resets hasCalculatedTripFill only (RESULT)', () => {
    const idx = dashboardSrc.indexOf('setTripPricePerGal(e.target.value); setHasCalculatedTripFill(false);');
    expect(idx).toBeGreaterThan(-1);
  });

  it('return pump-price change resets hasCalculatedReturn only (RESULT)', () => {
    const idx = dashboardSrc.indexOf('setCalcPricePerGal(e.target.value); setHasCalculatedReturn(false);');
    expect(idx).toBeGreaterThan(-1);
  });

  it('a changed required-return TARGET resets hasCalculatedReturn (RESULT) without touching confirmedCurrentFuelGallons', () => {
    const idx = dashboardSrc.indexOf('RESULT invalidator — a changed required-return TARGET');
    expect(idx).toBeGreaterThan(-1);
    const block = dashboardSrc.slice(idx, idx + 700);
    expect(block).toMatch(/setHasCalculatedReturn\(false\)/);
    expect(block).not.toMatch(/setConfirmedCurrentFuelGallons/);
    expect(block).toMatch(/\[session\?\.requiredReturnFuelGallons\]/);
  });
});

describe('Correction 4 — hero does not claim a return-ready verdict from unconfirmed fuel', () => {
  it('the hero badge is driven by heroStatus, which is null unless confirmedCurrentFuelGallons is set', () => {
    const idx = dashboardSrc.indexOf('const heroStatus = confirmedCurrentFuelGallons != null');
    expect(idx).toBeGreaterThan(-1);
    const block = dashboardSrc.slice(idx, idx + 300);
    expect(block).toMatch(/returnReadyStatus\(confirmedCurrentFuelGallons, session\.requiredReturnFuelGallons\)\s*\n\s*: null/);
  });

  it('the hero badge never reads statusConfig/session.currentFuelGallons directly anymore — only HERO_STATUS_CONFIG[heroStatus]', () => {
    expect(dashboardSrc).not.toMatch(/\bstatusConfig\b/);
    expect(dashboardSrc).toMatch(/HERO_STATUS_CONFIG\[heroStatus\]\.chip/);
    expect(dashboardSrc).toMatch(/HERO_STATUS_CONFIG\[heroStatus\]\.label/);
  });

  it('the hero shows neutral "confirm fuel" copy, not a colored verdict, when heroStatus is null', () => {
    const heroBadgeIdx = dashboardSrc.indexOf('heroStatus == null ? t.rentalReturn.confirmFuelToCheckReturnStatus');
    expect(heroBadgeIdx).toBeGreaterThan(-1);
    const chipClassIdx = dashboardSrc.indexOf("!showLiveFuel || heroStatus == null ? 'bg-white/25 text-white'");
    expect(chipClassIdx).toBeGreaterThan(-1);
  });
});

describe('Analytics gated on confirmation, not a merely-stored value (Correction 12)', () => {
  it('rental_fuel_needed_calculated only fires when confirmedCurrentFuelGallons is non-null', () => {
    const idx = dashboardSrc.indexOf("trackClientEvent('rental_fuel_needed_calculated')");
    const block = dashboardSrc.slice(Math.max(0, idx - 400), idx);
    expect(block).toMatch(/confirmedCurrentFuelGallons == null/);
  });

  it('trackRentalReturnReadyViewed is invoked with confirmedCurrentFuelGallons, not session.currentFuelGallons', () => {
    expect(dashboardSrc).toMatch(/trackRentalReturnReadyViewed\(returnReadyStatus\(confirmedCurrentFuelGallons, session\.requiredReturnFuelGallons\)\)/);
  });

  it('preserved events still exist unmodified', () => {
    for (const ev of [
      'rental_trip_fill_calculator_opened', 'rental_trip_fill_calculated', 'rental_trip_fill_log_started',
      'rental_fill_calculated', 'rental_near_return_viewed', 'rental_prepare_return_cta_used',
    ]) {
      expect(dashboardSrc).toContain(`trackClientEvent('${ev}')`);
    }
  });
});

describe('Fillup logging invalidates confirmation (no extra wiring needed — reuses the currentFuelGallons-divergence effect)', () => {
  it('RefuelLogModal onSaved calls load(), which re-fetches session.currentFuelGallons and (via the divergence effect) clears confirmedCurrentFuelGallons', () => {
    expect(dashboardSrc).toMatch(/onSaved=\{\(\) => \{ setShowRefuel\(false\); load\(\); \}\}/);
  });
});

describe('Server-side PATCH validation', () => {
  it('rejects non-finite/negative currentFuelGallons, pickupFuelGallons, requiredReturnFuelGallons', () => {
    expect(routeSrc).toMatch(/function isFiniteNonNegative/);
    expect(routeSrc).toMatch(/gallonFieldsToCheck/);
    expect(routeSrc).toMatch(/must be a finite number >= 0/);
  });

  it('rejects a gallon value over the effective tank capacity, preferring the same-request fuelTankCapacityGallons when present', () => {
    expect(routeSrc).toMatch(/effectiveTankCapacity = body\.fuelTankCapacityGallons !== undefined/);
    expect(routeSrc).toMatch(/cannot exceed the tank capacity/);
  });

  it('validates rentalFuelChargePerGallon as finite >= 0', () => {
    expect(routeSrc).toMatch(/rentalFuelChargePerGallon !== undefined && !isFiniteNonNegative\(body\.rentalFuelChargePerGallon\)/);
  });

  it('validates currentFuelSource/pickupFuelSource against FUEL_DATA_SOURCES', () => {
    expect(routeSrc).toMatch(/import \{ FUEL_DATA_SOURCES \} from '@\/lib\/rentalProvider'/);
    expect(routeSrc).toMatch(/FUEL_DATA_SOURCES as readonly string\[\]\)\.includes\(value\)/);
  });

  it('loads the existing OWNED session before validating against tank capacity — ownership still happens before any read', () => {
    expect(routeSrc).toMatch(/const existingForValidation = await getRentalSession\(userId, params\.id\)/);
  });
});

describe('Correction 6 — manual source allow-list excludes RECEIPT/RENTAL_COMPANY_API/VEHICLE_TELEMATICS', () => {
  it('the allow-list contains exactly the three manual sources', () => {
    expect(routeSrc).toMatch(/MANUAL_ENTRY_ALLOWED_SOURCES = new Set\(\['MANUAL_GAUGE', 'MANUAL_PERCENT', 'MANUAL_GALLONS'\]\)/);
  });

  it('accepts MANUAL_GAUGE', () => {
    const setMatch = routeSrc.match(/MANUAL_ENTRY_ALLOWED_SOURCES = new Set\((\[[^\]]*\])\)/);
    expect(setMatch).not.toBeNull();
    const allowed: string[] = JSON.parse(setMatch![1].replace(/'/g, '"'));
    expect(allowed).toContain('MANUAL_GAUGE');
  });

  it('accepts MANUAL_PERCENT', () => {
    const setMatch = routeSrc.match(/MANUAL_ENTRY_ALLOWED_SOURCES = new Set\((\[[^\]]*\])\)/);
    const allowed: string[] = JSON.parse(setMatch![1].replace(/'/g, '"'));
    expect(allowed).toContain('MANUAL_PERCENT');
  });

  it('accepts MANUAL_GALLONS', () => {
    const setMatch = routeSrc.match(/MANUAL_ENTRY_ALLOWED_SOURCES = new Set\((\[[^\]]*\])\)/);
    const allowed: string[] = JSON.parse(setMatch![1].replace(/'/g, '"'));
    expect(allowed).toContain('MANUAL_GALLONS');
  });

  it('rejects RECEIPT — it is system-derived provenance, set only by the atomic Fillup-create bump', () => {
    const setMatch = routeSrc.match(/MANUAL_ENTRY_ALLOWED_SOURCES = new Set\((\[[^\]]*\])\)/);
    const allowed: string[] = JSON.parse(setMatch![1].replace(/'/g, '"'));
    expect(allowed).not.toContain('RECEIPT');
  });

  it('rejects RENTAL_COMPANY_API', () => {
    const setMatch = routeSrc.match(/MANUAL_ENTRY_ALLOWED_SOURCES = new Set\((\[[^\]]*\])\)/);
    const allowed: string[] = JSON.parse(setMatch![1].replace(/'/g, '"'));
    expect(allowed).not.toContain('RENTAL_COMPANY_API');
  });

  it('rejects VEHICLE_TELEMATICS', () => {
    const setMatch = routeSrc.match(/MANUAL_ENTRY_ALLOWED_SOURCES = new Set\((\[[^\]]*\])\)/);
    const allowed: string[] = JSON.parse(setMatch![1].replace(/'/g, '"'));
    expect(allowed).not.toContain('VEHICLE_TELEMATICS');
  });

  it('still rejects non-allow-listed sources with a 400 and a descriptive message, never silently coercing', () => {
    expect(routeSrc).toMatch(/cannot be set to \$\{value\} from manual entry/);
  });
});

describe('Correction 7 — gallons/source pairing on the PATCH contract', () => {
  it('rejects currentFuelGallons changing without an accompanying currentFuelSource', () => {
    expect(routeSrc).toMatch(/\(body\.currentFuelGallons !== undefined\) !== \(body\.currentFuelSource !== undefined\)/);
    expect(routeSrc).toMatch(/currentFuelGallons and currentFuelSource must be provided together/);
  });

  it('rejects currentFuelSource changing alone (no gallons in the same request)', () => {
    // Symmetric XOR check covers both directions — assert the response
    // copy explicitly names both fields so an isolated-source PATCH is
    // caught by the same guard, not silently accepted.
    const idx = routeSrc.indexOf('currentFuelGallons and currentFuelSource must be provided together');
    expect(idx).toBeGreaterThan(-1);
  });

  it('applies the same pairing rule to pickupFuelGallons/pickupFuelSource', () => {
    expect(routeSrc).toMatch(/\(body\.pickupFuelGallons !== undefined\) !== \(body\.pickupFuelSource !== undefined\)/);
    expect(routeSrc).toMatch(/pickupFuelGallons and pickupFuelSource must be provided together/);
  });

  it('does not touch the atomic Fillup-create bump path — lib/rentalFillups.ts is untouched by this correction', () => {
    const fillupsSrc = readFileSync(join(__dirname, '../lib/rentalFillups.ts'), 'utf8');
    expect(fillupsSrc).toMatch(/"currentFuelSource" = 'RECEIPT'/);
  });
});

describe('Corrections 9/10 — TOCTOU/optimistic concurrency + HTTP 409 UX', () => {
  it('the route recognizes expectedPriorCurrentFuelGallons and routes to confirmRentalCurrentFuel', () => {
    expect(routeSrc).toMatch(/'expectedPriorCurrentFuelGallons' in body/);
    expect(routeSrc).toMatch(/confirmRentalCurrentFuel\(userId, params\.id/);
  });

  it('a conflict from confirmRentalCurrentFuel is surfaced as HTTP 409 with customer-safe copy, never raw error/JSON/DB terms', () => {
    const idx = routeSrc.indexOf("result.status === 'conflict'");
    const block = routeSrc.slice(idx, idx + 800);
    expect(block).toMatch(/status: 409/);
    expect(block).toMatch(/Your rental information changed while you were updating the fuel level\. We've refreshed the latest information\. Please confirm the fuel level again\./);
    expect(block).not.toMatch(/P2002|prisma|SQL|stack/i);
  });

  it('confirmRentalCurrentFuel performs an atomic conditional update via updateMany, keyed on the FULL last-known fuel-state snapshot (gallons, source, updatedAt, tank capacity — not gallons alone), and treats count===0 as a conflict', () => {
    const idx = rentalSessionsSrc.indexOf('export async function confirmRentalCurrentFuel');
    const block = rentalSessionsSrc.slice(idx, idx + 5000);
    expect(block).toMatch(/prisma\.rentalSession\.updateMany\(/);
    expect(block).toMatch(/currentFuelGallons:\s*input\.expectedPriorCurrentFuelGallons/);
    expect(block).toMatch(/currentFuelSource:\s*input\.expectedPriorCurrentFuelSource/);
    expect(block).toMatch(/currentFuelUpdatedAt:\s*input\.expectedPriorCurrentFuelUpdatedAt/);
    expect(block).toMatch(/fuelTankCapacityGallons:\s*input\.expectedPriorFuelTankCapacityGallons/);
    expect(block).toMatch(/if \(result\.count === 0\) return \{ status: 'conflict' \};/);
    // The write is scoped to the owning user, same as every other mutation
    // in this file.
    expect(block).toMatch(/where: \{\s*id,\s*userId,/);
  });

  it('Blocker 2 regression: gallons-only conditioning is gone — the where clause is NOT limited to currentFuelGallons alone', () => {
    const idx = rentalSessionsSrc.indexOf('export async function confirmRentalCurrentFuel');
    const block = rentalSessionsSrc.slice(idx, idx + 5000);
    const whereIdx = block.indexOf('where: {');
    const dataIdx = block.indexOf('data: {');
    const whereClause = block.slice(whereIdx, dataIdx);
    expect(whereClause).toMatch(/currentFuelSource/);
    expect(whereClause).toMatch(/currentFuelUpdatedAt/);
    expect(whereClause).toMatch(/fuelTankCapacityGallons/);
  });

  it('the client sends the full expected snapshot (gallons, source, updatedAt, tank capacity), not gallons alone', () => {
    const start = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
    const end = dashboardSrc.indexOf('}, [confirmPendingFuel, sessionId, session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt, session?.fuelTankCapacityGallons, load]);');
    const block = dashboardSrc.slice(start, end);
    expect(block).toMatch(/expectedPriorCurrentFuelGallons: session\?\.currentFuelGallons \?\? null/);
    expect(block).toMatch(/expectedPriorCurrentFuelSource: session\?\.currentFuelSource \?\? null/);
    expect(block).toMatch(/expectedPriorCurrentFuelUpdatedAt: session\?\.currentFuelUpdatedAt \?\? null/);
    expect(block).toMatch(/expectedPriorFuelTankCapacityGallons: session\?\.fuelTankCapacityGallons \?\? null/);
  });

  it('the server validates all three additional expected-snapshot fields (source enum, updatedAt string, capacity finite/non-negative)', () => {
    expect(routeSrc).toMatch(/expectedPriorCurrentFuelSource must be null or one of/);
    expect(routeSrc).toMatch(/expectedPriorCurrentFuelUpdatedAt must be null or a string/);
    expect(routeSrc).toMatch(/expectedPriorFuelTankCapacityGallons must be null or a finite number/);
  });

  it('the client PATCH sends expectedPriorCurrentFuelGallons derived from the session it last read, not a hardcoded/omitted value', () => {
    const start = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
    const end = dashboardSrc.indexOf('}, [confirmPendingFuel, sessionId, session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt, session?.fuelTankCapacityGallons, load]);');
    const block = dashboardSrc.slice(start, end);
    expect(block).toMatch(/expectedPriorCurrentFuelGallons: session\?\.currentFuelGallons \?\? null/);
  });

  it('client handling of a 409: calls load() (session reload) and does NOT set confirmedCurrentFuelGallons — the calculator stays unconfirmed', () => {
    const start = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
    const end = dashboardSrc.indexOf('}, [confirmPendingFuel, sessionId, session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt, session?.fuelTankCapacityGallons, load]);');
    const block = dashboardSrc.slice(start, end);
    const conflictBlockIdx = block.indexOf("res.status === 409");
    expect(conflictBlockIdx).toBeGreaterThan(-1);
    const conflictBlock = block.slice(conflictBlockIdx, block.indexOf('if (!res.ok) throw new Error'));
    expect(conflictBlock).toMatch(/load\(\);/);
    expect(conflictBlock).not.toMatch(/setConfirmedCurrentFuelGallons\(/);
    expect(conflictBlock).toMatch(/setConfirmSaveState\('conflict'\);/);
  });

  it('the 409 UX copy shown to the customer matches exactly, with no raw error code/JSON visible', () => {
    expect(dashboardSrc).toMatch(/confirmSaveState === 'conflict' && \(/);
    expect(dashboardSrc).toMatch(/\{t\.rentalReturn\.fuelConfirmConflictMessage\}/);
    const enTranslations = readFileSync(join(__dirname, '../lib/translations.ts'), 'utf8');
    expect(enTranslations).toMatch(
      /fuelConfirmConflictMessage: "Your rental information changed while you were updating the fuel level\. We've refreshed the latest information\. Please confirm the fuel level again\."/,
    );
  });
});

describe('Current Fuel card — 2026-08-28 FINAL correction: informational surface only, no calculation conclusion', () => {
  const cardStart = dashboardSrc.indexOf('CURRENT FUEL — Phase 6A.2 redesign');
  const cardEnd = dashboardSrc.indexOf('CURRENT FUEL — Phase 6A.2 redesign', cardStart + 1) === -1
    ? dashboardSrc.indexOf('{showUpdateFuel && (', cardStart) + 400
    : dashboardSrc.length;
  const cardBlock = dashboardSrc.slice(cardStart, cardEnd);

  it('1. Current Fuel card renders last-known fuel (lastReportedFuel label + formatGallons of currentFuelGallons)', () => {
    expect(cardBlock).toMatch(/t\.rentalReturn\.lastReportedFuel/);
    expect(cardBlock).toMatch(/formatGallons\(session\.currentFuelGallons, session\.currentFuelSource as FuelDataSource\)/);
  });

  it('2. Current Fuel card renders currentFuelUpdatedAt framing (Last updated: ...)', () => {
    expect(cardBlock).toMatch(/session\.currentFuelUpdatedAt/);
    expect(cardBlock).toMatch(/formatUpdatedAt\(session\.currentFuelUpdatedAt\)/);
  });

  it('3. Current Fuel card renders the return requirement (policy label + target gallons)', () => {
    expect(cardBlock).toMatch(/t\.rentalReturn\.returnRequirementLabel/);
    expect(cardBlock).toMatch(/formatGallons\(session\.requiredReturnFuelGallons, 'MANUAL_GALLONS'\)/);
  });

  it('4. Current Fuel card does NOT render "Add X gal" (addFuelEyebrow) from unconfirmed fuel', () => {
    expect(cardBlock).not.toMatch(/addFuelEyebrow/);
  });

  it('5. Current Fuel card does NOT render "No fuel needed" (noFuelNeeded) from unconfirmed fuel', () => {
    expect(cardBlock).not.toMatch(/t\.rentalReturn\.noFuelNeeded/);
  });

  it('6. Current Fuel card does not make a return-ready claim — no gallonsNeeded()-derived conclusion or return-gap status color', () => {
    // The dead `needed` const (gallonsNeeded(...) at the top level) was removed
    // entirely; nothing in the card block may reference it.
    expect(dashboardSrc).not.toMatch(/const needed\s*=\s*gallonsNeeded\(/);
    expect(cardBlock).not.toMatch(/\bneeded > 0\b/);
    expect(cardBlock).not.toMatch(/\bneeded\s*>\s*0\s*\?/);
  });

  it('the tank-fill bar uses a single neutral color, not one keyed to a raw gallons-needed gap', () => {
    expect(cardBlock).toMatch(/background: 'linear-gradient\(90deg,#3b82f6,#1e40af\)'/);
    expect(cardBlock).not.toMatch(/#FBBF24/);
  });

  it('7. Prepare for Return remains the only customer-facing return-calculation surface (gallonsNeeded/estimatedSavings/estimatedRentalCompanyCharge only appear there)', () => {
    const prepareStart = dashboardSrc.indexOf("const prepareReturnContent = activeWorkflow === 'prepare_return'");
    expect(prepareStart).toBeGreaterThan(-1);
    // The top-level Current Fuel card block must not itself call any of the
    // return-calculation primitives.
    expect(cardBlock).not.toMatch(/gallonsNeeded\(/);
    expect(cardBlock).not.toMatch(/estimatedSavings\(/);
    expect(cardBlock).not.toMatch(/estimatedRentalCompanyCharge\(/);
  });

  it('8. shared fuel-confirmation state from the prior correction round remains unchanged (single confirmedCurrentFuelGallons/confirmedCurrentFuelUpdatedAt pair)', () => {
    expect(dashboardSrc.match(/const \[confirmedCurrentFuelGallons, setConfirmedCurrentFuelGallons\]/g)?.length).toBe(1);
    expect(dashboardSrc.match(/const \[confirmedCurrentFuelUpdatedAt, setConfirmedCurrentFuelUpdatedAt\]/g)?.length).toBe(1);
  });

  it('9. Add Fuel During Rental calculator is unchanged by this correction (still keyed off confirmedCurrentFuelGallons, not the card)', () => {
    const addFuelStart = dashboardSrc.indexOf('const addFuelContent =');
    const addFuelEnd = dashboardSrc.indexOf('const prepareReturnCard = (', addFuelStart);
    const addFuelBlock = dashboardSrc.slice(addFuelStart, addFuelEnd);
    expect(addFuelBlock).toMatch(/confirmedCurrentFuelGallons/);
  });

  it('10a. no lifecycle regression — RENTAL_LIFECYCLE_SECTION_ORDER / near-return handling untouched by this card edit', () => {
    expect(dashboardSrc).toMatch(/RENTAL_LIFECYCLE_SECTION_ORDER/);
  });

  it('10b. no fuel-math regression — gallonsNeeded/tripFillEstimate imports from lib/rentalCalculations.ts are unchanged', () => {
    const calcSrc = readFileSync(join(__dirname, '../lib/rentalCalculations.ts'), 'utf8');
    expect(calcSrc).toMatch(/export function gallonsNeeded/);
    expect(calcSrc).toMatch(/export function tripFillEstimate/);
  });

  it('10c. no persistence regression — lib/rentalFillups.ts atomic bump / never-touch-on-edit-delete invariants untouched by this card edit', () => {
    const fillupsSrc = readFileSync(join(__dirname, '../lib/rentalFillups.ts'), 'utf8');
    expect(fillupsSrc).toMatch(/bumpCurrentFuelGallonsOnCreateSql/);
  });
});

describe('Blocker 1 (2026-08-28 independent review) — confirmed fuel-state IDENTITY is the full triple, not gallons alone', () => {
  it('the client tracks confirmedCurrentFuelSource alongside confirmedCurrentFuelGallons/confirmedCurrentFuelUpdatedAt', () => {
    expect(dashboardSrc).toMatch(/const \[confirmedCurrentFuelSource, setConfirmedCurrentFuelSource\] = useState<FuelDataSource \| null>\(null\)/);
  });

  it('1. same gallons + a newer currentFuelUpdatedAt invalidates confirmation (the divergence effect compares currentFuelUpdatedAt, not just gallons)', () => {
    const idx = dashboardSrc.indexOf("persisted last-known fuel-STATE IDENTITY");
    expect(idx).toBeGreaterThan(-1);
    const block = dashboardSrc.slice(idx, idx + 1600);
    expect(block).toMatch(/\(session\?\.currentFuelUpdatedAt \?\? null\) !== confirmedCurrentFuelUpdatedAt/);
  });

  it('2. same gallons + a different currentFuelSource invalidates confirmation', () => {
    const idx = dashboardSrc.indexOf("persisted last-known fuel-STATE IDENTITY");
    const block = dashboardSrc.slice(idx, idx + 1600);
    expect(block).toMatch(/\(session\?\.currentFuelSource \?\? null\) !== confirmedCurrentFuelSource/);
  });

  it('3. the divergence effect depends on all three fields (gallons, source, updatedAt) so a same-gallons Fillup at a full tank (source/timestamp advance, gallons clamped unchanged) still invalidates', () => {
    expect(dashboardSrc).toMatch(/\}, \[session\?\.currentFuelGallons, session\?\.currentFuelSource, session\?\.currentFuelUpdatedAt\]\);/);
  });

  it('4. when gallons/source/updatedAt are all unchanged, confirmation is preserved (identityChanged is false, no reset called)', () => {
    const idx = dashboardSrc.indexOf("persisted last-known fuel-STATE IDENTITY");
    const block = dashboardSrc.slice(idx, idx + 1600);
    expect(block).toMatch(/const identityChanged =/);
    expect(block).toMatch(/if \(identityChanged\) \{/);
    // The reset calls are conditional on identityChanged, not unconditional.
    const resetIdx = block.indexOf('if (identityChanged) {');
    const resetBlock = block.slice(resetIdx, resetIdx + 200);
    expect(resetBlock).toMatch(/setConfirmedCurrentFuelGallons\(null\)/);
    expect(resetBlock).toMatch(/setConfirmedCurrentFuelSource\(null\)/);
    expect(resetBlock).toMatch(/setConfirmedCurrentFuelUpdatedAt\(null\)/);
  });

  it('a successful confirmation sets all three fields of the identity together from the SERVER response, never a locally-typed value', () => {
    const start = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
    const end = dashboardSrc.indexOf('}, [confirmPendingFuel, sessionId, session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt, session?.fuelTankCapacityGallons, load]);');
    const block = dashboardSrc.slice(start, end);
    expect(block).toMatch(/setConfirmedCurrentFuelGallons\(updatedSession\.currentFuelGallons\)/);
    expect(block).toMatch(/setConfirmedCurrentFuelSource\(updatedSession\.currentFuelSource as FuelDataSource \| null\)/);
    expect(block).toMatch(/setConfirmedCurrentFuelUpdatedAt\(updatedSession\.currentFuelUpdatedAt\)/);
  });

  it('the confirmed-fuel display panel renders the CONFIRMED source (confirmedCurrentFuelSource), not the possibly-since-changed session.currentFuelSource', () => {
    expect(dashboardSrc).toMatch(/formatGallons\(confirmedCurrentFuelGallons, confirmedCurrentFuelSource\)/);
  });
});

describe('Blocker 2 (2026-08-28 independent review) — TOCTOU snapshot includes tank capacity, not gallons alone', () => {
  it('1. capacity unchanged + fuel state unchanged → the where clause matches, count > 0, confirmation succeeds (asserted via the conditional shape, not a live DB)', () => {
    const idx = rentalSessionsSrc.indexOf('export async function confirmRentalCurrentFuel');
    const block = rentalSessionsSrc.slice(idx, idx + 5000);
    expect(block).toMatch(/if \(result\.count === 0\) return \{ status: 'conflict' \};/);
    expect(block).toMatch(/return \{ status: 'ok', session: toRentalSession\(row\) \};/);
  });

  it('2. current gallons changed concurrently → conflict (gallons is part of the where snapshot)', () => {
    const idx = rentalSessionsSrc.indexOf('where: {', rentalSessionsSrc.indexOf('export async function confirmRentalCurrentFuel'));
    const whereBlock = rentalSessionsSrc.slice(idx, rentalSessionsSrc.indexOf('data: {', idx));
    expect(whereBlock).toMatch(/currentFuelGallons:\s*input\.expectedPriorCurrentFuelGallons/);
  });

  it('3. current source changed concurrently → conflict (source is part of the where snapshot)', () => {
    const idx = rentalSessionsSrc.indexOf('where: {', rentalSessionsSrc.indexOf('export async function confirmRentalCurrentFuel'));
    const whereBlock = rentalSessionsSrc.slice(idx, rentalSessionsSrc.indexOf('data: {', idx));
    expect(whereBlock).toMatch(/currentFuelSource:\s*input\.expectedPriorCurrentFuelSource/);
  });

  it('4. currentFuelUpdatedAt changed concurrently → conflict (updatedAt is part of the where snapshot)', () => {
    const idx = rentalSessionsSrc.indexOf('where: {', rentalSessionsSrc.indexOf('export async function confirmRentalCurrentFuel'));
    const whereBlock = rentalSessionsSrc.slice(idx, rentalSessionsSrc.indexOf('data: {', idx));
    expect(whereBlock).toMatch(/currentFuelUpdatedAt:\s*input\.expectedPriorCurrentFuelUpdatedAt/);
  });

  it('5/6. tank capacity changed concurrently (including a decrease below the just-validated proposed gallons) → conflict, no invalid write committed — fuelTankCapacityGallons is part of the where snapshot, so a capacity race can never fall through to an unconditional write', () => {
    const idx = rentalSessionsSrc.indexOf('where: {', rentalSessionsSrc.indexOf('export async function confirmRentalCurrentFuel'));
    const whereBlock = rentalSessionsSrc.slice(idx, rentalSessionsSrc.indexOf('data: {', idx));
    expect(whereBlock).toMatch(/fuelTankCapacityGallons:\s*input\.expectedPriorFuelTankCapacityGallons/);
    // No unconditional write exists anywhere in this function — the ONLY
    // mutation is the conditional updateMany() above; there is no
    // fallback prisma.rentalSession.update() (singular, unconditional) call.
    const fnIdx = rentalSessionsSrc.indexOf('export async function confirmRentalCurrentFuel');
    const fnBlock = rentalSessionsSrc.slice(fnIdx, rentalSessionsSrc.indexOf('\n}\n', fnIdx));
    expect(fnBlock).not.toMatch(/prisma\.rentalSession\.update\(/);
  });

  it('7. conflict leaves the calculator unconfirmed (never sets confirmedCurrentFuelGallons on the 409 path)', () => {
    const start = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
    const end = dashboardSrc.indexOf('}, [confirmPendingFuel, sessionId, session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt, session?.fuelTankCapacityGallons, load]);');
    const block = dashboardSrc.slice(start, end);
    const conflictBlockIdx = block.indexOf('res.status === 409');
    const conflictBlock = block.slice(conflictBlockIdx, block.indexOf('if (!res.ok) throw new Error'));
    expect(conflictBlock).not.toMatch(/setConfirmedCurrentFuelGallons\(/);
  });

  it('8. conflict triggers a session reload via load()', () => {
    const start = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
    const end = dashboardSrc.indexOf('}, [confirmPendingFuel, sessionId, session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt, session?.fuelTankCapacityGallons, load]);');
    const block = dashboardSrc.slice(start, end);
    const conflictBlockIdx = block.indexOf('res.status === 409');
    const conflictBlock = block.slice(conflictBlockIdx, block.indexOf('if (!res.ok) throw new Error'));
    expect(conflictBlock).toMatch(/load\(\);/);
  });
});

describe('Manual source allow-list reverification (2026-08-28 final pass)', () => {
  it('accepts MANUAL_GAUGE, MANUAL_PERCENT, MANUAL_GALLONS', () => {
    expect(routeSrc).toMatch(/MANUAL_ENTRY_ALLOWED_SOURCES\s*=\s*new Set\(\['MANUAL_GAUGE', 'MANUAL_PERCENT', 'MANUAL_GALLONS'\]\)/);
  });

  it('rejects RECEIPT, RENTAL_COMPANY_API, VEHICLE_TELEMATICS (none are in the allow-list)', () => {
    expect(routeSrc).not.toMatch(/MANUAL_ENTRY_ALLOWED_SOURCES[\s\S]{0,80}RECEIPT/);
    expect(routeSrc).not.toMatch(/MANUAL_ENTRY_ALLOWED_SOURCES[\s\S]{0,80}RENTAL_COMPANY_API/);
    expect(routeSrc).not.toMatch(/MANUAL_ENTRY_ALLOWED_SOURCES[\s\S]{0,80}VEHICLE_TELEMATICS/);
  });

  it('gallons/source pairing is still enforced for both currentFuel* and pickupFuel*', () => {
    expect(routeSrc).toMatch(/currentFuelGallons and currentFuelSource must be provided together/);
    expect(routeSrc).toMatch(/pickupFuelGallons and pickupFuelSource must be provided together/);
  });
});

describe('Dead-translation cleanup (2026-08-28 final pass)', () => {
  it('noFuelNeeded, addFuelEyebrow, beforeReturning are removed from both EN and ES — zero remaining callers confirmed before removal', () => {
    const translationsSrc = readFileSync(join(__dirname, '../lib/translations.ts'), 'utf8');
    expect(translationsSrc).not.toMatch(/noFuelNeeded:/);
    expect(translationsSrc).not.toMatch(/addFuelEyebrow:/);
    expect(translationsSrc).not.toMatch(/beforeReturning:/);
    expect(dashboardSrc).not.toMatch(/t\.rentalReturn\.noFuelNeeded/);
    expect(dashboardSrc).not.toMatch(/t\.rentalReturn\.addFuelEyebrow/);
    expect(dashboardSrc).not.toMatch(/t\.rentalReturn\.beforeReturning/);
  });
});

describe('Final pre-commit hardening — synchronous in-flight guard on confirmCurrentFuel (React state alone is not a synchronous lock)', () => {
  const fnStart = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
  const fnEnd = dashboardSrc.indexOf(
    '}, [confirmPendingFuel, sessionId, session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt, session?.fuelTankCapacityGallons, load]);',
    fnStart,
  );
  const fnBlock = dashboardSrc.slice(fnStart, fnEnd);

  it('a dedicated useRef guard exists, separate from confirmSaveState (which remains UI/display-only)', () => {
    expect(dashboardSrc).toMatch(/const confirmInFlightRef = useRef\(false\);/);
  });

  it('the guard is checked BEFORE the fetch — a second call while in flight returns immediately without starting a new request', () => {
    const checkIdx = fnBlock.indexOf('if (confirmInFlightRef.current) return;');
    const fetchIdx = fnBlock.indexOf('await fetch(');
    expect(checkIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(fetchIdx);
  });

  it('the ref is set to true BEFORE the fetch starts (synchronously, not inside a .then/async gap)', () => {
    const setTrueIdx = fnBlock.indexOf('confirmInFlightRef.current = true;');
    const fetchIdx = fnBlock.indexOf('await fetch(');
    expect(setTrueIdx).toBeGreaterThan(-1);
    expect(setTrueIdx).toBeLessThan(fetchIdx);
  });

  it('the ref is reset to false in a `finally` block, so every terminal path (success, 409, non-2xx, thrown error) releases the lock', () => {
    const finallyIdx = fnBlock.indexOf('} finally {');
    expect(finallyIdx).toBeGreaterThan(-1);
    const finallyBlock = fnBlock.slice(finallyIdx, fnBlock.indexOf('}, [confirmPendingFuel'));
    expect(finallyBlock).toMatch(/confirmInFlightRef\.current = false;/);
    // The reset lives in `finally`, not duplicated ad hoc at each return —
    // there is exactly one reset site, guaranteed to run regardless of which
    // branch (success / 409 / thrown) the function takes.
    const resetOccurrences = fnBlock.match(/confirmInFlightRef\.current = false;/g) ?? [];
    expect(resetOccurrences.length).toBe(1);
  });

  it('the early return for a missing confirmPendingFuel happens BEFORE the lock is acquired (no risk of acquiring and never releasing)', () => {
    const missingFuelReturnIdx = fnBlock.indexOf('if (!confirmPendingFuel) return;');
    const lockAcquireIdx = fnBlock.indexOf('confirmInFlightRef.current = true;');
    expect(missingFuelReturnIdx).toBeGreaterThan(-1);
    expect(missingFuelReturnIdx).toBeLessThan(lockAcquireIdx);
  });

  it('confirmSaveState still exists unchanged as the visual/UI state — the ref is additive, not a replacement', () => {
    expect(fnBlock).toMatch(/setConfirmSaveState\('saving'\)/);
    expect(fnBlock).toMatch(/setConfirmSaveState\('idle'\)/);
    expect(fnBlock).toMatch(/setConfirmSaveState\('conflict'\)/);
    expect(fnBlock).toMatch(/setConfirmSaveState\('error'\)/);
  });

  it('the existing customer-safe 409/error behavior is unchanged by this hardening', () => {
    expect(fnBlock).toMatch(/if \(res\.status === 409\)/);
    expect(fnBlock).toMatch(/load\(\);/);
    expect(fnBlock).toMatch(/setConfirmSaveState\('conflict'\);/);
  });
});

describe('Post-CI hardening — confirmRentalCurrentFuel() post-write identity check (closes the window between updateMany succeeding and the follow-up read)', () => {
  const fnStart = rentalSessionsSrc.indexOf('export async function confirmRentalCurrentFuel');
  const fnEnd = rentalSessionsSrc.indexOf('\n}\n', fnStart);
  const fnBlock = rentalSessionsSrc.slice(fnStart, fnEnd);
  const postWriteIdx = fnBlock.indexOf('if (result.count === 0) return');
  const postWriteBlock = fnBlock.slice(postWriteIdx);

  it('1. the post-update read is NOT the old unrestricted `{ id, userId }` shape', () => {
    // The old, insufficient version read back with no fuel-state condition
    // at all — that exact shape must no longer exist in this function.
    expect(postWriteBlock).not.toMatch(/findFirst\(\{ where: \{ id, userId \} \}\)/);
  });

  it('2. the post-update read requires the just-written currentFuelGallons, currentFuelSource, currentFuelUpdatedAt, and fuelTankCapacityGallons', () => {
    const readIdx = postWriteBlock.indexOf('const row = await prisma.rentalSession.findFirst({');
    const readBlock = postWriteBlock.slice(readIdx, postWriteBlock.indexOf('});', readIdx));
    expect(readBlock).toMatch(/currentFuelGallons:\s*input\.currentFuelGallons/);
    expect(readBlock).toMatch(/currentFuelSource:\s*input\.currentFuelSource/);
    // Must use the SAME `now` the write stamped — not a freshly-read value
    // and not a newly-generated timestamp.
    expect(readBlock).toMatch(/currentFuelUpdatedAt:\s*now\b/);
    expect(readBlock).toMatch(/fuelTankCapacityGallons:\s*input\.expectedPriorFuelTankCapacityGallons/);
  });

  it('3. if the exact just-written state is no longer present (a later concurrent mutation landed), the result is a conflict, not a silently-returned newer row', () => {
    const readIdx = postWriteBlock.indexOf('const row = await prisma.rentalSession.findFirst({');
    const afterRead = postWriteBlock.slice(readIdx);
    expect(afterRead).toMatch(/if \(!row\) return \{ status: 'conflict' \};/);
    // It must NOT fall back to "not_found" or otherwise treat a missing
    // exact-match row as anything other than a conflict — the row still
    // exists (a concurrent mutation changed it), it just isn't OUR write
    // anymore, which is exactly what "conflict" means here.
    expect(afterRead).not.toMatch(/if \(!row\) return \{ status: 'not_found' \};/);
  });

  it('4. existing client 409 handling is unchanged — same route branch, same customer-safe copy, same reload-and-stay-unconfirmed behavior', () => {
    expect(routeSrc).toMatch(/result\.status === 'conflict'/);
    expect(routeSrc).toMatch(/status: 409/);
    expect(routeSrc).toMatch(/Your rental information changed while you were updating the fuel level\./);
    const start = dashboardSrc.indexOf('const confirmCurrentFuel = useCallback');
    const end = dashboardSrc.indexOf(
      '}, [confirmPendingFuel, sessionId, session?.currentFuelGallons, session?.currentFuelSource, session?.currentFuelUpdatedAt, session?.fuelTankCapacityGallons, load]);',
      start,
    );
    const block = dashboardSrc.slice(start, end);
    const conflictBlockIdx = block.indexOf('res.status === 409');
    const conflictBlock = block.slice(conflictBlockIdx, block.indexOf('if (!res.ok) throw new Error'));
    expect(conflictBlock).toMatch(/load\(\);/);
    expect(conflictBlock).not.toMatch(/setConfirmedCurrentFuelGallons\(/);
  });

  it('5. the PRE-write optimistic predicate (updateMany where clause) is unchanged by this fix — still conditions on the expected PRIOR snapshot, not the just-written one', () => {
    const preWriteBlock = fnBlock.slice(0, postWriteIdx);
    expect(preWriteBlock).toMatch(/currentFuelGallons:\s*input\.expectedPriorCurrentFuelGallons/);
    expect(preWriteBlock).toMatch(/currentFuelSource:\s*input\.expectedPriorCurrentFuelSource/);
    expect(preWriteBlock).toMatch(/currentFuelUpdatedAt:\s*input\.expectedPriorCurrentFuelUpdatedAt/);
    expect(preWriteBlock).toMatch(/fuelTankCapacityGallons:\s*input\.expectedPriorFuelTankCapacityGallons/);
  });

  it('6. the client-side fuel-state triple confirmation model is unchanged by this server-side fix', () => {
    expect(dashboardSrc).toMatch(/const \[confirmedCurrentFuelSource, setConfirmedCurrentFuelSource\]/);
    expect(dashboardSrc).toMatch(/const identityChanged =/);
  });

  it('7. Fillup create/edit/delete invariants are unchanged by this fix (lib/rentalFillups.ts untouched)', () => {
    const fillupsSrc = readFileSync(join(__dirname, '../lib/rentalFillups.ts'), 'utf8');
    expect(fillupsSrc).toMatch(/bumpCurrentFuelGallonsOnCreateSql/);
  });
});

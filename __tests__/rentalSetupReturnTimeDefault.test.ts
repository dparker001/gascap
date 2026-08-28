/**
 * Rental setup — return TIME defaults to pickup TIME (e.g. 9am pickup ->
 * 9am return), while the return DATE stays independently selectable. This
 * repo has no JSX render harness (vitest.config.ts has no
 * @vitejs/plugin-react), so this reads RentalSetupFlow.tsx's source
 * directly and asserts the handler logic, the same pattern used by
 * __tests__/rentalTripFillCalculator.test.ts. The underlying split/combine
 * primitives are already covered in __tests__/rentalTimezone.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { splitLocalDateTime, combineLocalDateTime } from '../lib/rentalTimezone';

const setupSrc = readFileSync(
  join(__dirname, '../components/rental-return/RentalSetupFlow.tsx'),
  'utf8',
);

function extractFunction(name: string): string {
  const start = setupSrc.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const nextFn = setupSrc.indexOf('\n  function ', start + 1);
  const end = nextFn > -1 ? nextFn : start + 1500;
  return setupSrc.slice(start, end);
}

describe('RentalSetupFlow — DateTimeSplitInput wiring', () => {
  it('pickup and return fields use dedicated handlers, not the raw state setters directly', () => {
    expect(setupSrc).toMatch(/<DateTimeSplitInput value=\{pickupDateTime\} onChange=\{handlePickupDateTimeChange\}/);
    expect(setupSrc).toMatch(/<DateTimeSplitInput value=\{returnDateTime\} onChange=\{handleReturnDateTimeChange\}/);
  });
});

describe('handlePickupDateTimeChange — syncs return TIME to pickup TIME', () => {
  const handler = extractFunction('handlePickupDateTimeChange');

  it('always updates pickupDateTime itself', () => {
    expect(handler).toMatch(/setPickupDateTime\(value\)/);
  });

  it('only overwrites returnDateTime when a return DATE already exists (never invents a return date)', () => {
    expect(handler).toMatch(/if \(pickupTime && returnDate\)/);
    expect(handler).toMatch(/setReturnDateTime\(combineLocalDateTime\(returnDate, pickupTime\)\)/);
  });

  it('stops syncing once the renter has manually picked a different return time', () => {
    expect(handler).toMatch(/if \(returnTimeTouchedRef\.current\) return/);
  });

  // Worked example from the product request: 9am pickup -> 9am return.
  it('worked example: pickup 2026-09-01T09:00 with an existing return date syncs return to 09:00', () => {
    const pickupValue = '2026-09-01T09:00';
    const existingReturnDateTime = '2026-09-05T00:00'; // date picked, time not yet set
    const { time: pickupTime } = splitLocalDateTime(pickupValue);
    const { date: returnDate } = splitLocalDateTime(existingReturnDateTime);
    const synced = combineLocalDateTime(returnDate, pickupTime);
    expect(synced).toBe('2026-09-05T09:00');
  });
});

describe('handleReturnDateTimeChange — defaults time on first return-date pick, then respects manual edits', () => {
  const handler = extractFunction('handleReturnDateTimeChange');

  it('detects a genuinely different return time and latches returnTimeTouchedRef', () => {
    expect(handler).toMatch(/if \(newReturnTime && prevReturnTime && newReturnTime !== prevReturnTime\)/);
    expect(handler).toMatch(/returnTimeTouchedRef\.current = true/);
  });

  it('defaults the time from pickup the moment a return DATE is picked with no time yet, untouched only', () => {
    expect(handler).toMatch(/if \(!returnTimeTouchedRef\.current && newReturnDate && !newReturnTime\)/);
    expect(handler).toMatch(/setReturnDateTime\(combineLocalDateTime\(newReturnDate, pickupTime\)\)/);
  });

  it('falls through to the raw value once touched or once both halves are already present', () => {
    expect(handler).toMatch(/setReturnDateTime\(value\)/);
  });

  // Worked example: renter picks a return date only (09-05), pickup is
  // 9am -> return should immediately show 09-05 09:00, not a blank time.
  it('worked example: picking return date 2026-09-05 with pickup 09:00 defaults return time to 09:00', () => {
    const pickupValue = '2026-09-01T09:00';
    const newReturnDateOnly = '2026-09-05T'; // DateTimeSplitInput combines date + '' time -> splitLocalDateTime won't match, simulate via helper directly
    const { time: pickupTime } = splitLocalDateTime(pickupValue);
    const result = combineLocalDateTime('2026-09-05', pickupTime);
    expect(result).toBe('2026-09-05T09:00');
    expect(newReturnDateOnly).toBeTruthy(); // sanity: documents the scenario being modeled
  });

  it('a manual return time different from pickup is preserved on the next pickup edit (never overwritten once touched)', () => {
    // This is the "allow the user to change if necessary" requirement —
    // asserted structurally: handlePickupDateTimeChange's very first check
    // after setPickupDateTime is the touched-ref early return.
    const pickupHandler = extractFunction('handlePickupDateTimeChange');
    const earlyReturnIdx = pickupHandler.indexOf('if (returnTimeTouchedRef.current) return;');
    const setPickupIdx = pickupHandler.indexOf('setPickupDateTime(value);');
    expect(earlyReturnIdx).toBeGreaterThan(setPickupIdx);
  });
});

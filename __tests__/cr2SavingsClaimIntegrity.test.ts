/**
 * CR-2 (2026-08-28) — regression coverage for the fill-up savings-claim
 * integrity fix. FillupLogger.tsx previously fabricated a "savings" figure:
 * an assumed AVG_OVERFILL_GAL = 0.4 gal "typical pump overfill" was invented
 * whenever actual-vs-planned gallons were within 0.5 gal of each other, and
 * Math.abs(actual - planned) was otherwise used as an "avoided" gallons
 * figure — erasing direction when the user pumped MORE than planned. This
 * pass removes the fabricated math and replaces it with a truthful,
 * direction-preserving planned-vs-actual comparison. It does NOT touch
 * Fillup persistence, the free monthly cap, validation, receipt scanning,
 * odometer logic, price intelligence, entitlements, or native/IAP code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { translations } from '@/lib/translations';

const repoRoot = path.resolve(__dirname, '..');
const fillupLoggerSrc = readFileSync(path.join(repoRoot, 'components/FillupLogger.tsx'), 'utf8');
const helpSrc = readFileSync(path.join(repoRoot, 'app/help/page.tsx'), 'utf8');
const aiChatSrc = readFileSync(path.join(repoRoot, 'app/api/ai/chat/route.ts'), 'utf8');
const featuresSrc = readFileSync(path.join(repoRoot, 'app/features/page.tsx'), 'utf8');

describe('CR-2 — fabricated overfill-savings algorithm fully removed from FillupLogger.tsx', () => {
  it('AVG_OVERFILL_GAL no longer exists', () => {
    expect(fillupLoggerSrc).not.toMatch(/AVG_OVERFILL_GAL/);
  });

  it('no fabricated "saved" amount is computed (no `const saved` savings assignment tied to overfill)', () => {
    expect(fillupLoggerSrc).not.toMatch(/const\s+saved\s*=\s*Math\.round\(overfill/);
  });

  it('Math.abs(...) is no longer used to derive a savings/overfill figure', () => {
    expect(fillupLoggerSrc).not.toMatch(/Math\.abs\(pumpedGal\s*-\s*prefill\.calculatedGallons\)/);
    expect(fillupLoggerSrc).not.toMatch(/Math\.abs\(actualGallons\s*-\s*plannedGallons\)/);
  });

  it('no "You saved money today" string remains', () => {
    expect(fillupLoggerSrc).not.toMatch(/You saved money today/);
  });

  it('no "$X saved at the pump"-style logic/string remains', () => {
    expect(fillupLoggerSrc).not.toMatch(/saved at the pump/i);
    expect(fillupLoggerSrc).not.toMatch(/Just saved \$/);
  });

  it('no "Without GasCap" counterfactual string/logic remains', () => {
    expect(fillupLoggerSrc).not.toMatch(/Without GasCap/i);
  });

  it('no "Typical pump overfill" string remains', () => {
    expect(fillupLoggerSrc).not.toMatch(/Typical pump overfill/i);
  });

  it('no vapor-recovery / "pumps click off a little late" explanation remains', () => {
    expect(fillupLoggerSrc).not.toMatch(/vapor recovery/i);
    expect(fillupLoggerSrc).not.toMatch(/click off a little late/i);
  });

  it('no "avoidedCost", "withoutGasCap", or "plannedCost + assumedSavings"-style construct exists', () => {
    expect(fillupLoggerSrc).not.toMatch(/avoidedCost/i);
    expect(fillupLoggerSrc).not.toMatch(/withoutGasCap/i);
    expect(fillupLoggerSrc).not.toMatch(/overfillGal/);
  });
});

describe('CR-2 — new FillupComparison data model', () => {
  it('retains plannedGallons in the comparison state', () => {
    expect(fillupLoggerSrc).toMatch(/plannedGallons/);
  });

  it('retains actualGallons in the comparison state', () => {
    expect(fillupLoggerSrc).toMatch(/actualGallons/);
  });

  it('computes gallonDifference directionally as actual - planned (not Math.abs)', () => {
    // Behavioral check: replicate the exact expression used in the component
    // and prove it preserves sign in both directions.
    const actualMinusPlanned = (actual: number, planned: number) =>
      Math.round((actual - planned) * 100) / 100;

    // Pumped MORE than planned → positive (must NOT be flattened to a
    // "savings" figure or made unsigned).
    expect(actualMinusPlanned(9.0, 8.2)).toBeCloseTo(0.8, 5);
    // Pumped LESS than planned → negative, sign preserved.
    expect(actualMinusPlanned(8.0, 8.2)).toBeCloseTo(-0.2, 5);

    // Source uses the signed subtraction, not Math.abs, to build gallonDifference.
    expect(fillupLoggerSrc).toMatch(
      /gallonDifference:\s*Math\.round\(\(pumpedGal\s*-\s*prefill\.calculatedGallons\)\s*\*\s*100\)\s*\/\s*100/,
    );
  });

  it('card renders no monetary savings inference ("saved", "avoided", "without GasCap")', () => {
    const cardStart = fillupLoggerSrc.indexOf('if (comparison) {');
    expect(cardStart).toBeGreaterThan(-1);
    const cardEnd = fillupLoggerSrc.indexOf('\n  return (\n    <div className="mt-3 rounded-2xl border-2 border-amber-200', cardStart);
    const card = fillupLoggerSrc.slice(cardStart, cardEnd > -1 ? cardEnd : cardStart + 4000);
    expect(card).not.toMatch(/\bsaved\b/i);
    expect(card).not.toMatch(/\bavoided\b/i);
    expect(card).not.toMatch(/without gascap/i);
  });

  it('share copy (retained, neutralized) contains no savings claim', () => {
    const shareIdx = fillupLoggerSrc.indexOf('handleShareComparison');
    expect(shareIdx).toBeGreaterThan(-1);
    const shareBlock = fillupLoggerSrc.slice(shareIdx, shareIdx + 600);
    expect(shareBlock).not.toMatch(/saved/i);
    expect(shareBlock).not.toMatch(/without gascap/i);
    expect(shareBlock).toMatch(/Planned/);
    expect(shareBlock).toMatch(/Actual fill/);
  });
});

describe('CR-2 — app/help/page.tsx corrected', () => {
  it('no longer claims a 0.4 gal industry-average overfill', () => {
    expect(helpSrc).not.toMatch(/industry-average pump overfill/i);
    expect(helpSrc).not.toMatch(/0\.4 gal/);
  });

  it('now describes plan-vs-actual comparison behavior', () => {
    expect(helpSrc).toMatch(/comparison card/i);
    expect(helpSrc).toMatch(/compare the planned gallons with the gallons you actually recorded/i);
  });

  it('prepay copy no longer claims the pump always stops precisely at the GasCap amount', () => {
    expect(helpSrc).not.toMatch(/stops precisely at that amount/i);
    expect(helpSrc).not.toMatch(/attendants can always set any amount/i);
  });
});

describe('CR-2 — app/api/ai/chat/route.ts system prompt corrected', () => {
  it('contains no "~$0.40" / industry-average savings claim', () => {
    expect(aiChatSrc).not.toMatch(/saves ~\$0\.40/);
    expect(aiChatSrc).not.toMatch(/industry-average pump overfill/i);
  });

  it('describes planned-vs-actual comparison instead of a savings card', () => {
    expect(aiChatSrc).toMatch(/planned-vs-actual comparison/i);
  });

  it('prepay guidance no longer claims the pump "stops precisely"', () => {
    expect(aiChatSrc).not.toMatch(/stops precisely/i);
  });
});

describe('CR-2 — unrelated surfaces left untouched', () => {
  it('genuine Find Gas / nearby-station language is unchanged', () => {
    expect(translations.en.findGasTab.findGasNearYou).toBe('Find Gas Near You');
  });

  it('the paid-vs-EIA-national-average comparison (legitimate, different feature) is unaffected', () => {
    // The inline price-intelligence card compares the entered price to the
    // national average and is unrelated to the fabricated pump-overfill
    // claim; it must still exist untouched.
    expect(fillupLoggerSrc).toMatch(/nationalAvg/);
    expect(fillupLoggerSrc).toMatch(/atNationalAvg/);
    expect(fillupLoggerSrc).toMatch(/belowNationalAvg/);
  });
});

describe('CR-2 pre-commit blocker fix — app/features/page.tsx overfill/never-overpay guarantee removed', () => {
  it('1. no longer contains "Never overpay for gas again"', () => {
    expect(featuresSrc).not.toMatch(/Never overpay for gas again/i);
  });

  it('2. no longer contains "no more overfilling"', () => {
    expect(featuresSrc).not.toMatch(/no more overfilling/i);
  });

  it('3. Fuel Calculator feature copy describes a planned fill based on user inputs, not a guaranteed physical outcome', () => {
    const fuelCalcIdx = featuresSrc.indexOf("title: 'Fuel Calculator'");
    expect(fuelCalcIdx).toBeGreaterThan(-1);
    const block = featuresSrc.slice(fuelCalcIdx, fuelCalcIdx + 400);
    expect(block).toMatch(/planned/i);
    expect(block).not.toMatch(/no more overfilling/i);
    expect(block).not.toMatch(/exact gallons to pump/i);
  });

  it('4. genuine Find Gas / nearby-station real-time language remains intact in this file', () => {
    expect(featuresSrc).toMatch(/real-time prices at nearby stations/i);
  });
});

describe('CR-2 pre-commit blocker fix — post-fill cost labels distinguish observed payment from a derived figure', () => {
  it('5. explicit amountPaid is labeled "Amount paid", not an ambiguous "cost" term', () => {
    expect(translations.en.fillup.comparisonFillCost).toBe('Amount paid');
    expect(translations.es.fillup.comparisonFillCost).toBe('Monto pagado');
  });

  it('the calculated (non-entered) figure is labeled as calculated, never implying it was observed/paid', () => {
    expect(translations.en.fillup.comparisonCalculatedCost).toMatch(/calculated/i);
    expect(translations.es.fillup.comparisonCalculatedCost).toMatch(/calculad/i);
  });

  it('the two cost labels are distinct strings — a derived figure can never render under the "paid" label', () => {
    expect(translations.en.fillup.comparisonFillCost).not.toBe(translations.en.fillup.comparisonCalculatedCost);
  });

  it('the component picks the label based on whether amountPaid was explicitly entered, not unconditionally', () => {
    const idx = fillupLoggerSrc.indexOf('const costLabel');
    const block = fillupLoggerSrc.slice(idx, idx + 200);
    expect(block).toMatch(/comparison\.amountPaid !== undefined/);
    expect(block).toMatch(/t\.fillup\.comparisonFillCost/);
    expect(block).toMatch(/t\.fillup\.comparisonCalculatedCost/);
  });
});

describe('CR-2 pre-commit blocker fix — difference presentation stays neutral', () => {
  it('gallonDifference is still actual - planned (signed), never Math.abs', () => {
    expect(fillupLoggerSrc).toMatch(/gallonDifference:\s*Math\.round\(\(pumpedGal - prefill\.calculatedGallons\)/);
    expect(fillupLoggerSrc).not.toMatch(/Math\.abs\(pumpedGal/);
  });

  it('the difference row is not styled with sign-conditional good/bad/saved/wasted classes', () => {
    const idx = fillupLoggerSrc.indexOf('comparisonDifference');
    const rowBlock = fillupLoggerSrc.slice(idx - 200, idx + 300);
    // No conditional (ternary keyed on diff sign) color classes on this row.
    expect(rowBlock).not.toMatch(/diff > 0 \? '.*(green|emerald|red|rose).*' :/);
    expect(rowBlock).not.toMatch(/diff < 0 \? '.*(green|emerald|red|rose).*' :/);
  });
});

/**
 * Phase 1 P1-B — fuel-data integrity (plan is never saved as actual), the
 * post-save result card model, the price hint, and the feedback analytics.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { buildFuelFeedback, areaKind } from '../lib/fuelFeedback';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

const saved = (over: Record<string, unknown> = {}) => ({
  id: 'f1', date: '2026-10-08', gallonsPumped: 10, pricePerGallon: 3.2, totalCost: 32,
  fuelGrade: 'regular', baselinePrice: 3.5, baselineSource: 'eia_weekly', baselineArea: 'NUS', baselinePeriod: '2026-10-05',
  odometerReading: null as number | null, ...over,
});

describe('buildFuelFeedback — uses the saved, confirmed row only', () => {
  it('priced: below the average, with the real EIA week and area kind', () => {
    const f = buildFuelFeedback(saved());
    expect(f).toMatchObject({ outcome: 'priced', direction: 'below', amount: 3, grade: 'regular', baselinePrice: 3.5, baselinePeriod: '2026-10-05', areaKind: 'national' });
    expect(f.paidPerGallon).toBeCloseTo(3.2, 3);
  });
  it('paying MORE than the average is reported as-is (never hidden or floored)', () => {
    const f = buildFuelFeedback(saved({ pricePerGallon: 3.8, totalCost: 38 }));
    expect(f).toMatchObject({ outcome: 'priced', direction: 'above', amount: 3 });
  });
  it('right at the average is "same"', () => {
    expect(buildFuelFeedback(saved({ pricePerGallon: 3.5, totalCost: 35 })).direction).toBe('same');
  });
  it('savings come from the amount actually paid (totalCost), not gallons x entered price', () => {
    // 10 gal at an entered 3.20 but only $30 actually paid (a discount) -> $5 under a 3.50 average.
    const f = buildFuelFeedback(saved({ totalCost: 30 }));
    expect(f.amount).toBe(5);
  });
  it('area kind: national / regional / state series', () => {
    expect(areaKind('NUS')).toBe('national');
    expect(areaKind('R1Z')).toBe('regional');
    expect(areaKind('SFL')).toBe('state');
    expect(areaKind(undefined)).toBe('national');
    expect(buildFuelFeedback(saved({ baselineArea: 'SFL' })).areaKind).toBe('state');
  });
});

describe('buildFuelFeedback — says so when data is insufficient (no fabrication)', () => {
  it('no stored baseline -> insufficient_data / no_baseline (no fallback constant, no estimate)', () => {
    const f = buildFuelFeedback(saved({ baselinePrice: null, baselineSource: null, baselineArea: null, baselinePeriod: null }));
    expect(f).toMatchObject({ outcome: 'insufficient_data', reason: 'no_baseline' });
    expect(f.amount).toBeUndefined();
    expect(f.baselinePrice).toBeUndefined();
  });
  it('no grade is never assumed to be regular', () => {
    expect(buildFuelFeedback(saved({ fuelGrade: null }))).toMatchObject({ outcome: 'insufficient_data', reason: 'no_grade' });
    expect(buildFuelFeedback(saved({ fuelGrade: '' }))).toMatchObject({ outcome: 'insufficient_data', reason: 'no_grade' });
  });
  it('an unsupported grade (e85) gets no comparison', () => {
    expect(buildFuelFeedback(saved({ fuelGrade: 'e85' }))).toMatchObject({ outcome: 'insufficient_data', reason: 'unsupported_grade' });
  });
  it('numbers that do not line up are refused, not "compared"', () => {
    expect(buildFuelFeedback(saved({ totalCost: 100 }))).toMatchObject({ outcome: 'insufficient_data', reason: 'invalid' });  // price/total mismatch
    expect(buildFuelFeedback(saved({ baselinePrice: 9, pricePerGallon: 3.2, totalCost: 32 }))).toMatchObject({ outcome: 'insufficient_data', reason: 'invalid' }); // gap > $3
    expect(buildFuelFeedback(saved({ gallonsPumped: 0 }))).toMatchObject({ outcome: 'insufficient_data', reason: 'invalid' });
  });
  it('a baseline from a different source is not trusted', () => {
    expect(buildFuelFeedback(saved({ baselineSource: 'seed' })).outcome).toBe('insufficient_data');
  });
  it('next step: add odometer when missing, otherwise log the next fill-up', () => {
    expect(buildFuelFeedback(saved()).nextStep).toBe('add_odometer');
    expect(buildFuelFeedback(saved({ odometerReading: 45210 })).nextStep).toBe('log_next');
  });
  it('the model module is pure: no fetch, DB or prediction language', () => {
    const src = read('lib/fuelFeedback.ts').split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
    expect(src).not.toMatch(/prisma|fetch\(|localStorage|BUY|WAIT|predict|forecast/i);
  });
});

describe('plan is never saved as actual (FillupLogger)', () => {
  const src = read('components/FillupLogger.tsx');

  it('gallons and price fields start EMPTY — not initialised from the prefill', () => {
    expect(src).toMatch(/const \[gallons,\s+setGallons\]\s+=\s+useState\(''\)/);
    expect(src).toMatch(/const \[price,\s+setPrice\]\s+=\s+useState\(''\)/);
    expect(src).not.toMatch(/useState\(String\(prefill\.gallonsPumped\)\)/);
    expect(src).not.toMatch(/useState\(String\(prefill\.pricePerGallon\)\)/);
  });

  it('the plan is shown as reference with an explicit "Same as planned" action', () => {
    expect(src).toMatch(/t\.fillup\.planReferenceBoth\(/);
    expect(src).toMatch(/t\.fillup\.sameAsPlanned/);
  });

  it('only the explicit button copies plan values into the fields', () => {
    // Every setGallons/setPrice call: typing, receipt scan, or the confirm button.
    const calls = [...src.matchAll(/set(Gallons|Price)\(([^)]*)\)/g)].map((m) => m[0]);
    for (const c of calls) {
      expect(c, c).not.toMatch(/prefill\./);
    }
    const confirm = src.slice(src.indexOf('onClick={() => {\n              if (planGallons > 0)'), src.indexOf('t.fillup.usePostedPrice'));
    expect(confirm).toMatch(/setGallons\(String\(Math\.round\(planGallons/);
    expect(confirm).toMatch(/setPrice\(String\(Math\.round\(planPrice/);
  });

  it('Save with blank fields is refused by the existing validation (no silent plan)', () => {
    expect(src).toMatch(/if \(!gallons \|\| parseFloat\(gallons\) <= 0\) \{ setError\(t\.fillup\.errGallons\)/);
    expect(src).toMatch(/if \(!price\s+\|\| parseFloat\(price\)\s+<= 0\) \{ setError\(t\.fillup\.errPrice\)/);
  });

  it('the request body is built from the entered fields, never the prefill plan', () => {
    const body = src.slice(src.indexOf('gallonsPumped:   parseFloat(gallons)'), src.indexOf('force,'));
    expect(body).toMatch(/pricePerGallon:  parseFloat\(price\)/);
    expect(body).not.toMatch(/prefill\.(gallonsPumped|pricePerGallon|calculatedGallons)/);
  });

  it('callers still pass the plan (so it can be shown as reference)', () => {
    expect(read('components/ResultCard.tsx')).toMatch(/calculatedGallons:\s+result\.gallonsNeeded/);
    expect(read('components/ManualFillupLogger.tsx')).toMatch(/gallonsPumped:\s+0,/);
  });
});

describe('price hint is display-only', () => {
  const src = read('components/FillupLogger.tsx');
  it('the weekly average is a caption, never written into the price field', () => {
    expect(src).toMatch(/t\.fillup\.priceAvgHint\(/);
    expect(src).not.toMatch(/setPrice\([^)]*nationalAvg/);
  });
  it('the hint copy says LATEST NATIONAL (not matched to the fill date), in EN and ES', () => {
    const tr = read('lib/translations.ts');
    expect(tr).toMatch(/priceAvgHint:[^\n]*`Latest national \$\{grade\} average \(EIA, week of \$\{week\}\): \$\$\{price\}\. Enter what you paid\.`/);
    expect(tr).toMatch(/priceAvgHint:[^\n]*`Último promedio nacional de \$\{grade\} \(EIA, semana del \$\{week\}\)/);
    expect(tr).not.toMatch(/priceAvgHint:[^\n]*`Average \$\{grade\} price/);
    // still the latest-national endpoint, no historical lookup was added
    expect(read('components/FillupLogger.tsx')).toMatch(/\/api\/gas-price\/national\?grade=\$\{fuelGrade\}/);
    expect(read('components/FillupLogger.tsx')).not.toMatch(/gas-price\/(history|at|date)/);
  });
  it('it is grade-matched: only shown once a priceable grade selected the average', () => {
    expect(src).toMatch(/\/api\/gas-price\/national\?grade=\$\{fuelGrade\}/);
  });
});

describe('post-save result card appears on both save paths', () => {
  const src = read('components/FillupLogger.tsx');
  it('feedback is built from the saved response, not from plan values', () => {
    // G1 parses the saved response once so the same JSON also carries the server-decided GasPoints award;
    // feedback is still built from that SAVED row only.
    expect(src).toMatch(/const savedJson = await res\.json\(\);\s*fb = buildFuelFeedback\(savedJson\);/);
  });
  it('manual path shows a result card and waits for Done instead of closing immediately', () => {
    expect(src).toMatch(/if \(fb\) \{ setFeedback\(fb\); setSavedOk\(true\); \}\s*\/\/[^\n]*\n\s*else onSaved\(\);/);
    expect(src).toMatch(/if \(savedOk && feedback\) \{[\s\S]*?<FuelFeedbackCard feedback=\{feedback\} \/>[\s\S]*?onClick=\{onSaved\}/);
  });
  it('the planned-vs-actual card also carries the feedback', () => {
    const cmp = src.slice(src.indexOf('if (comparison) {'), src.indexOf('Post-save result card (manual'));
    expect(cmp).toMatch(/<FuelFeedbackCard feedback=\{feedback\} \/>/);
  });
  it('the card is honest: no prediction, no BUY/WAIT, says "not enough data" when it must', () => {
    const full = read('components/FuelFeedbackCard.tsx');
    const card = full.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');   // code only, not comments
    expect(card).not.toMatch(/\b(buy now|wait|predict|forecast)\b/i);
    expect(card).toMatch(/feedbackInsufficientTitle/);
  });
});

describe('copy parity and non-regression', () => {
  const tr = read('lib/translations.ts');
  const keys = ['planReferenceBoth', 'planReferencePrice', 'planConfirmHint', 'sameAsPlanned', 'usePostedPrice', 'priceAvgHint', 'savedTitle',
    'feedbackBelow', 'feedbackAbove', 'feedbackSame', 'feedbackDetail', 'feedbackAreaNational', 'feedbackAreaRegional', 'feedbackAreaState',
    'feedbackInsufficientTitle', 'feedbackReasonNoGrade', 'feedbackReasonUnsupported', 'feedbackReasonNoBaseline', 'feedbackReasonInvalid',
    'feedbackNextOdometer', 'feedbackNextLog', 'feedbackSource'];
  it.each(keys)('EN and ES both define %s', (k) => {
    expect((tr.match(new RegExp(`\\b${k}:`, 'g')) ?? []).length).toBe(2);
  });
  it('help page and AI feature block describe plan-vs-actual and the result card', () => {
    expect(read('app/help/page.tsx')).toMatch(/never saves a plan as what you actually pumped/);
    expect(read('app/api/ai/chat/route.ts')).toMatch(/never saves a plan as what was pumped/);
  });
  it('savings logic and the snapshot/baseline modules are untouched by P1-B', () => {
    expect(read('lib/fuelFeedback.ts')).toMatch(/computeFillupSavings\(saved, \{\}\)/);
  });
});

// ── fillup_feedback_viewed ingest ───────────────────────────────────────────
const getServerSession = vi.fn(async (..._a: unknown[]) => null as unknown);
const recordAnalyticsEvent = vi.fn(async (..._a: unknown[]) => ({ outcome: 'written' as const, id: 'e1' }));
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])) }));
vi.mock('@/lib/rateLimitDb', () => ({
  checkRateLimitDb: async () => ({ allowed: true, remaining: 59, resetInSeconds: 60 }),
  hashRateLimitIdentifier: (s: string) => `h:${s}`,
}));
vi.mock('@/lib/clientIp', () => ({ getTrustedClientIp: () => '203.0.113.7' }));
async function post(body: unknown) {
  const { POST } = await import('@/app/api/analytics/event/route');
  return POST(new Request('https://www.gascap.app/api/analytics/event', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

describe('fillup_feedback_viewed ingest', () => {
  beforeEach(() => { vi.clearAllMocks(); getServerSession.mockResolvedValue({ user: { id: 'u1' } }); });

  it('accepts a priced outcome and an insufficient_data outcome with a reason', async () => {
    expect((await post({ eventType: 'fillup_feedback_viewed', originPlatform: 'web', metadata: { outcome: 'priced' } })).status).toBe(202);
    expect((await post({ eventType: 'fillup_feedback_viewed', originPlatform: 'ios', metadata: { outcome: 'insufficient_data', reason: 'no_grade' } })).status).toBe(202);
  });
  it('rejects fuel/price values, unknown keys, bad enums and missing outcome', async () => {
    const bad = [
      { outcome: 'priced', gallons: 10 }, { outcome: 'priced', price: 3.2 }, { outcome: 'priced', station: 'Shell' },
      { outcome: 'great' }, { outcome: 'insufficient_data', reason: 'because' }, { reason: 'no_grade' }, {},
    ];
    for (const metadata of bad) {
      const res = await post({ eventType: 'fillup_feedback_viewed', originPlatform: 'web', metadata });
      expect(res.status, JSON.stringify(metadata)).toBe(400);
    }
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });
  it('a priced outcome must NOT carry a reason (every reason value rejected)', async () => {
    for (const reason of ['no_grade', 'unsupported_grade', 'no_baseline', 'invalid']) {
      const res = await post({ eventType: 'fillup_feedback_viewed', originPlatform: 'web', metadata: { outcome: 'priced', reason } });
      expect(res.status, reason).toBe(400);
    }
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });
  it('an insufficient_data outcome MUST carry one valid reason', async () => {
    expect((await post({ eventType: 'fillup_feedback_viewed', originPlatform: 'web', metadata: { outcome: 'insufficient_data' } })).status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
    for (const reason of ['no_grade', 'unsupported_grade', 'no_baseline', 'invalid']) {
      const res = await post({ eventType: 'fillup_feedback_viewed', originPlatform: 'web', metadata: { outcome: 'insufficient_data', reason } });
      expect(res.status, reason).toBe(202);
    }
  });
  it('the valid combinations are exactly: priced alone, or insufficient_data + a reason', async () => {
    expect((await post({ eventType: 'fillup_feedback_viewed', originPlatform: 'web', metadata: { outcome: 'priced' } })).status).toBe(202);
    expect((await post({ eventType: 'fillup_feedback_viewed', originPlatform: 'web', metadata: { outcome: 'insufficient_data', reason: 'invalid', gallons: 1 } })).status).toBe(400);
  });
  it('requires a signed-in user', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await post({ eventType: 'fillup_feedback_viewed', originPlatform: 'web', metadata: { outcome: 'priced' } })).status).toBe(401);
  });
  it('the card fires it once per mount from an effect, not on render', () => {
    const card = read('components/FuelFeedbackCard.tsx');
    expect(card).toMatch(/const fired = useRef\(false\)/);
    expect(card).toMatch(/useEffect\(\(\) => \{\s*if \(fired\.current\) return;/);
  });
});

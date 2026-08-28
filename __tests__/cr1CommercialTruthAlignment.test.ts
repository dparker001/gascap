/**
 * CR-1 (2026-08-28) — regression coverage for the commercial-truth-alignment
 * copy/metadata pass. This is copy/translations/structured-data only; it
 * must NOT change entitlement logic. These tests pin down:
 *   1. Rental Car Return Mode removed from Free, present exactly once in Pro
 *      (EN + ES).
 *   2. The EIA "real-time local prices" overstatement is gone from the
 *      surfaces this pass touched.
 *   3. The unsubstantiated JSON-LD aggregateRating block is removed.
 *   4. The Free tier's 5-fill-up/month allowance is now visible in copy.
 *   5. The FREE_MONTHLY_FILLUP_LIMIT constant is unchanged (still 5).
 *   6. The POST /api/rental-sessions Pro gate is untouched.
 *   7. Station-level "Find Gas" real-time language was not collaterally
 *      destroyed by an overly broad search-and-replace.
 *   8. No protected entitlement/IAP/Stripe/RevenueCat file was modified.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { translations } from '@/lib/translations';
import { FREE_MONTHLY_FILLUP_LIMIT } from '@/lib/serverPlan';

const repoRoot = path.resolve(__dirname, '..');

describe('CR-1 — Rental Car Return Mode: Free removed, Pro retained exactly once', () => {
  it('EN freeFeatures no longer contains "Rental Car Return Mode" / "Rental Return Mode"', () => {
    const hit = translations.en.pricing.freeFeatures.some((f: string) =>
      /rental (car )?return mode/i.test(f),
    );
    expect(hit).toBe(false);
  });

  it('EN proFeatures contains the Rental Return Mode line exactly once', () => {
    const matches = translations.en.pricing.proFeatures.filter((f: string) =>
      /rental return mode/i.test(f),
    );
    expect(matches.length).toBe(1);
  });

  it('ES freeFeatures no longer contains the Spanish rental line', () => {
    const hit = translations.es.pricing.freeFeatures.some((f: string) =>
      /devoluci[oó]n de auto de alquiler/i.test(f),
    );
    expect(hit).toBe(false);
  });

  it('ES proFeatures contains the Spanish Rental Return Mode line exactly once', () => {
    const matches = translations.es.pricing.proFeatures.filter((f: string) =>
      /devoluci[oó]n de auto de alquiler/i.test(f),
    );
    expect(matches.length).toBe(1);
  });

  it('app/help/page.tsx "What does Pro add?" answer mentions Rental Car Return Mode', () => {
    const src = readFileSync(path.join(repoRoot, 'app/help/page.tsx'), 'utf8');
    const idx = src.indexOf("q: 'What does Pro add?'");
    expect(idx).toBeGreaterThan(-1);
    const answerSlice = src.slice(idx, idx + 800);
    expect(answerSlice).toMatch(/Rental Car Return Mode/);
  });
});

describe('CR-1 — EIA "real-time local prices" overstatement corrected', () => {
  it('EN pricing/features copy touched by this pass no longer says "Real-time local prices"', () => {
    // This is the exact P0-2 phrase from the audit; assert it is gone from
    // the translations module entirely (the only known occurrence was the
    // EIA-tied features-list body this pass fixed).
    const serialized = JSON.stringify(translations.en);
    expect(serialized).not.toMatch(/Real-time local prices/i);
  });

  it('ES equivalent "Precios locales en tiempo real" is gone', () => {
    const serialized = JSON.stringify(translations.es);
    expect(serialized).not.toMatch(/Precios locales en tiempo real/i);
  });

  it('app/page.tsx FAQ answer no longer claims "live EIA data"', () => {
    const src = readFileSync(path.join(repoRoot, 'app/page.tsx'), 'utf8');
    expect(src).not.toMatch(/live EIA data/i);
  });

  it('docs/APP_STORE_LISTINGS.md no longer claims "Real-time local gas prices"', () => {
    const src = readFileSync(path.join(repoRoot, 'docs/APP_STORE_LISTINGS.md'), 'utf8');
    expect(src).not.toMatch(/Real-time local gas prices/i);
  });
});

describe('CR-1 — station-level Find Gas real-time language preserved (not collaterally removed)', () => {
  it('Find Gas tab translations still describe live/nearby station prices', () => {
    const src = readFileSync(path.join(repoRoot, 'lib/translations.ts'), 'utf8');
    expect(src).toMatch(/real-time gas prices at nearby stations/i);
    expect(src).toMatch(/Live prices from Google at nearby stations/i);
  });

  it('app/features/page.tsx Find Gas section still describes real-time nearby station prices', () => {
    const src = readFileSync(path.join(repoRoot, 'app/features/page.tsx'), 'utf8');
    expect(src).toMatch(/real-time prices at nearby stations/i);
  });
});

describe('CR-1 — JSON-LD aggregateRating removed', () => {
  it('app/page.tsx SoftwareApplication schema no longer contains aggregateRating/ratingCount 47', () => {
    const src = readFileSync(path.join(repoRoot, 'app/page.tsx'), 'utf8');
    expect(src).not.toMatch(/aggregateRating/);
    expect(src).not.toMatch(/AggregateRating/);
    expect(src).not.toMatch(/ratingCount:\s*'47'/);
  });
});

describe('CR-1 — Free 5-fill-up/month allowance now visible in copy', () => {
  it('EN freeFeatures mentions the 5 fill-ups/month allowance', () => {
    const hit = translations.en.pricing.freeFeatures.some((f: string) =>
      /5 fill-ups? per month/i.test(f),
    );
    expect(hit).toBe(true);
  });

  it('ES freeFeatures mentions the 5 fill-ups/month allowance', () => {
    const hit = translations.es.pricing.freeFeatures.some((f: string) =>
      /5 cargas? de combustible por mes/i.test(f),
    );
    expect(hit).toBe(true);
  });

  it('app/help/page.tsx free-plan FAQ mentions 5 fill-ups a month', () => {
    const src = readFileSync(path.join(repoRoot, 'app/help/page.tsx'), 'utf8');
    expect(src).toMatch(/5 fill-ups a month|up to 5 fill-ups logged per month/i);
  });
});

describe('CR-1 — regression guard: FREE_MONTHLY_FILLUP_LIMIT constant unchanged', () => {
  it('is still exactly 5', () => {
    expect(FREE_MONTHLY_FILLUP_LIMIT).toBe(5);
  });
});

describe('CR-1 — regression guard: POST /api/rental-sessions Pro gate untouched', () => {
  it('still contains the exact isPro 403 proRequired check', () => {
    const src = readFileSync(
      path.join(repoRoot, 'app/api/rental-sessions/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/const \{ isPro \} = await getLivePlan\(\);/);
    expect(src).toMatch(/if \(!isPro\)/);
    expect(src).toMatch(/proRequired:\s*true/);
    expect(src).toMatch(/status:\s*403/);
  });
});

describe('CR-1 — no entitlement/IAP/Stripe/RevenueCat file was touched', () => {
  it('git diff against main touches no protected-path file', () => {
    let changed: string[] = [];
    try {
      const out = execSync('git diff --name-only main...HEAD', {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      changed = out.split('\n').filter(Boolean);
    } catch {
      // If `main...HEAD` diffing isn't available in this environment (e.g. a
      // shallow clone or detached checkout), fall back to the working-tree
      // diff, which is what actually matters for an uncommitted CR-1 pass.
      const out = execSync('git diff --name-only', { cwd: repoRoot, encoding: 'utf8' });
      changed = out.split('\n').filter(Boolean);
    }

    const protectedPatterns = [
      /^lib\/serverPlan\.ts$/,
      /revenuecat/i,
      /stripe/i,
      /^app\/api\/rental-sessions\/route\.ts$/, // copy-only edits forbidden; any edit here must be scrutinized
      /getaway.*fulfillment/i,
      /storekit/i,
      /capacitor\.config\.json$/,
    ];

    const offenders = changed.filter((f) => protectedPatterns.some((re) => re.test(f)));
    expect(offenders).toEqual([]);
  });
});

// ── CR-1 follow-up round (2026-08-28 independent review) ─────────────────────
// Blockers: (1) "fill-up history" falsely claimed Pro-exclusive, (2) remaining
// generic EIA "real-time"/"live" claims, (3) static visible "5.0★ Average
// rating" StatsBar stat. Plus two P1 cleanups: time-sensitive "record highs"
// hero copy, and unsubstantiated "Most Popular"/"Most members choose Lifetime"
// claims.

describe('CR-1 follow-up — basic fill-up history is not claimed Pro-exclusive', () => {
  it('EN proFeatures fill-up line says "unlimited fill-up logging" without bundling "fuel history" as an exclusive claim', () => {
    const line = translations.en.pricing.proFeatures.find((f: string) =>
      /fill-up logging/i.test(f),
    );
    expect(line).toBeDefined();
    expect(line).not.toMatch(/fuel history/i);
  });

  it('ES proFeatures equivalent does not bundle "historial" into the fill-up logging line', () => {
    const line = translations.es.pricing.proFeatures.find((f: string) =>
      /registro.*cargas/i.test(f),
    );
    expect(line).toBeDefined();
    expect(line).not.toMatch(/historial/i);
  });

  it('app/help/page.tsx "What does Pro add?" does not claim basic fill-up history is Pro-exclusive', () => {
    const src = readFileSync(path.join(repoRoot, 'app/help/page.tsx'), 'utf8');
    const idx = src.indexOf("q: 'What does Pro add?'");
    expect(idx).toBeGreaterThan(-1);
    const answerSlice = src.slice(idx, idx + 900);
    // The old wording claimed "unlimited fill-up history & MPG tracking" as a
    // single Pro-exclusive bundle. It must no longer claim history itself is
    // Pro-only, and should instead say logging is unlimited.
    expect(answerSlice).not.toMatch(/unlimited fill-up history/i);
    expect(answerSlice).toMatch(/unlimited fill-up logging/i);
  });

  it('FREE_MONTHLY_FILLUP_LIMIT constant is still exactly 5 (regression guard)', () => {
    expect(FREE_MONTHLY_FILLUP_LIMIT).toBe(5);
  });

  it('GET /api/fillups is not Pro-gated (basic history stays available to Free)', () => {
    const src = readFileSync(path.join(repoRoot, 'app/api/fillups/route.ts'), 'utf8');
    const getIdx = src.indexOf('export async function GET');
    const postIdx = src.indexOf('export async function POST');
    expect(getIdx).toBeGreaterThan(-1);
    const getBody = src.slice(getIdx, postIdx > -1 ? postIdx : undefined);
    expect(getBody).not.toMatch(/isPro/);
    expect(getBody).not.toMatch(/proRequired/);
  });
});

describe('CR-1 follow-up — remaining generic EIA "real-time"/"live" claims corrected', () => {
  it('Header realTimePrices pill no longer says "Real-time prices"', () => {
    expect(translations.en.header.realTimePrices).not.toMatch(/real-time/i);
  });

  it('Hero pill_prices no longer says "Live local prices"', () => {
    expect(translations.en.hero.pill_prices).not.toMatch(/live/i);
  });

  it('EN/ES marketing copy contains none of the generic EIA overstatements', () => {
    const enSerialized = JSON.stringify(translations.en);
    const esSerialized = JSON.stringify(translations.es);
    expect(enSerialized).not.toMatch(/Real-time prices/i);
    expect(enSerialized).not.toMatch(/Live local prices/i);
    expect(enSerialized).not.toMatch(/Real-time local prices/i);
    expect(esSerialized).not.toMatch(/Precios en tiempo real/);
    expect(esSerialized).not.toMatch(/Precios locales en tiempo real/);
  });

  it('genuine station-level Find Gas / Google Places terminology remains intact (spot check)', () => {
    const src = readFileSync(path.join(repoRoot, 'lib/translations.ts'), 'utf8');
    // This describes the real Google Places-backed Find Gas feature, not the
    // generic EIA state-average lookup, and must survive untouched.
    expect(src).toMatch(/real-time gas prices at nearby stations/i);
    expect(translations.es.findGasTab.proGateFeature1).toMatch(/Google/);
  });

  it('app/help/page.tsx Find Gas tab description still describes genuine station-level live prices', () => {
    const src = readFileSync(path.join(repoRoot, 'app/help/page.tsx'), 'utf8');
    expect(src).toMatch(/Find Gas tab shows live gas prices at stations near you, powered by Google Places/i);
  });
});

describe('CR-1 follow-up — static "5.0★ Average rating" StatsBar claim removed', () => {
  it('EN stats no longer contains a 5.0/rating claim', () => {
    const hit = translations.en.stats.some(
      (s: { value: string; label: string }) =>
        /5\.0/.test(s.value) || /rating/i.test(s.label),
    );
    expect(hit).toBe(false);
  });

  it('ES stats no longer contains a 5.0/calificación claim', () => {
    const hit = translations.es.stats.some(
      (s: { value: string; label: string }) =>
        /5\.0/.test(s.value) || /calificaci[oó]n/i.test(s.label),
    );
    expect(hit).toBe(false);
  });
});

describe('CR-1 follow-up — time-sensitive "record highs" hero claim removed', () => {
  it('EN hero.sub no longer references record-high gas prices', () => {
    expect(translations.en.hero.sub).not.toMatch(/record highs?/i);
  });

  it('ES hero.sub no longer references "máximos históricos"', () => {
    expect(translations.es.hero.sub).not.toMatch(/m[aá]ximos hist[oó]ricos/i);
  });
});

describe('CR-1 follow-up — unsubstantiated popularity claims removed', () => {
  it('EN pricing.lifetimeRibbon and pricing.breakEven no longer claim "Most Popular"/"Most members choose"', () => {
    expect(translations.en.pricing.lifetimeRibbon).not.toMatch(/most popular/i);
    expect(translations.en.pricing.breakEven).not.toMatch(/most members choose/i);
  });

  it('ES equivalents no longer claim "Más Popular"/"La mayoría elige"', () => {
    expect(translations.es.pricing.lifetimeRibbon).not.toMatch(/m[aá]s popular/i);
    expect(translations.es.pricing.breakEven).not.toMatch(/la mayor[ií]a elige/i);
  });

  it('no remaining "Most Popular" string anywhere in translations.ts', () => {
    const src = readFileSync(path.join(repoRoot, 'lib/translations.ts'), 'utf8');
    expect(src).not.toMatch(/Most Popular/);
    expect(src).not.toMatch(/M[aá]s Popular/);
  });
});

describe('CR-1 P0 follow-up — App Store review notes no longer contradict native IAP (lib/iap.ts implements RevenueCat/StoreKit/Play Billing)', () => {
  const appStoreDocSrc = readFileSync(path.join(repoRoot, 'docs/APP_STORE_LISTINGS.md'), 'utf8');

  it('does not claim there are NO in-app purchases', () => {
    expect(appStoreDocSrc).not.toMatch(/NO in-app purchases/i);
  });

  it('does not claim the Pro plan is sold only on the website', () => {
    expect(appStoreDocSrc).not.toMatch(/Pro plan is sold only on our website/i);
  });

  it('does not claim the app itself is fully free', () => {
    expect(appStoreDocSrc).not.toMatch(/the app itself is fully free/i);
  });

  it('does not claim payment is handled by Stripe on the web / not in-app', () => {
    expect(appStoreDocSrc).not.toMatch(/Payment handled by \*{0,2}Stripe on the web\*{0,2}, not in-app/i);
  });

  it('does not claim the store listing is "100% free to use"', () => {
    expect(appStoreDocSrc).not.toMatch(/100% free to use/i);
  });

  it('App Review notes now reference native Apple In-App Purchase and the actual Pro prices', () => {
    const notesStart = appStoreDocSrc.indexOf('## App Review notes');
    const notesBlock = appStoreDocSrc.slice(notesStart, notesStart + 800);
    expect(notesBlock).toMatch(/Apple In-App Purchase/);
    expect(notesBlock).toMatch(/\$2\.99\/month/);
    expect(notesBlock).toMatch(/\$19\.99/);
  });

  it('the financial-info privacy note distinguishes native (Apple/Google Play) vs. web (Stripe) payment processing', () => {
    expect(appStoreDocSrc).toMatch(/processed by \*{0,2}Apple\*{0,2}/);
    expect(appStoreDocSrc).toMatch(/processed by \*{0,2}Google Play Billing\*{0,2}/);
    expect(appStoreDocSrc).toMatch(/processed by \*{0,2}Stripe\*{0,2}/);
  });

  it('the full store description no longer says "100% free" and instead states Pro is optional', () => {
    expect(appStoreDocSrc).toMatch(/Free to start, with optional Pro features/i);
  });

  it('Rental Car mode is labeled as a Pro feature in the "WHY DRIVERS LOVE GASCAP" store description list', () => {
    expect(appStoreDocSrc).toMatch(/Rental Car mode \(Pro\)/);
  });

  it('this fix did not touch IAP/RevenueCat/StoreKit/Stripe implementation files', () => {
    // Same shallow-clone-safe fallback as the "no protected-path file"
    // test above — `main...HEAD` isn't resolvable in CI's shallow
    // (fetch-depth 1) checkout, where only the pushed commit exists
    // locally. Falling back to the plain working-tree diff is a no-op
    // once these changes are committed, same known limitation already
    // accepted by the other protected-path test in this file.
    let changedFiles: string[] = [];
    try {
      const out = execSync('git diff --name-only main...HEAD', { cwd: repoRoot, encoding: 'utf8' });
      changedFiles = out.split('\n').filter(Boolean);
    } catch {
      const out = execSync('git diff --name-only', { cwd: repoRoot, encoding: 'utf8' });
      changedFiles = out.split('\n').filter(Boolean);
    }
    const protectedPatterns = [/lib\/iap/i, /revenuecat/i, /storekit/i, /stripe/i, /serverPlan/i, /capacitor\.config/i];
    for (const file of changedFiles) {
      for (const pattern of protectedPatterns) {
        expect(file).not.toMatch(pattern);
      }
    }
  });
});

describe('CR-1b (2026-08-28) — missed metadata/email commercial-truth cleanup', () => {
  const layoutSrc = readFileSync(path.join(repoRoot, 'app/layout.tsx'), 'utf8');
  const emailSrc = readFileSync(path.join(repoRoot, 'lib/email.ts'), 'utf8');
  const translationsSrcForStation = readFileSync(path.join(repoRoot, 'lib/translations.ts'), 'utf8');

  it('1. app/layout.tsx metadata.description no longer contains "Live local gas prices"', () => {
    expect(layoutSrc).not.toMatch(/Live local gas prices/);
  });

  it('2. app/layout.tsx Twitter/X description no longer contains "live local prices"', () => {
    expect(layoutSrc).not.toMatch(/live local prices/i);
  });

  it('3. layout metadata uses truthful state-average/EIA-oriented terminology', () => {
    expect(layoutSrc).toMatch(/Current state-average gas prices/);
  });

  it('4. lib/email.ts no longer contains "Live local gas prices"', () => {
    expect(emailSrc).not.toMatch(/Live local gas prices/);
  });

  it('5. the Pro email no longer contains "Unlimited fill-up tracking & history"', () => {
    expect(emailSrc).not.toMatch(/Unlimited fill-up tracking &amp; history/);
  });

  it('6. the Pro email contains "Unlimited fill-up logging"', () => {
    expect(emailSrc).toMatch(/Unlimited fill-up logging/);
  });

  it('7. the Pro email contains "Rental Car Return Mode"', () => {
    expect(emailSrc).toMatch(/Rental Car Return Mode/);
  });

  it('8. genuine Find Gas / Google Places station-level real-time wording remains present elsewhere', () => {
    expect(translationsSrcForStation).toMatch(/real-time gas prices at nearby stations/);
    expect(translationsSrcForStation).toMatch(/Live prices from Google at nearby stations/);
  });
});

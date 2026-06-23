/**
 * Generate data/gas-prices-seed.json — a committed snapshot of regular-unleaded
 * prices for all 50 states + DC, used as the INSTANT cold-start value by
 * /api/gas-price (so the lookup never blocks on a live EIA call → no more spinner).
 *
 * EIA's free weekly retail gasoline series (petroleum/pri/gnd, product EPMR) only
 * covers ~9 states directly + the PADD regions + national. So each state resolves
 * to: its own state series if EIA has it → else its PADD region → else national.
 *
 * Run once (and periodically to refresh the snapshot):
 *   npx node -r dotenv/config scripts/generate-gas-price-seed.mjs dotenv_config_path=.env.local
 */

import { writeFileSync } from 'node:fs';

const KEY = process.env.EIA_API_KEY;
if (!KEY) { console.error('EIA_API_KEY missing'); process.exit(1); }

// Each state → ordered EIA duoarea codes to try (state series, then PADD region, then national).
const REGION = {
  R1X: ['CT','ME','MA','NH','RI','VT'],                                  // PADD 1A New England
  R1Y: ['DE','DC','MD','NJ','NY','PA'],                                  // PADD 1B Central Atlantic
  R1Z: ['FL','GA','NC','SC','VA','WV'],                                  // PADD 1C Lower Atlantic
  R20: ['IL','IN','IA','KS','KY','MI','MN','MO','NE','ND','OH','OK','SD','TN','WI'], // PADD 2 Midwest
  R30: ['AL','AR','LA','MS','NM','TX'],                                  // PADD 3 Gulf Coast
  R40: ['CO','ID','MT','UT','WY'],                                       // PADD 4 Rocky Mountain
  R50: ['AK','AZ','CA','HI','NV','OR','WA'],                             // PADD 5 West Coast
};
const DIRECT = new Set(['CA','CO','FL','MA','MN','NY','OH','TX','WA']);  // states EIA publishes directly

const STATE_DUOAREAS = {};
for (const [region, states] of Object.entries(REGION)) {
  for (const st of states) {
    STATE_DUOAREAS[st] = [...(DIRECT.has(st) ? [`S${st}`] : []), region, 'NUS'];
  }
}

async function fetchEia(duoarea) {
  const url =
    `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${KEY}` +
    `&frequency=weekly&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=1` +
    `&facets[duoarea][]=${duoarea}&facets[product][]=EPMR`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const v = parseFloat(String(json?.response?.data?.[0]?.value ?? ''));
    return isNaN(v) ? null : Math.round(v * 1000) / 1000;
  } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const national = await fetchEia('NUS');
console.log('national:', national);

const states = {};
for (const [st, tries] of Object.entries(STATE_DUOAREAS)) {
  let price = null;
  for (const d of tries) {
    price = await fetchEia(d);
    await sleep(150); // be gentle with EIA
    if (price) break;
  }
  states[st] = price ?? national ?? 3.15;
  console.log(`${st}: ${states[st]}`);
}

const out = { updatedAt: new Date().toISOString().slice(0, 10), national: national ?? 3.15, states };
writeFileSync(new URL('../data/gas-prices-seed.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`\n✓ Wrote data/gas-prices-seed.json (${Object.keys(states).length} states)`);

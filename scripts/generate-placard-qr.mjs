/**
 * generate-placard-qr.mjs
 *
 * Generates two QR code PNG files for every placard code in the
 * tent-card-placement-tracker.csv:
 *
 *   FRONT QR  →  https://gascap.app/q/<code>          (customer-facing, tracks sign-ups)
 *   BACK  QR  →  <GHL_FORM_URL>?placardCode=<code>    (field rep reporting form)
 *
 * Also assigns a headline variant (A / B / C) to each code for A/B testing,
 * and updates the CSV with the assigned variant in the "Notes" column.
 *
 * OUTPUT STRUCTURE:
 *   scripts/placard-qr/
 *     GC-ORGFL-D1.01-1001/
 *       front.png    ← print on the customer-facing side of the placard
 *       back.png     ← print small on the field-rep side (label: "Scan to report")
 *     GC-ORGFL-D1.01-1002/
 *       ...
 *
 * USAGE:
 *   node scripts/generate-placard-qr.mjs
 *
 * BEFORE RUNNING:
 *   1. Build and publish your GHL form.
 *   2. Copy the form's public URL and paste it into GHL_FORM_URL below.
 *   3. Run the script — all QR images land in scripts/placard-qr/.
 *   4. Hand the folder to your print designer.
 *      The designer places front.png on the front and back.png on the back.
 *
 * RE-RUNNING:
 *   Safe to re-run at any time. Existing files are overwritten.
 *   To add more codes later, just add rows to the CSV and re-run —
 *   only the new codes generate new folders (existing ones are skipped
 *   if SKIP_EXISTING = true below).
 */

import QRCode   from 'qrcode';
import fs       from 'fs';
import path     from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { fileURLToPath } from 'url';

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * !! REPLACE THIS before running !!
 * Paste the public URL of your GHL "Pilot Partner Placement Report" form here.
 * Example: 'https://api.leadconnectorhq.com/widget/form/abc123xyz'
 */
const GHL_FORM_URL = 'PASTE_YOUR_GHL_FORM_URL_HERE';

/** Base URL for customer-facing QR codes */
const APP_BASE_URL = 'https://gascap.app/q';

/** Skip codes that already have a QR folder (set false to force regenerate all) */
const SKIP_EXISTING = false;

/** Headline variants for A/B testing — distributed evenly across all codes */
const HEADLINE_VARIANTS = [
  { id: 'A', headline: 'Know Before You Fill Up'  },
  { id: 'B', headline: "Don't Guess at the Pump"  },
  { id: 'C', headline: 'Stretch Your Gas Budget'  },
];

/** QR code visual style — matches GasCap™ brand colors */
const QR_OPTIONS_FRONT = {
  errorCorrectionLevel: 'H',          // High — survives minor scuffs on a placard
  width:                400,          // px — scale up for print quality
  margin:               2,
  color: {
    dark:  '#005F4A',                 // brand-dark green
    light: '#FFFFFF',
  },
};

const QR_OPTIONS_BACK = {
  errorCorrectionLevel: 'M',
  width:                300,          // smaller — it's a utility QR, not the hero
  margin:               2,
  color: {
    dark:  '#1E2D4A',                 // navy — subdued, it's on the back
    light: '#FFFFFF',
  },
};

// ── Paths ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH  = path.resolve(__dirname, '../docs/tent-card-placement-tracker.csv');
const OUT_DIR   = path.resolve(__dirname, 'placard-qr');

// ── Helpers ───────────────────────────────────────────────────────────────────

function assignVariant(index) {
  return HEADLINE_VARIANTS[index % HEADLINE_VARIANTS.length];
}

async function generateQR(url, outPath, options) {
  await QRCode.toFile(outPath, url, options);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Validate GHL form URL
  if (GHL_FORM_URL === 'PASTE_YOUR_GHL_FORM_URL_HERE') {
    console.error('\n⚠️  GHL_FORM_URL is not set.');
    console.error('   Open this script, paste your GHL form URL into GHL_FORM_URL, then re-run.\n');
    process.exit(1);
  }

  // Read CSV
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`\n⚠️  CSV not found at: ${CSV_PATH}\n`);
    process.exit(1);
  }

  const raw     = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });

  // Create output directory
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`\n🖨️  GasCap™ Placard QR Generator`);
  console.log(`   Codes found: ${records.length}`);
  console.log(`   Output:      ${OUT_DIR}\n`);

  let generated = 0;
  let skipped   = 0;

  for (let i = 0; i < records.length; i++) {
    const row     = records[i];
    const code    = (row['Code'] ?? '').trim();
    if (!code) continue;

    const codeDir = path.join(OUT_DIR, code);

    // Skip if folder already exists and SKIP_EXISTING is on
    if (SKIP_EXISTING && fs.existsSync(codeDir)) {
      skipped++;
      continue;
    }

    fs.mkdirSync(codeDir, { recursive: true });

    // Assign headline variant
    const variant   = assignVariant(i);
    const frontUrl  = `${APP_BASE_URL}/${code}`;
    const backUrl   = `${GHL_FORM_URL}?placardCode=${encodeURIComponent(code)}`;

    // Generate both QR codes
    await generateQR(frontUrl, path.join(codeDir, 'front.png'), QR_OPTIONS_FRONT);
    await generateQR(backUrl,  path.join(codeDir, 'back.png'),  QR_OPTIONS_BACK);

    // Update the record with variant info for the CSV
    records[i]['Notes'] = `Headline: ${variant.id} — "${variant.headline}"`;

    generated++;
    console.log(`  ✅  ${code}  →  Variant ${variant.id}: "${variant.headline}"`);
  }

  // Write updated CSV back with variant assignments in Notes column
  const updatedCsv = stringify(records, { header: true });
  fs.writeFileSync(CSV_PATH, updatedCsv, 'utf8');

  console.log(`\n✔  Done.`);
  console.log(`   Generated: ${generated} placards`);
  if (skipped) console.log(`   Skipped:   ${skipped} (already existed)`);
  console.log(`   CSV updated with headline variant assignments.`);
  console.log(`\n📁  Hand the folder to your print designer:`);
  console.log(`     ${OUT_DIR}`);
  console.log(`\n   Each code folder contains:`);
  console.log(`     front.png  — Customer QR (dark green, 400px) — hero of the placard front`);
  console.log(`     back.png   — Field Rep QR (navy, 300px)       — "Scan to report placement"\n`);

  // Print variant summary for the designer brief
  console.log('📋  Headline variant distribution:');
  for (const v of HEADLINE_VARIANTS) {
    const count = records.filter((_, i) => assignVariant(i).id === v.id).length;
    console.log(`     Variant ${v.id} (${count} cards): "${v.headline}"`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('\n❌  Error:', err.message);
  process.exit(1);
});

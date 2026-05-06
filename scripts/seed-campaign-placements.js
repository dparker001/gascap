#!/usr/bin/env node
/**
 * One-time seed: migrate campaign-placements.json → CampaignPlacement table.
 * Run with: node scripts/seed-campaign-placements.js
 */
const fs   = require('fs');
const path = require('path');
const { Client } = require('pg');

// Load DATABASE_URL from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
    if (m) process.env[m[1]] = m[2];
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

async function main() {
  const filePath = path.join(__dirname, '..', 'data', 'campaign-placements.json');
  const placements = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`Seeding ${placements.length} placements into CampaignPlacement table...`);

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  let upserted = 0;
  for (const p of placements) {
    await client.query(`
      INSERT INTO "CampaignPlacement"
        (id, code, campaign, station, address, city, "contactName", "contactEmail", "contactPhone",
         placement, "headlineVariant", "landingPath", notes, "createdAt", active, featured)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (id) DO UPDATE SET
        campaign        = EXCLUDED.campaign,
        station         = EXCLUDED.station,
        address         = EXCLUDED.address,
        city            = EXCLUDED.city,
        "contactName"   = EXCLUDED."contactName",
        "contactEmail"  = EXCLUDED."contactEmail",
        "contactPhone"  = EXCLUDED."contactPhone",
        placement       = EXCLUDED.placement,
        "headlineVariant" = EXCLUDED."headlineVariant",
        "landingPath"   = EXCLUDED."landingPath",
        notes           = EXCLUDED.notes,
        active          = EXCLUDED.active,
        featured        = EXCLUDED.featured
    `, [
      p.id,
      p.code,
      p.campaign,
      p.station   || '',
      p.address   || null,
      p.city      || null,
      p.contactName   || null,
      p.contactEmail  || null,
      p.contactPhone  || null,
      p.placement,
      p.headlineVariant,
      p.landingPath,
      p.notes     || null,
      p.createdAt,
      p.active,
      p.featured  ?? false,
    ]);
    upserted++;
    process.stdout.write(`\r  ${upserted}/${placements.length}`);
  }

  await client.end();
  console.log(`\nDone — ${upserted} placements seeded.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

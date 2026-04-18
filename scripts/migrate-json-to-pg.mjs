/**
 * One-time migration: import data/users.json + data/vehicles.json into PostgreSQL.
 * Run with: node scripts/migrate-json-to-pg.mjs
 * Requires DATABASE_URL to be set (reads from .env via dotenv).
 */
import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────────────
function readJson(file) {
  const p = resolve(root, 'data', file);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ── Connect to Postgres ───────────────────────────────────────────────────────
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    // ── Users ────────────────────────────────────────────────────────────────
    const users = readJson('users.json');
    console.log(`Migrating ${users.length} user(s)...`);
    let upserted = 0;

    for (const u of users) {
      await client.query(`
        INSERT INTO "User" (
          id, email, name, "passwordHash", plan, "createdAt",
          "stripeCustomerId", "stripeSubscriptionId",
          "calcCount", "budgetCalcCount", "locationLookups",
          "activeDays", streak, badges,
          "referralCode", "referredBy", "referralCount",
          "referralProMonthsEarned", "referralRewardCredited", "referralCredits",
          "isBetaTester", "isProTrial", "betaProExpiry",
          "emailVerified", "emailVerifyToken", "emailVerifyExpires",
          "passwordResetToken", "passwordResetExpires",
          phone, "displayName",
          "priceAlertThreshold", "lastPriceAlertSentAt",
          "loginCount", "lastLoginAt",
          "fillupReminderDays", "lastFillupReminderSentAt",
          "streakMilestonesHit", "streakCredits",
          locale, "emailCampaignStep", "emailCampaignEnrolledAt",
          "emailOptOut", "isTestAccount"
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,
          $9,$10,$11,
          $12,$13,$14,
          $15,$16,$17,
          $18,$19,$20,
          $21,$22,$23,
          $24,$25,$26,
          $27,$28,
          $29,$30,
          $31,$32,
          $33,$34,
          $35,$36,
          $37,$38,
          $39,$40,$41,
          $42,$43
        )
        ON CONFLICT (id) DO UPDATE SET
          email                    = EXCLUDED.email,
          name                     = EXCLUDED.name,
          "passwordHash"           = EXCLUDED."passwordHash",
          plan                     = EXCLUDED.plan,
          "stripeCustomerId"       = EXCLUDED."stripeCustomerId",
          "calcCount"              = EXCLUDED."calcCount",
          "activeDays"             = EXCLUDED."activeDays",
          streak                   = EXCLUDED.streak,
          badges                   = EXCLUDED.badges,
          "referralCode"           = EXCLUDED."referralCode",
          "loginCount"             = EXCLUDED."loginCount",
          "lastLoginAt"            = EXCLUDED."lastLoginAt",
          "emailVerified"          = EXCLUDED."emailVerified"
      `, [
        u.id,                                              // $1
        u.email,                                           // $2
        u.name,                                            // $3
        u.passwordHash,                                    // $4
        u.plan ?? 'free',                                  // $5
        u.createdAt,                                       // $6
        u.stripeCustomerId     ?? null,                    // $7
        u.stripeSubscriptionId ?? null,                    // $8
        u.calcCount            ?? 0,                       // $9
        u.budgetCalcCount      ?? 0,                       // $10
        u.locationLookups      ?? 0,                       // $11
        u.activeDays           ?? [],                      // $12
        u.streak               ?? 0,                       // $13
        u.badges               ?? [],                      // $14
        u.referralCode         ?? null,                    // $15
        u.referredBy           ?? null,                    // $16
        u.referralCount        ?? 0,                       // $17
        u.referralProMonthsEarned ?? 0,                    // $18
        u.referralRewardCredited  ?? false,                // $19
        JSON.stringify(u.referralCredits ?? []),           // $20
        u.isBetaTester         ?? false,                   // $21
        u.isProTrial           ?? false,                   // $22
        u.betaProExpiry        ?? null,                    // $23
        u.emailVerified        ?? false,                   // $24
        u.emailVerifyToken     ?? null,                    // $25
        u.emailVerifyExpires   ?? null,                    // $26
        u.passwordResetToken   ?? null,                    // $27
        u.passwordResetExpires ?? null,                    // $28
        u.phone                ?? null,                    // $29
        u.displayName          ?? null,                    // $30
        u.priceAlertThreshold  ?? null,                    // $31
        u.lastPriceAlertSentAt ?? null,                    // $32
        u.loginCount           ?? 0,                       // $33
        u.lastLoginAt          ?? null,                    // $34
        u.fillupReminderDays   ?? null,                    // $35
        u.lastFillupReminderSentAt ?? null,                // $36
        u.streakMilestonesHit  ?? [],                      // $37
        JSON.stringify(u.streakCredits ?? []),             // $38
        u.locale               ?? null,                    // $39
        u.emailCampaignStep    ?? null,                    // $40
        u.emailCampaignEnrolledAt ?? null,                 // $41
        u.emailOptOut          ?? false,                   // $42
        u.isTestAccount        ?? false,                   // $43
      ]);
      console.log(`  ✓ ${u.email} (${u.plan})`);
      upserted++;
    }
    console.log(`  → ${upserted} user(s) upserted.\n`);

    // ── Vehicles ─────────────────────────────────────────────────────────────
    const vehicles = readJson('vehicles.json');
    console.log(`Migrating ${vehicles.length} vehicle(s)...`);
    let vu = 0;

    for (const v of vehicles) {
      // Only insert if the owning user exists
      const { rows } = await client.query(`SELECT id FROM "User" WHERE id=$1`, [v.userId]);
      if (!rows.length) {
        console.log(`  ⚠ Skipping vehicle "${v.name}" — userId ${v.userId} not found`);
        continue;
      }
      await client.query(`
        INSERT INTO "Vehicle" (
          id, "userId", name, gallons, vin, year, make, model,
          trim, "fuelType", "epaId", "currentOdometer", "vehicleSpecs", "createdAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO UPDATE SET
          name            = EXCLUDED.name,
          gallons         = EXCLUDED.gallons,
          "currentOdometer" = EXCLUDED."currentOdometer"
      `, [
        v.id, v.userId, v.name, v.gallons,
        v.vin ?? null, v.year ?? null, v.make ?? null, v.model ?? null,
        v.trim ?? null, v.fuelType ?? null, v.epaId ?? null,
        v.currentOdometer ?? null,
        v.vehicleSpecs ? JSON.stringify(v.vehicleSpecs) : null,
        v.createdAt,
      ]);
      console.log(`  ✓ ${v.name} (owner: ${v.userId.slice(0,8)}…)`);
      vu++;
    }
    console.log(`  → ${vu} vehicle(s) upserted.\n`);

    console.log('Migration complete ✓');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error('Migration failed:', err); process.exit(1); });

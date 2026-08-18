# Scripts inventory and cleanup plan

**Status: CURRENT (partially executed).** Hardening sprint 1, 2026-08-18.

Sprint 1 moved only what was provably safe. The rest is classified here for a
future sprint, per the brief's instruction not to delete blindly.

---

## Done this sprint

Six root-level scripts moved to **`scripts/diagnostics/`**:

`check_bonus.ts` · `check_bonus2.ts` · `check_engagement.ts` ·
`check_stripe.ts` · `check_trial_expiry.ts` · `check_users2.ts`

Safe because each was verified to be:

- **read-only** — no `UPDATE` / `INSERT` / `DELETE` / `.update(` / `.create(`
- **unreferenced** — zero imports from any `.ts`, `.tsx`, `.json` or `.yml`
- **not wired** to `package.json` scripts or any GitHub workflow

`tsc --noEmit` and `npm run build` pass after the move. A `README.md` in that
directory records what each answered and how to run them.

## Classification of `scripts/` (not moved — proposal only)

| Script | Class | Notes |
|---|---|---|
| `check-cron-inventory.mjs` | **ACTIVE MAINTENANCE** | Wired into CI and `npm run check:crons`. **Do not move** without updating both. |
| `test-ambassador-tiers.mjs` | ACTIVE MAINTENANCE | `npm run test:tiers`. Same caution. |
| `generate-icons.mjs`, `generate-capacitor-assets.mjs`, `gen-feature-graphic.mjs`, `generate-store-screenshots*.mjs`, `generate-placard-qr.mjs` | ACTIVE MAINTENANCE (build/asset) | Regenerate store and app assets. Keep; propose `scripts/assets/`. |
| `generate-gas-price-seed.mjs` | ACTIVE MAINTENANCE | Produces `data/gas-prices-seed.json`, which the build imports. Keep. |
| `preview-welcome-email.mjs` | DIAGNOSTIC | Local email render preview. |
| `get-referral.ts`, `query_trials.ts` | DIAGNOSTIC | Read-only lookups. Candidates for `scripts/diagnostics/`. |
| `migrate-json-to-pg.mjs` | **ONE-TIME MIGRATION (spent)** | The JSON→Postgres migration this repo has already completed. **Historically important — do not delete.** Move to `scripts/one-time/` and mark spent. |
| `add-otp-columns.cjs` / `.mjs` | ONE-TIME MIGRATION (spent) | Duplicate implementations of the same migration. Consolidate to one, retain as history. |
| `create-review-table.mjs` | ONE-TIME MIGRATION (spent) | `Review` model now in `schema.prisma`. |
| `migrate-smartcar.sql`, `migrate-smartcar-v3.sql` | **UNKNOWN** | No Smartcar integration is present in the current codebase. Either abandoned work or a removed feature. **Do not delete until confirmed** — they may document a schema change that was applied. |
| `seed-campaign-placements.js` | UNKNOWN | Lone `.js` among `.mjs`/`.ts`. Verify whether `CampaignPlacement` still needs seeding. |
| `send-d1-catchup.ts`, `send-deletion-email.ts`, `send-early-upgrade-offer.ts` | **ONE-TIME (WRITES / SENDS EMAIL)** | These contact real customers. Highest-risk items in the tree: running one by accident emails users. Move to `scripts/one-time/`, add a `--confirm` guard, and state the blast radius in a header. |

## Proposed target layout

```
scripts/
  assets/        # icon, screenshot, QR generation
  diagnostics/   # read-only queries          ← created this sprint
  maintenance/   # recurring, wired to npm/CI
  one-time/      # spent migrations and one-off sends (retained as history)
```

## Recommendation for Sprint 2

Priority order, highest value first:

1. **`send-*.ts` scripts** — they send email to real users from the repository
   root with no guard rail. Add confirmation flags and move them. This is the
   only item here with a genuine accident cost.
2. **Resolve the two UNKNOWNs** (`migrate-smartcar*.sql`,
   `seed-campaign-placements.js`) before any further tidying.
3. Move spent migrations to `one-time/`, keeping them.
4. Move the remaining asset/diagnostic scripts.

**Do not move `check-cron-inventory.mjs` or `test-ambassador-tiers.mjs`
without updating `package.json` and `.github/workflows/ci.yml` in the same
commit** — CI runs the first one on every pull request.

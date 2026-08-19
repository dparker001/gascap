# Sprint 2 Production Preflight Packet

**Purpose:** REVIEW/PREFLIGHT ONLY. No production action was taken to
produce this document — every SQL statement, command, and Railway variable
listed below is PROPOSED, not executed. This packet is written so an
independent reviewer (ChatGPT) can perform a final production-readiness
review of Hardening Sprint 2 without reconstructing the sprint from commit
history.

---

## 1. Current Branch / Commit State

- **`hardening/sprint-2` HEAD:** `e07bd0865388534903b7fb54c6c746ab6697782c`
- **`main` HEAD (origin, just fetched):** `3ff64267d69e3e6d0a4a155fd6ea8792be183943`
- **Merge-base** (where `hardening/sprint-2` diverged from `main`): `39de76a40b227ec97799f196deddbaffd1a3fcaa`
- **Commits added since the merge-base (28 total, oldest first):**

  ```
  fccdd57 feat(P0): admin authentication migration — session+role, dual-auth staged
  ff2c766 feat(P0): RevenueCat idempotency + multi-provider entitlement reconciliation
  fbb80f1 feat(P1): RevenueCat HMAC verification — additive, off by default
  2441fdf feat(P1): PostgreSQL-backed rate limiting; close the password-reset gap
  7f64bf9 chore(P1): remove dead push-subscription file store
  d6ceba7 feat(P1): admin audit logging on the highest-risk mutations
  0f3b0cf feat(P1): AMOE entries — staged Postgres migration (dual-write + backfill)
  87adb0e feat(P1): read-only RevenueCat webhook observability endpoint
  8712665 docs: reconcile README/SYSTEM/SECURITY_AUDIT/ADMIN_AUTH_MIGRATION with Sprint 2
  6f77811 docs: add ChatGPT review packet for Hardening Sprint 2
  b096ec2 fix(P0/P1): ChatGPT Revision 1 findings — entitlement provenance, RC atomicity, HMAC, admin auth coverage, rate-limit races, AMOE reconciliation
  78d3c14 fix(rewards): disclose Dining Voucher activation fee, correct no-cost claim
  a6773de docs: add Revision 2 ChatGPT review packet for Hardening Sprint 2
  de3b2eb Revert "fix(rewards): disclose Dining Voucher activation fee, correct no-cost claim"
  00dedd6 fix(P0/P1): ChatGPT Revision 2 findings — historical RC reconciliation, provider-neutral Lifetime semantics, corrected RC event model, claim/AMOE fixes
  b6d2a77 docs: add Revision 3 ChatGPT review packet for Hardening Sprint 2
  dfda822 fix(P0): ChatGPT Revision 3 findings — v2 read-only RC lookup, unconditional multi-source reconciliation, TRANSFER/CUSTOMER_SUPPORT authoritative resync
  5d0f87e docs: add Revision 4 ChatGPT review packet for Hardening Sprint 2
  2af0f47 fix(P0): ChatGPT Revision 4 findings — correct RevenueCat v2 contract, production-only state, field-specific contamination logic, atomic apply + reportHash binding
  9726360 docs: add Revision 5 ChatGPT review packet for Hardening Sprint 2
  70a2305 fix(P0): ChatGPT Revision 5 findings — provider-realistic RevenueCat shapes, guest-checkout-safe Stripe evidence, optimistic concurrency apply
  24d55ce docs: add Revision 6 ChatGPT review packet for Hardening Sprint 2
  9f55b96 fix(P0): ChatGPT Revision 6 findings — de-scope automatic stripeInterval clear, correct alias endpoint, exclude trial from plan repair
  20bf60d docs: add Revision 7 ChatGPT review packet for Hardening Sprint 2
  a7e67d1 fix(P0): ChatGPT Revision 7 pre-smoke patch — ambiguous alias throws, suspected_legacy_rc_contamination rename, sanitize smoke-test identifiers, standing provider-contract rule
  881d9e6 feat: add --environment flag to RevenueCat smoke-test script for sandbox positive-path testing
  464e1ea fix(iOS): Pro trial users on Settings→Plan no longer see paid-Pro Apple-manage text
  e07bd08 feat: add --subscription-path diagnostic flag to RevenueCat smoke-test script
  ```

  (`de3b2eb` reverts `78d3c14` — an unrelated rewards-copy commit that landed
  on this branch by accident; it was cherry-picked to its own branch
  `fix/rewards-dining-voucher-fee-disclosure` for separate review and
  reverted here via `git revert`, not history rewrite.)

- **Confirmation no Sprint 2 production deploy has occurred:** `main`'s
  HEAD (`3ff6426`) has zero commits from this list. `hardening/sprint-2`
  has never been merged, no PR has been opened, and per `/CLAUDE.md`,
  "Production follows `main`" — production is running whatever `main`
  currently contains, which predates every Sprint 2 change. No RevenueCat
  v2 credentials, HMAC secret, or admin-role backfill have been applied
  anywhere in this process — every credential-touching step in this sprint
  (smoke tests) ran read-only against RevenueCat directly, not through
  GasCap's production database or deployed app.

---

## 2. Database Schema Changes

Full diff: `git diff 39de76a...HEAD -- prisma/schema.prisma` (verified
against the actual file, not assumed from memory).

### 2a. `User` table — 5 new columns

| Column | Type | Nullable | Default | Why |
|---|---|---|---|---|
| `role` | `TEXT` | NOT NULL | `'user'` | Server-resolved admin authorization (`lib/adminAuth.ts`) — replaces trusting a client-supplied claim. |
| `revenueCatActive` | `BOOLEAN` | NOT NULL | `false` | RevenueCat's own contribution to Pro access, tracked separately from `stripeInterval` so an RC-side event can never wipe a Stripe/gift/Ambassador grant (`lib/entitlements.ts`). |
| `revenueCatInterval` | `TEXT` | nullable | `NULL` | `'monthly'` \| `'lifetime'` — RC-sourced interval, never written from any other provider. |
| `revenueCatProductId` | `TEXT` | nullable | `NULL` | Store-facing product identifier (e.g. `gascap_pro_monthly`) from the RC grant. |
| `getawayChooseEmailSentAt` | `TEXT` | nullable | `NULL` | Durable one-time marker preventing a duplicate getaway-fulfillment email if a crash occurs between sending it and marking the triggering webhook event processed. |

All five are **backward compatible and non-breaking**: `role` gets a real
default value written to every existing row (`'user'` — see the important
nuance in §2c below), the three RevenueCat columns default to inert/false
values matching current behavior for every existing user (no history is
backfilled — RevenueCat activity wasn't tracked before this shipped), and
`getawayChooseEmailSentAt` is purely additive with no default-value
behavior change at all.

### 2b. Four new tables (no existing table altered)

**`RateLimitCounter`** — Postgres-backed rate limiting (replaces/augments
the in-memory limiter for password-reset and OTP-send specifically; the
in-memory limiter is NOT removed, just not the sole mechanism anymore).
```
key       TEXT PRIMARY KEY   -- caller-defined, e.g. "otp-verify:<sha256(email)>"
count     INTEGER NOT NULL DEFAULT 0
resetAt   TIMESTAMP(3) NOT NULL
INDEX (resetAt)
```

**`RevenueCatWebhookEvent`** — idempotency/dedup for at-least-once webhook
delivery, plus the compare-and-swap `claimToken` that makes concurrent
reclaim of a stale/failed row safe.
```
id          TEXT PRIMARY KEY   -- RevenueCat's own event.id
eventType   TEXT NOT NULL
userId      TEXT
status      TEXT NOT NULL DEFAULT 'received'   -- received|processing|processed|failed
claimToken  TEXT
receivedAt  TEXT NOT NULL
processedAt TEXT
error       TEXT
INDEX (userId)
```

**`AdminAuditLog`** — who did what, for the highest-risk admin mutations.
```
id          TEXT PRIMARY KEY
actorUserId TEXT NOT NULL
action      TEXT NOT NULL
targetType  TEXT
targetId    TEXT
metadata    JSONB
success     BOOLEAN NOT NULL
createdAt   TEXT NOT NULL
INDEX (actorUserId)
INDEX (createdAt)
```

**`AmoeEntry`** — sweepstakes free-entry (AMOE) records, migration target
off `data/amoe-entries.json` (see §7 and §9 for current dual-write status —
**the file remains authoritative today; this table is a mirror only**).
```
id          TEXT PRIMARY KEY
firstName   TEXT NOT NULL
lastName    TEXT NOT NULL
email       TEXT NOT NULL
month       TEXT NOT NULL           -- YYYY-MM
submittedAt TEXT NOT NULL
UNIQUE (email, month)
INDEX (month)
```

### 2c. Why each change is required

- `role`: required before `lib/adminAuth.ts`'s session-based admin check
  can resolve anything — without it, `requireAdmin()`'s session path
  always falls through to the legacy password.
- `revenueCatActive`/`revenueCatInterval`/`revenueCatProductId`: required
  by the entire multi-provider entitlement resolver
  (`lib/entitlements.ts`) and every RevenueCat sync path
  (`lib/revenueCatApi.ts`, `lib/users.ts`'s
  `syncRevenueCatEntitlementFromProvider`, the historical reconciliation
  tool) — without these columns, none of that code can run at all (Prisma
  would reject any read/write referencing them).
- `getawayChooseEmailSentAt`: required by `maybeSendGetaway()` in
  `app/api/native/revenuecat/route.ts` to make the duplicate-send
  protection durable across a crash/retry, not just in-memory.
- `RateLimitCounter`: required by `lib/rateLimitDb.ts`, applied to
  password-reset (previously had **no** rate limiting at all — found
  during this sprint's audit) and OTP-send.
- `RevenueCatWebhookEvent`: required for the entire idempotency guarantee
  on the RevenueCat webhook — without it, a retried delivery has no way to
  detect "already processed" and could double-apply a grant/revoke.
- `AdminAuditLog`: required by `lib/adminAudit.ts`, wired to the
  highest-risk admin mutations (user delete/plan-change/comp-grant/
  comp-revoke, sweepstakes draw runs, AMOE backfill).
- `AmoeEntry`: required for the AMOE dual-write mirror and its
  reconciliation backfill (`app/api/admin/amoe-backfill/route.ts`).

### 2d. Nullable / backward-compatible?

**Yes, every single change is additive.** No column is dropped, renamed,
or has its type changed on an existing column. No existing table is
altered. `role`'s `NOT NULL DEFAULT 'user'` is the only column that writes
a real (non-null) value to every existing row — every other new column is
either nullable or defaults to a value that reproduces current behavior
exactly (`revenueCatActive DEFAULT false`, `RateLimitCounter`/
`RevenueCatWebhookEvent`/`AdminAuditLog`/`AmoeEntry` are entirely new
tables with no existing rows to affect).

**Important nuance already documented in the migration file itself**
(`docs/migrations/2026-08-sprint2-schema.sql`, corrected on review): saying
"no existing row changes value" for the `role` column is not quite
accurate. `ADD COLUMN role TEXT NOT NULL DEFAULT 'user'` **does** write a
real value (`'user'`) to every existing row — the column didn't exist
before, so every row moves from "no role column at all" to "role = user."
What's true and load-bearing is narrower: **no row's effective application
behavior changes**, because every pre-migration user was already being
treated as a non-admin everywhere role is checked today. The distinction
matters for anyone reasoning about migration risk from "value changed"
alone rather than "behavior changed."

### 2e. Locking / risky operations

- **`ALTER TABLE "User" ADD COLUMN`** (×5): Postgres can add a column with
  a constant default without a full-table rewrite in modern versions
  (11+) for columns with a fixed default — this is a fast, effectively
  metadata-only operation, not a risk that scales with `User` table size.
  This has NOT been independently confirmed against GasCap's actual
  Postgres version/Railway configuration in this environment — flagged as
  an open item in §13.
- **`CREATE TABLE IF NOT EXISTS`** (×4): no lock risk — creating a new,
  empty table takes at most a brief catalog lock, not a table-level lock
  on any existing data.
- **`CREATE INDEX`** (not `CREATE INDEX CONCURRENTLY`): all five new
  indexes are on brand-new, empty tables at migration time, so this is
  not the "locking index build on a huge live table" risk `CONCURRENTLY`
  exists to solve — building an index on zero rows is instantaneous.
- **No `DROP`, `TRUNCATE`, `RENAME`, or data-mutating `UPDATE`** appears in
  the proposed schema SQL at all (the one `UPDATE` in the file — Don's
  admin-role backfill — is a separate, explicitly commented-out, one-row,
  identity-confirmed statement; see §2f).

### 2f. What's already present in production vs. what must still be added

**Already present in production (unaffected by this sprint):** every
column/table that existed before the merge-base — the entire rest of the
`User` model, `Vehicle`, `OtpCode`, and all other existing models. RevenueCat
webhook handling itself (`app/api/native/revenuecat/route.ts`) already
exists and is live on `main` (verified: `git show 39de76a:app/api/native/revenuecat/route.ts`
succeeds), meaning `REVENUECAT_WEBHOOK_AUTH` is presumably **already
configured** in production Railway (the route fails closed without it, and
it's evidently working today per native IAP being shipped).

**Must still be added — nothing from this list exists in production
today:** all 5 new `User` columns, all 4 new tables, and all Sprint 2
application code that depends on them (none of which can run against
production until the schema exists).

### 2g. Exact proposed SQL — NOT EXECUTED

The full, exact proposed migration is `docs/migrations/2026-08-sprint2-schema.sql`
in this repository, reproduced here verbatim for the reviewer's
convenience. **This has not been run against any database in preparing
this packet.**

```sql
-- ── User: admin role ────────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'user';

-- ── User: RevenueCat entitlement provenance ─────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "revenueCatActive"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "revenueCatInterval"  TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "revenueCatProductId" TEXT;

-- ── User: durable one-time getaway-choose-email marker ──────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "getawayChooseEmailSentAt" TEXT;

-- ── Postgres-backed rate limiting ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RateLimitCounter" (
  "key"     TEXT PRIMARY KEY,
  "count"   INTEGER NOT NULL DEFAULT 0,
  "resetAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "RateLimitCounter_resetAt_idx" ON "RateLimitCounter"("resetAt");

-- ── RevenueCat webhook idempotency ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RevenueCatWebhookEvent" (
  "id"          TEXT PRIMARY KEY,
  "eventType"   TEXT NOT NULL,
  "userId"      TEXT,
  "status"      TEXT NOT NULL DEFAULT 'received',
  "claimToken"  TEXT,
  "receivedAt"  TEXT NOT NULL,
  "processedAt" TEXT,
  "error"       TEXT
);
CREATE INDEX IF NOT EXISTS "RevenueCatWebhookEvent_userId_idx" ON "RevenueCatWebhookEvent"("userId");

-- ── Admin audit log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
  "id"          TEXT PRIMARY KEY,
  "actorUserId" TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "targetType"  TEXT,
  "targetId"    TEXT,
  "metadata"    JSONB,
  "success"     BOOLEAN NOT NULL,
  "createdAt"   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "AdminAuditLog_actorUserId_idx" ON "AdminAuditLog"("actorUserId");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx"   ON "AdminAuditLog"("createdAt");

-- ── AMOE entries (dual-write mirror; file remains authoritative) ───────────
CREATE TABLE IF NOT EXISTS "AmoeEntry" (
  "id"          TEXT PRIMARY KEY,
  "firstName"   TEXT NOT NULL,
  "lastName"    TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "month"       TEXT NOT NULL,
  "submittedAt" TEXT NOT NULL,
  CONSTRAINT "AmoeEntry_email_month_key" UNIQUE ("email", "month")
);
CREATE INDEX IF NOT EXISTS "AmoeEntry_month_idx" ON "AmoeEntry"("month");
```

**Separate, explicitly NOT part of the above, requiring its own approval
after the above is confirmed applied** (also not executed):
```sql
UPDATE "User" SET role = 'admin' WHERE email = 'dparker001@gmail.com';
```

---

## 3. Migration Safety / Ordering

### Required order

1. Apply all `ALTER TABLE`/`CREATE TABLE` statements in §2g together, in
   any order relative to each other (no statement depends on another —
   they touch disjoint columns/tables). A single transaction is fine
   given the operations are all fast/metadata-level per §2e.
2. Run the verification queries (below) to confirm the schema applied as
   expected.
3. **Only after 1–2 are confirmed:** apply the Don admin-role `UPDATE`
   separately, then verify it independently (exactly 1 row with
   `role='admin'`).
4. Deploy Sprint 2 application code (merge to `main`) — see §11 for where
   this sits relative to the schema step.
5. Configure new Railway environment variables (§4) — some can happen
   before the deploy, some are only needed for optional features (HMAC)
   and can wait indefinitely.

### Application compatibility before/after each step

- **Before schema applied, before deploy (current production state):**
  fully compatible — production code has never referenced any of these
  columns/tables.
- **After schema applied, before deploy:** still fully compatible —
  `main`'s current code doesn't reference the new columns/tables either,
  so their existence is inert until the new code ships. This ordering
  (schema first, code second) is the safe direction; it avoids ever
  having code that expects a column deployed before the column exists.
- **After schema applied AND after deploy:** the intended end state —
  everything Sprint 2 needs is present and used.
- **Deploying code before the schema exists would break the build/runtime**
  immediately (every Prisma query referencing e.g. `revenueCatActive`
  would fail at the database level) — this is why schema must precede
  code deploy, not the reverse.

### Rollback / forward-fix strategy

- **Schema rollback** (if ever needed before code depends on it): each
  statement's rollback is `ALTER TABLE ... DROP COLUMN "x"` /
  `DROP TABLE "x"` — safe specifically because nothing reads/writes these
  columns until the corresponding application code is also deployed.
- **Code rollback** (reverting the `main` merge after deploy): safe at any
  point **before** the admin-role UPDATE and before any real RevenueCat
  traffic writes to the new columns — reverting the app code while the
  schema remains is inert (old code ignores columns it doesn't know
  about). After real traffic has written to `revenueCatActive`/etc., a
  code rollback would mean the OLD code stops reading those columns
  again — not a data-loss risk (the columns keep their values, ready to
  be read again on a forward-fix), but a functional regression back to
  pre-Sprint-2 entitlement resolution until re-deployed forward.
- **Forward-fix is the preferred remediation** per `/CLAUDE.md`'s general
  git discipline — new commits and a new deploy, not `git reset` on a
  shared branch.

### Confirmation: no destructive drops/renames anywhere in this rollout

Confirmed directly against the SQL in §2g and the Prisma schema diff — zero
`DROP`, `RENAME`, `TRUNCATE`, or destructive `UPDATE`/`DELETE` statements
appear anywhere in the proposed rollout.

### What must be verified immediately after migration

The migration file's own commented-out verification block (`docs/migrations/2026-08-sprint2-schema.sql`,
bottom section):
```sql
SELECT column_name, data_type, column_default FROM information_schema.columns
  WHERE table_name = 'User' AND column_name IN
    ('role','revenueCatActive','revenueCatInterval','revenueCatProductId','getawayChooseEmailSentAt');
SELECT count(*) FROM "User" WHERE role != 'user';        -- expect 0 immediately after
SELECT count(*) FROM "RevenueCatWebhookEvent";            -- expect 0
SELECT count(*) FROM "AdminAuditLog";                     -- expect 0
SELECT count(*) FROM "AmoeEntry";                         -- expect 0 (backfill is separate)
SELECT count(*) FROM "RateLimitCounter";                  -- expect 0
```
And after the separate admin-role UPDATE:
```sql
SELECT id, email, role FROM "User" WHERE role = 'admin';   -- expect exactly 1 row
```

---

## 4. Railway Environment Variables

| Variable | New or existing? | Secret? | Expected format | Required before |
|---|---|---|---|---|
| `REVENUECAT_V2_SECRET_KEY` | **New** | Yes | RevenueCat v2 Secret API Key string, scoped **read-only** (`customer_information:customers/subscriptions/purchases:read`, `project_configuration:entitlements/products:read` — no `read_write`) | Any production dry-run or live sync (`syncRevenueCatEntitlementFromProvider`, `CUSTOMER_SUPPORT`/`TRANSFER` webhook handling, historical reconciliation) |
| `REVENUECAT_PROJECT_ID` | **New** | No (an identifier, not a credential) | RevenueCat project id string | Same as above |
| `REVENUECAT_PRO_ENTITLEMENT_ID` | **New, optional** | No | Entitlement lookup key string (defaults to `'pro'` if unset) | Only needed if GasCap's actual RevenueCat entitlement lookup key differs from `'pro'` — confirm against the RevenueCat dashboard before assuming the default is correct |
| `REVENUECAT_HMAC_SECRET` | **New, intentionally NOT set yet** | Yes | HMAC signing secret from RevenueCat's webhook signing configuration | Only before HMAC enablement (§5) — must remain **unset** until the dashboard/test-delivery sequence in §5 is completed |
| `REVENUECAT_WEBHOOK_AUTH` | **Existing** (already live on `main`/production — the webhook route predates this sprint) | Yes | Shared secret string, compared via `Authorization` header | Already required; unaffected by this sprint |
| `ADMIN_PASSWORD` | **Existing** | Yes | Shared secret string | Already required; the dual-auth design keeps this working unchanged throughout the migration |
| `CAMPAIGN_ADMIN_PASSWORD` | **Existing** (optional override, falls back to `ADMIN_PASSWORD`) | Yes | Shared secret string | Already optional/existing; unaffected |
| `DATABASE_URL` | **Existing** | Yes | Postgres connection string | Already required for everything |

**Locally verified (this environment, not Railway):** `REVENUECAT_V2_SECRET_KEY`,
`REVENUECAT_PROJECT_ID`, `REVENUECAT_PRO_ENTITLEMENT_ID`, and
`REVENUECAT_HMAC_SECRET` are **not present** in this repo's local
`.env.local` — I have no visibility into Railway's actual current
configuration and did not check it. `ADMIN_PASSWORD`, `CAMPAIGN_ADMIN_PASSWORD`,
and `DATABASE_URL` **are** present locally, consistent with them being
pre-existing, already-required variables.

**No `.env.example` exists at the repository root** — flagged as a gap in
§13; there is no single source of truth in the repo for "here is the
complete list of variables production needs."

---

## 5. RevenueCat Configuration

### Production API credentials required

`REVENUECAT_V2_SECRET_KEY` scoped read-only, and `REVENUECAT_PROJECT_ID` —
see §4. These were used successfully in this session's live SANDBOX smoke
tests (see the summary at the top of this task), but **have not yet been
independently confirmed configured for PRODUCTION** RevenueCat traffic in
Railway.

### Entitlement lookup key expected by GasCap

`'pro'` (the default of `REVENUECAT_PRO_ENTITLEMENT_ID`) — confirmed
working against the sandbox project in this session's smoke tests
(`Resolved entitlement catalog: lookup_key="pro" -> found`). Not yet
independently re-confirmed this is the exact same lookup key configured on
the **production** RevenueCat project (sandbox and production share a
project in RevenueCat's model, so this is very likely already confirmed by
the sandbox test succeeding — but flagged for completeness).

### Webhook / HMAC readiness state

- **Primary auth (`REVENUECAT_WEBHOOK_AUTH`):** already live in
  production, fails closed (503) if unset — unaffected by this sprint.
- **HMAC (`REVENUECAT_HMAC_SECRET`):** implemented
  (`lib/revenueCatHmac.ts`), **intentionally OFF by default**, additive
  defense-in-depth layered on top of (never a replacement for) the
  existing auth check. When the env var is unset, `verifyRevenueCatHmac`
  returns `{ checked: false }` and the caller proceeds exactly as before —
  a complete no-op.
- **Explicitly documented as NOT independently re-verified against
  RevenueCat's live signing scheme from this environment** — the exact
  header format (`X-RevenueCat-Webhook-Signature: t=<ts>,v1=<sig>`) is
  implemented per a reported spec, not confirmed firsthand against
  RevenueCat's dashboard/docs by browsing them in this environment.

### What remains intentionally disabled/staged

- `REVENUECAT_HMAC_SECRET` — unset, per design, until the sequence below
  is completed.
- The legacy `ADMIN_PASSWORD` path — still active in parallel with
  session-based admin auth (dual-auth staged, see §8).
- AMOE read path — still reads the file, not `AmoeEntry` (dual-write only,
  see §7/§9).

### Exact sequence for enabling HMAC later (no dashboard changes made now)

1. In the RevenueCat dashboard, confirm webhook signing is enabled for the
   GasCap project and generate/copy a signing secret.
2. Send a real test webhook delivery (RevenueCat's dashboard supports
   resending a past event) and confirm the deployed webhook handler
   **accepts** it — i.e., verify `verifyRevenueCatHmac` returns
   `{ checked: true, valid: true }` for a real delivery, not just in
   unit tests against synthetic data.
3. **Only then** set `REVENUECAT_HMAC_SECRET` in Railway.
4. Re-send another test delivery post-configuration to confirm end-to-end
   behavior with the secret live.

No RevenueCat dashboard changes were made in preparing this packet.

---

## 6. Production Reconciliation Dry Run

### Exact command(s) — DRY RUN ONLY, GET request

```bash
curl https://www.gascap.app/api/admin/revenuecat-historical-reconciliation \
  -H "x-admin-password: $ADMIN_PASSWORD"
```
(Or via a signed-in admin session — no header needed once the admin-role
backfill from §2g/§8 is applied.)

**No apply command is included in this packet and none should be run** —
the apply command requires `{"confirm": true, "reportHash": "<value>"}` and
is a distinct POST call; producing/running it is explicitly out of scope
for this preflight review.

### What the dry run reads

Per `lib/revenueCatHistoricalReconciliation.ts`'s `buildDryRunReport()`:
- GasCap's own `User` table (read-only `findMany`) — every user with any
  of: non-null `stripeInterval`, non-null `stripeSubscriptionId`,
  `ambassadorProForLife`, `plan IN ('pro','fleet')`, or a redeemed Gift.
- `Gift` table (read-only) to identify redeemed gift Lifetimes.
- Live RevenueCat v2 lookups (read-only GET requests — customer search,
  entitlement catalog, production subscriptions/purchases, product
  catalog) for **every** candidate, not only ones lacking internal
  evidence.
- Live Stripe lookups (read-only `paymentIntents.search`) for the specific
  ambiguous pattern where `stripeInterval === 'lifetime'`.
- Live Stripe subscription status checks (read-only
  `subscriptions.retrieve`) only when a plan repair might depend on an
  unverified `stripeSubscriptionId`.

### Confirmation it performs zero entitlement/data writes

Confirmed by direct code inspection: `buildDryRunReport()` contains no
`prisma.user.update`/`updateMany`/`create` call anywhere in its body — only
`findMany` calls against `User` and `Gift`, plus the read-only RC/Stripe
API calls listed above. The GET route handler
(`app/api/admin/revenuecat-historical-reconciliation/route.ts`) calls only
`buildDryRunReport()`, never `applyReconciliation()`.

### Expected output/report structure

```jsonc
{
  "ok": true,
  "dryRun": true,
  "totalCandidates": <number>,
  "classifications": { "<classification>": <count>, ... },
  "ambiguousCount": <number>,
  "historicalPlanInconsistencyCount": <number>,
  "rcLookupAttempted": <number>,
  "rcLookupFailed": <number>,
  "stripeLifetimeVerificationAttempted": <number>,
  "stripeLifetimeVerificationInconclusive": <number>,
  "stripeSubscriptionVerificationAttempted": <number>,
  "stripeSubscriptionVerificationInconclusive": <number>,
  "reportHash": "<sha256 hex>",
  "candidates": [ { /* per-candidate detail, see §7 */ } ]
}
```

### Classifications to expect

- `confirmed_stripe_subscription`
- `confirmed_stripe_lifetime`
- `confirmed_gifted_lifetime`
- `confirmed_ambassador`
- `confirmed_active_rc_monthly` / `confirmed_active_rc_lifetime`
- `suspected_legacy_rc_contamination` (report-only, see §7 — renamed from
  `confirmed_legacy_rc_contamination` in the final Revision 7 pre-smoke
  patch specifically because Stripe's `NO_MATCH` result is not proof of
  absence)
- `multiple_legitimate_sources`
- `ambiguous_legacy_provenance`

### What counts as suspicious or blocking

- A **high `rcLookupFailed` or `stripeLifetimeVerificationInconclusive`/
  `stripeSubscriptionVerificationInconclusive` count** relative to
  `totalCandidates` — indicates a configuration problem (wrong
  credentials, wrong entitlement lookup key, rate limiting) rather than
  genuine ambiguity, and should be fixed and the dry run re-run before
  trusting the results.
- A **non-zero `historicalPlanInconsistencyCount`** — worth individually
  inspecting each flagged candidate before ever considering an apply; per
  §7, a repair proposal here is generated only from confirmed, non-trial
  sources, but every one should still be manually spot-checked before
  trusting it at scale.
- Any **`suspected_legacy_rc_contamination`** entries at all — these
  identify accounts worth a human looking at manually (see §7); a
  non-trivial count here is not itself blocking (this migration cannot act
  on them automatically regardless), but should inform whether Don wants
  to pursue any targeted, one-off manual cleanup afterward.

### Manual spot-check procedure

1. Pick a small sample (e.g. 3–5) from each non-trivial classification
   bucket, especially `confirmed_active_rc_*`,
   `historicalPlanInconsistency: true`, and
   `suspected_legacy_rc_contamination: true`.
2. For each, independently look up the same identity in the RevenueCat
   dashboard and the Stripe dashboard directly.
3. Confirm the tool's classification and any proposed
   `proposedRevenueCatActive`/`proposedPlanRepair` value matches what the
   dashboards actually show.
4. Only after this manual spot-check is satisfactory should an apply ever
   be considered — and even then, per §11/§12, that requires a fully
   separate approval step this packet does not request.

### No apply command was executed or included as runnable

Confirmed — this packet contains no `POST .../revenuecat-historical-reconciliation`
example with `confirm: true` filled in as something to actually run.

---

## 7. Historical Data Safety

Current rules, per `lib/entitlements.ts` (the resolver) and
`lib/revenueCatHistoricalReconciliation.ts` (the migration tool):

| Source | Normal runtime resolution | Historical repair eligibility (this migration) |
|---|---|---|
| Stripe Monthly/Annual | `stripeSubscriptionId != null` → active | May justify a `plan` repair **only if live-verified** via `verifyStripeSubscriptionActive` (statuses `active`/`trialing` → eligible; `canceled`/`unpaid`/`incomplete`/`incomplete_expired`/`paused` → not eligible; `past_due` or unrecognized → inconclusive, never eligible on this evidence alone) |
| Stripe Lifetime | `stripeInterval === 'lifetime'` → permanent | Classified `confirmed_stripe_lifetime` **only** via a verified succeeded Stripe PaymentIntent (`metadata.billing==='lifetime'`) — never from `stripeCustomerId` presence alone |
| RevenueCat Monthly/Lifetime | `revenueCatActive` → active, interval per `revenueCatInterval` | RC fields (`revenueCatActive`/`revenueCatInterval`/`revenueCatProductId`) **may be backfilled** when a live RC lookup confirms an active entitlement |
| Admin comp Pro | Not a distinct provenance field today — comp actions go through the same `plan`/entitlement fields as other grants (see `lib/adminAudit.ts`'s audited comp-grant/comp-revoke actions) | Not a distinct reconciliation source; not separately classified by this tool |
| Ambassador/giveaway Lifetime | `ambassadorProForLife` → permanent | May justify a `plan` repair on its own (no live verification needed — it's a GasCap-internal flag, not provider data) |
| Active trial users | `isProTrial && trialExpiresAt` in the future → active | **Categorically excluded** from justifying a historical plan repair — the repair-specific resolver call hard-codes `isProTrial: false, trialExpiresAt: null` regardless of actual stored trial state (Revision 6 fix). Other confirmed sources can still independently justify a repair for a user who also happens to be on trial. |
| Suspected legacy RevenueCat contamination | N/A (not a runtime state) | **Report-only.** `suspectedLegacyStripeIntervalContamination: true` flags a candidate for MANUAL review. `applyReconciliation` never reads this field for any write. |

### Which fields MAY be repaired (by `applyReconciliation`, with explicit
approval)

1. `revenueCatActive` / `revenueCatInterval` / `revenueCatProductId` — RC
   field backfill, when a live lookup confirms an active entitlement.
2. `plan` — from `'free'` to `'pro'` only, only from confirmed non-trial
   sources. **Never the reverse** — this migration cannot downgrade
   anyone.

### Which fields are REPORT-ONLY (identified but never written)

- `stripeInterval` — **never cleared or modified by this migration under
  any circumstance**, as of the Revision 7 de-scope. Confirmed by direct
  grep of `applyReconciliation`'s `data` payload construction — the only
  `stripeInterval` reference anywhere in `applyReconciliation` is inside
  the optimistic-concurrency `WHERE` clause (a precondition check), never
  in the `data` object being written.
- `suspectedLegacyStripeIntervalContamination` — informational flag only,
  surfaced in the dry-run report for manual follow-up; never consumed by
  the apply path.

### Confirmation: `stripeInterval` is NOT automatically destructively
cleared

**Confirmed.** This was a deliberate, explicit architecture decision made
across three review rounds (Revisions 4, 5, and 6/7): Stripe's Search API
(used for Lifetime purchase verification) is documented as eventually
consistent, and this repository can only prove *today's* Checkout code
writes the metadata this evidence correlates on — not every historical
GasCap Lifetime sale across every prior code version. No rule built on
available evidence was judged safe enough for an automatic, destructive,
bulk `stripeInterval` clear. If Don later wants to clean up a specific
suspected-contamination account, that requires a separate, manual,
one-off action outside this bulk tool — not a re-run of this migration
with a changed rule.

---

## 8. Admin Auth / Security

### Production readiness of the admin auth migration

**Steps 1–4 of the documented 7-step migration sequence
(`docs/ADMIN_AUTH_MIGRATION.md`) are implemented; steps 5–7 are staged/
pending:**

1. ✅ `role` column added to schema (not yet applied to production — see §2).
2. ⏳ Set `role='admin'` on Don's account — SQL written, **not yet run**.
3. ✅ `requireAdmin()` accepts EITHER a valid admin session OR the legacy
   header — dual-auth, no lockout possible.
4. ✅ Admin UI (`app/admin/page.tsx`) moved off persisting the password in
   `localStorage`; a signed-in admin session logs in silently via a probe
   request, with the password prompt as fallback.
5. ⏳ **Soak** — not started; depends on step 2 happening in production
   first, then real admin usage accumulating.
6. ⏳ Remove the legacy branch and `ADMIN_PASSWORD` entirely — blocked on
   step 5.
7. Partial: audit logging is live for the highest-risk mutations (user
   delete/plan-change/comp-grant/comp-revoke, sweepstakes draw runs,
   winner-email releases, AMOE backfill) — not wired to every mutating
   admin endpoint, a deliberate risk-prioritization choice.

**Note — a discrepancy worth flagging to the reviewer:**
`docs/ADMIN_AUTH_MIGRATION.md` line 137–139 currently states *"No
warning-log-on-legacy-path instrumentation was added yet; add it before
starting the soak."* This is **stale** — `lib/adminAuth.ts`'s
`requireAdmin()` and `legacyAdminPasswordOk()` both already call
`console.warn('[adminAuth] legacy ADMIN_PASSWORD path used...')` on every
legacy-path use, confirmed by direct code inspection. The instrumentation
described as missing already exists. This packet does not correct that
doc file (out of scope — review only), but the reviewer should treat the
doc's soak-readiness claim as understated: the actual code is closer to
soak-ready than the doc currently states.

### Local password fallback status

**Still fully active, by design ("dual-auth staged").** Every one of the
~20-21 admin/push/announcement routes that previously used only
`ADMIN_PASSWORD` now accepts EITHER that legacy header OR a valid admin
session (`role === 'admin'`), via `legacyAdminPasswordOk()` /
`sessionHasAdminRole()` / `requireAdmin()`. The legacy path remains
fail-closed (503 if `ADMIN_PASSWORD` is unset) exactly as before this
sprint — this sprint did not change that property, only added a second,
independent path alongside it.

### Audit logging

Live for: user delete, plan-change, comp-grant, comp-revoke, sweepstakes
draw runs, winner-email releases, AMOE backfill (`lib/adminAudit.ts`,
`AdminAuditLog` table — see §2). Failure to write an audit log entry does
not block the underlying admin action (confirmed by
`__tests__/adminAudit.test.ts`'s explicit regression test for this).

### Variables/credentials required before deployment

- `ADMIN_PASSWORD` — already required, unaffected.
- No new required variable for the admin-auth migration itself — the
  `role` column (schema) and its backfill (§2g) are the only new
  dependencies, both database-level, not environment-variable-level.

---

## 9. Rate Limiting / Durability

### Postgres rate limiter readiness

**Implemented, additive, applied to two specific surfaces:**
password-reset (`app/api/auth/forgot-password/route.ts` — previously had
**no** rate limiting of any kind, found during this sprint's own audit)
and OTP-send (`app/api/otp/send/route.ts`, consolidated off a redundant
local implementation). The pre-existing in-memory limiter
(`lib/rateLimit.ts`) is **not replaced everywhere** — it's still used
elsewhere in the codebase; this is additive coverage for the two
highest-priority gaps, not a full migration.

**Atomicity:** implemented as a single `INSERT ... ON CONFLICT ... DO
UPDATE` statement with the expiry check evaluated inside the SQL itself
(a `CASE` on the row's own `resetAt`) — not a read-then-decide-then-write
sequence, closing a real race condition an earlier revision of this same
code had (two concurrent requests at a window rollover could both read
the same expired row and both write `count: 1`, losing one request from
the count).

**PII handling:** rate-limit keys built from an identifier like an email
are SHA-256 hashed before becoming a durable Postgres key
(`hashRateLimitIdentifier`) — deterministic (so the limiter still works)
but not HMAC'd with a secret; documented as adequate for "table hygiene
against casual plaintext exposure," not a defense against a determined
attacker with a candidate-email list.

**Cleanup:** `app/api/cron/cleanup-rate-limits/route.ts` exists as a
scheduled job (confirmed present in the cron inventory — `npm run
check:crons` reports 19 routes, 17 scheduled, 2 exempt, consistent with
this cron existing and being scheduled).

### Webhook event durability/idempotency readiness

**Implemented and tested.** `RevenueCatWebhookEvent` + `claimToken`
compare-and-swap (§2b) makes concurrent/retried webhook delivery safe:
duplicate `event.id` delivery is detected and its side effects are
skipped; a crash mid-processing leaves the row in `processing` state,
safely reclaimable by a later retry via the claim-token check (an old
claimant whose token no longer matches a newer reclaim cannot overwrite
that newer claimant's state). Covered by
`__tests__/revenuecatWebhook.test.ts` (42 tests, passing — see §10 for
current full-suite counts).

### AMOE persistence migration status

**Staged — file authoritative, Postgres dual-write attempted, NOT
guaranteed, read path NOT cut over.** Per
`docs/migrations/2026-08-sprint2-amoe-backfill.md`:
- `POST /api/amoe` writes the file exactly as before (unconditional,
  primary), then attempts a best-effort mirror to Postgres — the mirror
  can fail without blocking or failing the real submission.
- An idempotent, concurrency-safe backfill endpoint
  (`POST /api/admin/amoe-backfill`) exists to catch any missed mirrors,
  using a single atomic `createMany({ skipDuplicates: true })` batch and
  reconciling by `(email, month)` **plus field content**, not just a count
  comparison.
- **The draw's actual read path (`lib/giveaway.ts` → `lib/amoeEntries.ts`)
  still reads the file, not the database** — an explicit, documented scope
  decision, not an oversight: this development environment cannot read
  the production Railway volume, so there was no way to confirm the real
  production entry count before cutting the read path over, and the
  sprint brief required verifying every existing entry is preserved
  before anything changes.
- Required steps before the read-path cutover (documented, not yet done):
  deploy this sprint's code → run the backfill → check `verified: true` in
  its response → manually spot-check a few entries → only then switch the
  read functions → do not delete `data/amoe-entries.json` even after
  cutover, only after Don explicitly approves with verified counts as the
  record.

### Any required schema dependency before code deploy

Yes — all of §2's schema changes must be applied before the corresponding
application code is deployed (see §3's ordering). No Sprint 2 feature in
this section can function without its schema counterpart existing first.

---

## 10. Observability / Post-Deploy Checks

### Logs/metrics/routes to watch

- `[adminAuth] legacy ADMIN_PASSWORD path used` — watch this log line's
  frequency to determine when the legacy path has "gone quiet" (the actual
  soak criterion for removing it, per §8).
- `[revenuecat]` prefixed logs in the webhook handler — event processing,
  claim/reclaim, HMAC check results (once enabled).
- `[stripeEvidence]` / `[revenueCatHistoricalReconciliation]` logs — only
  relevant once/if the reconciliation dry run or apply is actually run
  against production.
- `GET /api/admin/revenuecat-events` — the new read-only observability
  endpoint (`87adb0e`) for inspecting `RevenueCatWebhookEvent` rows
  directly without a raw DB query.

### Production smoke-test checklist (after deploy)

**RevenueCat webhook verification:**
- Confirm `REVENUECAT_WEBHOOK_AUTH` is still correctly configured (already
  required pre-Sprint-2 — verify it wasn't accidentally touched).
- Trigger or wait for a real webhook delivery; confirm a
  `RevenueCatWebhookEvent` row is created and reaches `status: 'processed'`.
- Re-deliver the same event (RevenueCat dashboard resend) and confirm it's
  detected as a duplicate, not double-processed.

**Stripe webhook verification:**
- Confirm existing Stripe webhook behavior is unaffected (Sprint 2 did not
  modify Stripe webhook logic — `app/api/stripe/webhook/route.ts` is
  outside this sprint's changes) — a basic smoke check, not a new
  requirement introduced by this sprint.

**Admin auth verification:**
- Confirm `app/admin/page.tsx` still logs in via the legacy password
  prompt (dual-auth safety net).
- After the role backfill (§2g step 3), confirm Don's session-based login
  also works, silently, without the password prompt.
- Confirm a non-admin user's session correctly falls through to "not
  admin" rather than being granted access.

**Rate limiter verification:**
- Trigger the password-reset flow enough times to hit the limit; confirm
  it's actually rejected (not silently passing through).
- Confirm the `cleanup-rate-limits` cron is running on its schedule.

**AMOE verification:**
- Submit a test AMOE entry; confirm it lands in both the file (unchanged
  primary behavior) and, best-effort, `AmoeEntry` (check via a DB query or
  the admin backfill endpoint's `dbCount`).
- **Do not run the backfill against production data casually** — it's
  idempotent and safe to run, but per §9, treat the read-path cutover
  itself as a separate, deliberate, later step — not part of this
  deploy's smoke test.

**Entitlement verification:**
- Confirm a real Stripe subscription/Lifetime purchase, gift redemption,
  and Ambassador grant each still resolve Pro access correctly
  (`lib/entitlements.ts`'s resolver is now the single source of truth for
  this — a regression here would be high-impact).
- Confirm a real (or sandbox) RevenueCat grant correctly sets
  `revenueCatActive`/`revenueCatInterval`/`revenueCatProductId` and that
  the user sees Pro access.

---

## 11. Release Sequence

A. Review this preflight packet (this document).
B. Explicit Product Owner (Don) approval to proceed.
C. Apply the additive production schema SQL (§2g) — NOT executed yet.
D. Verify schema (§3's verification queries) — NOT executed yet.
E. Configure required Railway environment variables (§4) —
   `REVENUECAT_V2_SECRET_KEY` / `REVENUECAT_PROJECT_ID` at minimum;
   `REVENUECAT_HMAC_SECRET` deliberately deferred (§5/§11-O).
F. Production reconciliation **DRY RUN ONLY** (§6) — read-only, zero writes.
G. Independent review of the dry-run results (ChatGPT and/or Don).
H. Explicit approval before any reconciliation **apply** — a fully
   separate decision from B, not implied by it.
I. Open the Sprint 2 PR (`hardening/sprint-2` → `main`).
J. GitHub CI (test/build checks — currently no CI workflow beyond
   `npm run check:crons` verified in this repo; confirm what actually runs
   in CI before relying on this step to catch anything).
K. Independent PR review.
L. Product Owner merge approval.
M. Railway deployment (merge to `main` **is** the deploy, per
   `/CLAUDE.md`).
N. Production smoke tests (§10).
O. HMAC enablement — **only** after the provider delivery/signature
   validation sequence in §5, independently of and after the main
   deployment; not a blocking step for M.
P. Final cleanup/closeout — admin-role soak monitoring continues (§8);
   AMOE read-path cutover remains a deliberately separate, later decision
   (§9); `suspected_legacy_rc_contamination` follow-up (§7) if any is
   found, handled as a manual, targeted action outside this release.

---

## 12. Go / No-Go Checklist

### Must be TRUE before the first production SQL action (§2g's `ALTER`/`CREATE` statements)

- [ ] Don has explicitly reviewed and approved this packet (§11-B).
- [ ] The exact SQL in §2g has been reviewed against the live production
      schema to confirm no naming collision with anything not captured in
      this packet's diff.
- [ ] A recent production database backup/snapshot exists (standard
      practice before any schema change, even an additive one) — **not
      independently confirmed in this session.**
- [ ] Postgres version/Railway configuration has been confirmed to support
      fast additive `ALTER TABLE ... ADD COLUMN ... DEFAULT` without a
      full-table rewrite (§2e) — **not independently confirmed in this
      session.**

### Must be TRUE before reconciliation **apply** (not just the dry run)

- [ ] The dry run (§6) has actually been run against production and its
      report reviewed.
- [ ] The manual spot-check procedure (§6) has been performed on a sample
      of non-trivial classifications.
- [ ] `rcLookupFailed`/`*VerificationInconclusive` counts are low relative
      to `totalCandidates`, or any elevated count has been explained by a
      known, fixed configuration issue and the dry run re-run.
- [ ] Every `historicalPlanInconsistency: true` candidate has been
      individually reviewed, not just trusted in aggregate.
- [ ] Don has given a SEPARATE, explicit approval for apply — distinct
      from approval of this packet or of the dry run.
- [ ] The exact `reportHash` from the reviewed GET response is the one
      supplied to the POST call (the endpoint 409s on mismatch, but this
      should be a deliberate step, not relied upon as the only safeguard).

### Must be TRUE before merge/deploy (§11-L/M)

- [ ] Schema (§2g) has been applied and verified in production (§3).
- [ ] Required Railway env vars (§4) are configured.
- [ ] `npm test`, `npx tsc --noEmit`, and `npm run build` all pass at the
      exact commit being merged (see §"Test/build status" at the end of
      this packet for the values as of `e07bd08` — must be re-verified at
      whatever the actual merge-commit SHA ends up being, if it differs).
- [ ] PR has been opened, reviewed, and approved per §11-I through L.
- [ ] Don has given explicit merge approval — per `/CLAUDE.md`, "ChatGPT
      approved this" is never itself permission to merge.

---

## 13. Open Risks / Unresolved Items

| # | Risk | Rank | Status |
|---|---|---|---|
| 1 | RevenueCat v2 client's exact response shapes have now been LIVE-validated in SANDBOX (unknown/Lifetime/subscription paths all confirmed per this task's summary) but **not yet against PRODUCTION RevenueCat traffic** | Medium | Live-tested in sandbox only; production behavior is very likely identical (same API, same project) but not independently confirmed |
| 2 | HMAC scheme (`lib/revenueCatHmac.ts`) implements a reported spec, not one independently confirmed against RevenueCat's live dashboard/docs from this environment | Medium | Intentionally deferred — `REVENUECAT_HMAC_SECRET` remains unset until the §5 sequence is completed; no production risk while unset |
| 3 | No production database backup/snapshot freshness was confirmed in this session before proposing schema changes | Medium | Standard practice, not verified here — should be confirmed as part of §12's pre-SQL checklist |
| 4 | Postgres version/Railway config's exact behavior for additive `ALTER TABLE ... ADD COLUMN ... DEFAULT` (fast vs. full rewrite) was not independently confirmed | Low | Believed safe for any reasonably modern Postgres (11+), but not verified against GasCap's actual instance |
| 5 | AMOE read path still reads the file, not the database — a real production entry count has never been confirmed reconciled, since this dev environment can't read the Railway volume | Medium | Intentionally deferred (§9); the file remains authoritative and safe in the meantime; no data-loss risk from this specific gap |
| 6 | `docs/ADMIN_AUTH_MIGRATION.md` contains a stale claim (legacy-path warning logging "not added yet," when it already exists in code) | Low | Documentation drift only, no functional impact; not corrected in this packet (out of scope — review only) |
| 7 | No `.env.example` exists — no single source of truth in-repo for the complete list of required production variables | Low | Operational convenience gap, not a correctness risk; the variables are individually documented across code comments and this packet |
| 8 | `suspected_legacy_rc_contamination` candidates, if any exist in production, have no built-in remediation path — only manual, one-off action | Low | Deliberate scope decision (§7); not blocking, since the tool correctly does nothing automatic here |
| 9 | GitHub CI's actual scope for this repo was not independently confirmed in this session (what runs on PR open, beyond `npm run check:crons` verified locally) | Low | Should be confirmed before relying on §11-J as a real gate |
| 10 | `admin` role backfill (Don's account) has not been applied to production — until it is, the session-based admin login has no effect for anyone, silently falling back to the password prompt (safe, but not the intended end state) | Low | Expected, staged step (§2g/§8), not itself a risk beyond "not yet done" |
| 11 | The production reconciliation dry run itself has never been run against real production data — every test to date is against mocked dependencies (unit tests) or the live RevenueCat sandbox API directly (not through GasCap's DB) | Medium | This is the next concrete step per §11-F, explicitly not taken in this packet |

---

## Final Summary

- **Current HEAD SHA:** `e07bd0865388534903b7fb54c6c746ab6697782c` (branch `hardening/sprint-2`)
- **`main` HEAD SHA (for comparison):** `3ff64267d69e3e6d0a4a155fd6ea8792be183943`

**Exact files reviewed for this packet** (read directly, this session):
`prisma/schema.prisma` (full diff against merge-base `39de76a`),
`docs/migrations/2026-08-sprint2-schema.sql`,
`docs/migrations/2026-08-sprint2-amoe-backfill.md`,
`lib/adminAuth.ts`, `docs/ADMIN_AUTH_MIGRATION.md`,
`lib/rateLimitDb.ts`, `lib/revenueCatHmac.ts`,
`app/api/native/revenuecat/route.ts` (HMAC/auth sections),
`lib/entitlements.ts`,
`lib/revenueCatHistoricalReconciliation.ts` (module doc comment +
`applyReconciliation`'s `data`-payload construction, grepped for every
`stripeInterval` reference),
`app/api/admin/revenuecat-historical-reconciliation/route.ts`,
`README.md` (Persistence inventory section),
`.env.local` (existence-only check per variable, no values read/printed),
`.gitignore`, full `git log`/`git diff` history since the merge-base.

**Exact proposed production actions — NONE EXECUTED, all clearly marked
above:**
1. The additive schema SQL in §2g (`ALTER TABLE`/`CREATE TABLE`/`CREATE INDEX`) — **NOT EXECUTED**.
2. Don's admin-role `UPDATE` (§2g, separate) — **NOT EXECUTED**.
3. Railway environment variable configuration (§4) — **NOT PERFORMED**.
4. RevenueCat dashboard HMAC configuration (§5) — **NOT PERFORMED**.
5. Production reconciliation dry-run GET call (§6) — **NOT EXECUTED**.
6. Any reconciliation apply — **NOT EXECUTED, not even proposed as runnable in this packet**.
7. PR open / merge / deploy — **NOT PERFORMED**.

**Test/build status, verified fresh in this session at `e07bd08`:**
```
npm test           → Test Files: 30 passed (30) / Tests: 451 passed (451)
npx tsc --noEmit    → clean, no output, exit 0
npm run build       → succeeded (full Next.js production build)
npm run check:crons → ✓ cron inventory: 19 routes, 17 scheduled, 2 exempt
npx prisma validate → The schema at prisma/schema.prisma is valid 🚀
```

**Recommendation:**

# READY FOR PREFLIGHT REVIEW

Every schema change is additive, nullable-or-inert by default, and has an
exact proposed (not executed) SQL statement. Every historical-data safety
rule is verified by direct code inspection, not assumption — most notably
that `stripeInterval` is structurally never written by the bulk
reconciliation apply path. The RevenueCat v2 provider contract has now
been live-validated in sandbox across all three code paths (unknown
identity, Lifetime, subscription). Admin auth, rate limiting, webhook
idempotency, and AMOE dual-write are each independently staged with
explicit, documented rollout sequences and no destructive operations
anywhere in the current plan. The open risks in §13 are real but are
either Low-rank operational gaps or Medium-rank items whose next concrete
step is explicitly the following stage of the release sequence (§11-F, the
dry run) — not blockers to an independent reviewer beginning that final
review now.

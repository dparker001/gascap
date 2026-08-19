# Sprint 2 Production Preflight Packet (Revision 3)

**Purpose:** REVIEW/PREFLIGHT ONLY. No production action was taken to
produce this document — every SQL statement, command, and Railway variable
listed below is PROPOSED, not executed. This packet is written so an
independent reviewer (ChatGPT) can perform a final production-readiness
review of Hardening Sprint 2 without reconstructing the sprint from commit
history.

**SHA terminology, precise (Revision 2 convention, continued in
Revision 3):**
- **Review Target / code SHA:** `e07bd0865388534903b7fb54c6c746ab6697782c` —
  the application code state this packet's findings are actually about.
  Every §2–§10 finding below was verified against this exact code, not a
  later one. Unchanged since Revision 1/2 — Revision 3 is documentation
  and comment corrections only (§3, the migration SQL's comments, and
  `lib/revenueCatHmac.ts`'s comment — no behavioral code change anywhere).
- **Revision 1 packet commit:** `8dad1b8`.
- **Revision 2 packet commit:** `dfd38a9` (also includes the §5 HMAC
  doc-comment fix from that round).
- **This revision (3)'s packet commit:** documentation/comment-only; see
  this task's final commit SHA in the summary at the end of this file.
- **Current `hardening/sprint-2` branch HEAD** at the time this revision
  was written is documented in §1 below, separately from the Review
  Target SHA — they are the same only until a future commit changes that.

---

## 1. Current Branch / Commit State

- **`hardening/sprint-2` HEAD (at Review Target time):** `e07bd0865388534903b7fb54c6c746ab6697782c`
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

- **`ALTER TABLE "User" ADD COLUMN`** (×5, corrected wording in Revision
  2): on PostgreSQL 11+, adding a column with a constant default does
  **not** physically rewrite every existing row. The default is stored
  once, in the table's metadata (`pg_attribute`); existing rows simply
  read that stored default logically when queried, without Postgres
  writing the value into each row's actual storage. (This is distinct
  from pre-11 Postgres, where `ADD COLUMN ... DEFAULT` genuinely did
  rewrite the whole table — the "avoid this" folklore predates 11 and is
  often repeated without the version caveat.) So this is a fast,
  effectively metadata-only operation regardless of `User` table size, on
  any reasonably current Postgres version. **This has still NOT been
  independently confirmed against GasCap's actual production Postgres
  version** — `SHOW server_version;` remains a required pre-SQL
  verification gate (added to §12 below), not because the mechanism is in
  doubt, but because no operation should proceed on an unconfirmed
  assumption about the target database's actual version. **Added in
  Revision 3 — this section's own title notwithstanding, it previously
  didn't actually name the lock:** even with no row rewrite, `ALTER TABLE
  ... ADD COLUMN` still normally acquires a brief `ACCESS EXCLUSIVE` lock
  on `User` for the duration of the DDL statement, blocking concurrent
  reads/writes to that table for that window. "No table rewrite" and "no
  lock" are separate claims — do not conflate them. See §3's execution
  recommendations (low-traffic window, short `lock_timeout`) for how this
  is handled operationally.
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

### Required order — CORRECTED in Revision 3 to match §11

Revision 2 left this section's ordering stale relative to the corrected
§11 release sequence: it listed "deploy" (step 4) before "configure
Railway env vars" (step 5), which contradicts §11's corrected order
(env vars configured before deploy, since Sprint 2 code fails immediately
without them — e.g. `resolveEntitlementInternalId` throws on every RC
lookup without a correct `REVENUECAT_PRO_ENTITLEMENT_ID`). Corrected:

1. Apply all `ALTER TABLE`/`CREATE TABLE` statements in §2g together, in
   any order relative to each other (no statement depends on another —
   they touch disjoint columns/tables). A single transaction is fine
   given the operations are all fast/metadata-level per §2e — see the
   locking caveat immediately below, however.
2. Run the verification queries (below) to confirm the schema applied as
   expected.
3. **Only after 1–2 are confirmed:** apply the Don admin-role `UPDATE`
   separately, then verify it independently (exactly 1 row with
   `role='admin'`).
4. **Configure required Railway environment variables** (§4) —
   `REVENUECAT_V2_SECRET_KEY`, `REVENUECAT_PROJECT_ID`, and
   `REVENUECAT_PRO_ENTITLEMENT_ID=GasCap Pro` **before** deploy, not after.
   `REVENUECAT_HMAC_SECRET` remains intentionally deferred — see §5's
   corrected enablement sequence, unaffected by this correction.
5. Deploy Sprint 2 application code (merge to `main`) — see §11 for the
   full sequence this step sits within (branch sync, PR, CI, review,
   merge approval, then this deploy step).

### A note on lock behavior during step 1 — added in Revision 3

Even when no table rewrite occurs (§2e — confirmed metadata-only on
PostgreSQL 11+), `ALTER TABLE ... ADD COLUMN` still normally acquires an
`ACCESS EXCLUSIVE` lock on the table for the (brief) duration of the DDL
statement itself — this blocks concurrent reads and writes to `User` for
that window, distinct from the separate question of whether the operation
rewrites existing row data. On an empty or lightly-loaded table this is
negligible; on `User` (GasCap's largest, most actively-written table) it
is still worth treating deliberately rather than assuming "metadata-only"
means "lock-free." See the updated pre-SQL execution plan in §12/below.

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

### Rollback / forward-fix strategy — CORRECTED in Revision 3

Revision 2 tied code-rollback safety to "before the admin-role UPDATE,"
which no longer describes the corrected sequence — §11/§3 above now
perform that UPDATE (step 3) *before* deploy (step 5), so by the time
there's any deployed code to roll back, the admin-role backfill has
already happened. The admin-role backfill and code-rollback safety are
actually independent concerns; corrected:

- **Schema rollback** (if ever needed before code depends on it): each
  statement's rollback is `ALTER TABLE ... DROP COLUMN "x"` /
  `DROP TABLE "x"` — safe specifically because nothing reads/writes these
  columns until the corresponding application code is also deployed.
- **The admin-role backfill does not itself make a code rollback
  unsafe.** Old `main` (pre-Sprint-2) has no code path that reads or
  writes the `role` column at all — it simply ignores an additive column
  it doesn't know about. Whether or not Don's row has `role='admin'` set
  has no bearing on whether rolling the application code back is safe.
- **Code rollback (reverting the `main` merge after deploy) is
  schema-compatible at any point** — leaving the additive schema in place
  while rolling application code back is always safe in the sense that no
  rollback can ever *break* against the schema (old code simply doesn't
  reference the new columns/tables).
- **The real risk is functional, not structural, and appears only after
  real RevenueCat traffic starts writing provider-state fields.** Once
  `revenueCatActive`/`revenueCatInterval`/`revenueCatProductId` have been
  written by real webhook/sync activity, rolling the application code back
  to pre-Sprint-2 means the OLD code no longer consults those fields at
  all — `lib/entitlements.ts`'s pre-Sprint-2 predecessor never checked
  them. This is not a data-loss risk (the columns retain their values,
  ready to be read again the moment a forward-fix redeploys), but it can
  open a **functional entitlement-regression window**: a user whose Pro
  access depends specifically on a RevenueCat-sourced grant (and no other
  source) could appear to lose Pro access under the old code, for exactly
  the duration between the rollback and the next forward-fix deploy.
- **Forward-fix remains the preferred remediation** per `/CLAUDE.md`'s
  general git discipline — new commits and a new deploy, not `git reset`
  on a shared branch — and is doubly preferred here given the functional
  regression window a rollback can introduce once real RC traffic exists.

### Confirmation: no destructive drops/renames anywhere in this rollout

Confirmed directly against the SQL in §2g and the Prisma schema diff — zero
`DROP`, `RENAME`, `TRUNCATE`, or destructive `UPDATE`/`DELETE` statements
appear anywhere in the proposed rollout.

### Recommended execution conditions for step 1 — added in Revision 3

Given the `ACCESS EXCLUSIVE` lock behavior noted above, even though the
lock duration itself should be brief:

- **Perform the schema migration during a controlled, low-traffic
  window** rather than at an arbitrary time — minimizes the chance of the
  lock, however brief, colliding with peak write activity on `User`.
- **Set a short `lock_timeout`** (e.g. `SET lock_timeout = '5s';` before
  the `ALTER TABLE`/`CREATE TABLE` statements, in the same session) so
  that if the migration happens to queue behind an unexpectedly
  long-running transaction already holding a conflicting lock, it **fails
  fast with a clear error** rather than waiting indefinitely and
  potentially queuing behind it while blocking new queries in turn. A
  fast, clear failure is safe and re-runnable; an indefinite wait holding
  a lock queue is not.
- **This has NOT been executed** — these are recommended conditions for
  whenever the migration is actually authorized to run, not something
  performed in preparing this packet.

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
| `REVENUECAT_PRO_ENTITLEMENT_ID` | **New, REQUIRED (corrected in Revision 2 — NOT optional)** | No | Entitlement lookup key string — the code's `'pro'` default is **confirmed wrong** for GasCap's actual project | **Before Sprint 2 deploy AND before any production reconciliation.** The live sandbox smoke test in this task's prior turn proved `lookup_key="pro"` does not resolve against GasCap's real RevenueCat project — the actual configured entitlement identifier is exactly `GasCap Pro`. Every code path that resolves the pro entitlement (`lib/revenueCatApi.ts`'s `resolveEntitlementInternalId`, and by extension every RC sync/reconciliation call) throws if this doesn't match a real entitlement lookup_key in the project — so leaving this unset (falling back to the wrong `'pro'` default) would make every production RC lookup fail closed with an error, not silently misbehave, but it would still block Sprint 2 from functioning at all until corrected. **Set `REVENUECAT_PRO_ENTITLEMENT_ID` to the exact value `GasCap Pro` in Railway before deploy.** (Not a secret — this is a configuration identifier, not a credential; stating the value here is not a secret disclosure.) |
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

**Revision 2 correction:** since `REVENUECAT_PRO_ENTITLEMENT_ID` is now
confirmed REQUIRED (not optional — see the table above), its absence from
`.env.local` is not merely "not yet confirmed," it is a genuine
configuration gap that must be closed before Sprint 2's RevenueCat code
paths can function at all in whichever environment lacks it. This applies
equally to Railway production, which was not directly inspected in this
session — do not assume Railway already has the correct value configured
just because the sandbox smoke test eventually succeeded once the correct
value was supplied to the smoke-test script directly.

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

### Entitlement lookup key expected by GasCap — CORRECTED in Revision 2

**The code's default (`'pro'`) is confirmed WRONG.** The live RevenueCat
sandbox smoke test in this task's prior turn proved `lookup_key="pro"`
does **not** resolve against GasCap's real RevenueCat project — it fails
lookup entirely, since no entitlement in the project's catalog has that
exact lookup key. The actual configured entitlement identifier is exactly:

```
GasCap Pro
```

**Production requires `REVENUECAT_PRO_ENTITLEMENT_ID=GasCap Pro`** set in
Railway before Sprint 2 deploy or any production reconciliation — leaving
it unset (falling back to the code's `'pro'` default) will cause
`resolveEntitlementInternalId` to throw for every single RC lookup, which
in turn fails closed (never silently guesses) but blocks every RC-dependent
Sprint 2 feature from functioning until corrected. This is not a secret —
stating the value here is a configuration fact, not a credential
disclosure.

### Webhook / HMAC readiness state

- **Primary auth (`REVENUECAT_WEBHOOK_AUTH`):** already live in
  production, fails closed (503) if unset — unaffected by this sprint.
- **HMAC (`REVENUECAT_HMAC_SECRET`):** implemented
  (`lib/revenueCatHmac.ts`), **intentionally OFF by default**, additive
  defense-in-depth layered on top of (never a replacement for) the
  existing auth check. When the env var is unset, `verifyRevenueCatHmac`
  returns `{ checked: false }` and the caller proceeds exactly as before —
  a complete no-op.
- **Revision 2 correction — the SPECIFICATION is now confirmed, only LIVE
  DELIVERY validation remains.** Independent review (ChatGPT) has directly
  verified RevenueCat's current official documentation and confirmed the
  implemented scheme matches exactly:
  - Header: `X-RevenueCat-Webhook-Signature`
  - Format: `t=<unix_timestamp>,v1=<hmac_sha256_hex>`
  - Signed message: `<timestamp>.<raw request body>`
  - HMAC-SHA256, constant-time comparison (`crypto.timingSafeEqual`)
  - RevenueCat documents optional timestamp tolerance for replay
    protection and gives 5 minutes as an example — this implementation
    uses that same 5-minute window, corrected wording in Revision 3 (a
    prior draft of this packet said RevenueCat "expects" a tolerance,
    which overstated it as something closer to a requirement).

  `lib/revenueCatHmac.ts`'s header comment has been updated (this
  revision, comment-only, no behavioral change) to state this plainly
  rather than describe the scheme as an unverified "reported spec." What
  is genuinely still unverified is different in kind: this code has never
  processed a real, RevenueCat-signed webhook delivery — only synthetic
  test data in unit tests. Confirming the specification on paper does not
  substitute for confirming a live signed request is actually accepted.

### What remains intentionally disabled/staged

- `REVENUECAT_HMAC_SECRET` — unset, per design, until the sequence below
  is completed.
- The legacy `ADMIN_PASSWORD` path — still active in parallel with
  session-based admin auth (dual-auth staged, see §8).
- AMOE read path — still reads the file, not `AmoeEntry` (dual-write only,
  see §7/§9).

### Exact sequence for enabling HMAC later (no dashboard changes made now) — CORRECTED in Revision 2

Revision 1 of this packet had the ordering backwards: it proposed sending
a test delivery to "confirm the code accepts it" *before* setting
`REVENUECAT_HMAC_SECRET`. That's not possible —
`verifyRevenueCatHmac` returns `{ checked: false }` (a complete no-op,
correctly, since HMAC is meant to be off by default) whenever the secret
is unset, so no delivery can be validated while it remains unset. Testing
cannot happen "before" enabling; enabling and testing must be the same
short window, corrected order:

1. In the RevenueCat dashboard, confirm webhook signing is enabled for the
   GasCap project and generate/copy a signing secret.
2. Set `REVENUECAT_HMAC_SECRET` in Railway — this makes verification
   possible for the first time; the specification is already confirmed
   correct (§ above), so this is the point where live-delivery evidence
   starts actually meaning something.
3. **Immediately** send a real test webhook delivery (RevenueCat's
   dashboard supports resending a past event) and confirm the deployed
   webhook handler **accepts** it — verify `verifyRevenueCatHmac` returns
   `{ checked: true, valid: true }` for the real delivery, in production
   logs, not just in unit tests against synthetic data.
4. **If step 3 fails** (any `valid: false` reason, or the request is
   rejected), **unset `REVENUECAT_HMAC_SECRET` again immediately** —
   reverting to the no-op state — rather than leaving a broken enforcement
   path live in production while debugging it. Do not attempt to debug
   with the secret live and webhook traffic still flowing.
5. If step 3 succeeds, send at least one additional test delivery to
   confirm the result is repeatable, not a one-off coincidence.

HMAC stays disabled until this sequence is actually run. No RevenueCat
dashboard changes and no Railway variable changes were made in preparing
this packet or this revision.

---

## 6. Production Reconciliation Dry Run

**Sequencing note (Revision 2 correction):** this command targets
`www.gascap.app`, which serves whatever `main` currently deploys. The
route below **does not exist on current `main`** — it is Sprint 2
application code. This command is only meaningful **after** Sprint 2 has
been merged and deployed (§11 steps I–M) — it is step O in the corrected
release sequence, not something to run at packet-review time or
immediately after the schema migration. It is documented here, in its own
section, for completeness and for the reviewer's benefit — not as
something runnable today.

### Exact command(s) — DRY RUN ONLY, GET request (run only after Sprint 2 is deployed — see §11)

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

## 11. Release Sequence — CORRECTED in Revision 2

**Revision 1 had a real ordering flaw**, identified on independent review:
it placed "production reconciliation dry run" (step F) *before* the PR/
merge/deploy steps (I–M). But
`/api/admin/revenuecat-historical-reconciliation` **does not exist on
current `main`** — it is Sprint 2 application code, confirmed directly
(`git show origin/main:app/api/admin/revenuecat-historical-reconciliation/route.ts`
fails). A `curl` to that production URL cannot return anything meaningful
— there is no route there to hit — until Sprint 2's code has actually been
deployed. Schema being applied is necessary but not sufficient: the route
handler itself must be running. The corrected sequence:

A. Review this preflight packet (this document).
B. Explicit Product Owner (Don) approval to proceed.
C. Apply the additive production schema SQL (§2g) — NOT executed yet.
D. Verify schema (§3's verification queries) — NOT executed yet.
E. **Admin role backfill and verification** — the separate, one-row
   `UPDATE "User" SET role = 'admin' WHERE email = 'dparker001@gmail.com'`
   (§2g), applied and verified (`SELECT ... WHERE role = 'admin'` returns
   exactly 1 row) immediately after D and before anything else depends on
   it. The legacy `ADMIN_PASSWORD` fallback stays active throughout this
   entire sequence and beyond (§8) — this step adds session-based admin
   access, it does not remove the password path.
F. Configure required Railway environment variables (§4) —
   `REVENUECAT_V2_SECRET_KEY`, `REVENUECAT_PROJECT_ID`, and
   `REVENUECAT_PRO_ENTITLEMENT_ID=GasCap Pro` (§4/§5 — **required**, not
   optional, corrected in this revision) at minimum;
   `REVENUECAT_HMAC_SECRET` deliberately deferred (§5's corrected
   sequence, step O below).
G. **Sync `hardening/sprint-2` with current `origin/main`.** `main` now
   contains the separately-merged iOS trial hotfix (`3ff6426`, PR #2) that
   `hardening/sprint-2` does not yet have (both branches contain
   equivalent fix content under different commit SHAs — `464e1ea` on
   `hardening/sprint-2`, `a225e22`/`3ff6426` on `main` — so this is
   expected to merge cleanly, but must be done and verified, not assumed).
   Use a **normal `git merge origin/main` into `hardening/sprint-2`** —
   do **not** rebase or rewrite history on this shared branch. **This
   step is NOT performed as part of this documentation revision** — it is
   listed here as a required step for whenever the release is actually
   authorized to proceed past this point.
H. **Full validation** at the merged state — `npm test`, `npx tsc
   --noEmit`, `npm run build`, `npm run check:crons`, `npx prisma
   validate` all passing at the post-merge commit, not merely at the
   pre-merge `hardening/sprint-2` HEAD this packet was written against.
I. Open the Sprint 2 PR (`hardening/sprint-2` → `main`).
J. GitHub CI — confirmed (Revision 2 correction; see §13 risk #9)
   `.github/workflows/ci.yml` triggers on PRs to `main` and on
   `hardening/**` pushes, running `npm run check:crons`, `npm test`, `npx
   tsc --noEmit`, `npm run build` in that order.
K. Independent PR review.
L. Product Owner merge approval — per `/CLAUDE.md`, "ChatGPT approved
   this" is never itself permission to merge.
M. Railway deployment (merge to `main` **is** the deploy, per
   `/CLAUDE.md`). **Deploying the reconciliation route performs no
   reconciliation itself** — the route existing and being deployed is
   necessary before F (below) can run, but deployment alone makes zero
   database writes related to reconciliation; the route only acts on an
   explicit authenticated request.
N. Production smoke tests (§10).
O. **Production reconciliation GET — DRY RUN ONLY** (§6), now correctly
   sequenced *after* deploy, since the route must actually exist and be
   running in production first. Read-only, zero writes.
P. Independent review of the dry-run results / manual spot-checks (§6).
Q. **Separate, explicit approval before any reconciliation apply** — a
   fully distinct decision from B, and from P — not implied by either.
R. Reconciliation **apply** (only after Q; not proposed as runnable
   anywhere in this packet).
S. **Post-apply verification** — re-run the GET dry run and confirm the
   applied changes match what was reviewed in P/Q; spot-check a sample of
   affected accounts directly.
T. HMAC enablement — **only** after the corrected provider
   delivery/signature validation sequence in §5, independently of and
   well after the main deployment (M); not a blocking step for M or for
   any reconciliation step (O–S).
U. Final cleanup/closeout — admin-role soak monitoring continues (§8);
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
- [ ] Run `SHOW server_version;` against the production database and
      confirm it is PostgreSQL 11 or later — the version where
      `ADD COLUMN ... DEFAULT` became a metadata-only operation instead of
      a full-table rewrite (§2e). **Not run in this session** — this
      remains a required pre-SQL gate specifically so §2e's "fast,
      metadata-only" characterization is confirmed against the real
      target, not assumed from general Postgres behavior.
- [ ] **Added in Revision 3:** the migration is scheduled for a
      controlled, low-traffic window, and the executing session will set
      a short `lock_timeout` (e.g. 5s) before running the `ALTER
      TABLE`/`CREATE TABLE` statements, so the migration fails fast
      rather than queuing indefinitely behind a conflicting lock (§3).

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

### Must be TRUE before merge/deploy (§11-I through M)

- [ ] Schema (§2g) has been applied and verified in production (§3).
- [ ] Admin role backfill (§2g/§11-E) has been applied and verified
      (exactly 1 row with `role='admin'`).
- [ ] Required Railway env vars (§4) are configured, **including
      `REVENUECAT_PRO_ENTITLEMENT_ID=GasCap Pro`** (corrected in this
      revision — this is required, not optional; its absence blocks every
      RC-dependent Sprint 2 code path from functioning).
- [ ] `hardening/sprint-2` has been synced with current `origin/main` via
      a normal merge (§11-G) — not performed as part of this revision.
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run
      check:crons`, and `npx prisma validate` all pass at the exact
      **post-merge** commit being submitted for PR (see §"Test/build
      status" at the end of this packet for the values as of the Review
      Target SHA `e07bd08` — those results predate the §11-G sync and
      MUST be re-verified fresh at whatever commit actually gets merged).
- [ ] PR has been opened, reviewed, and approved per §11-I through L.
- [ ] Don has given explicit merge approval — per `/CLAUDE.md`, "ChatGPT
      approved this" is never itself permission to merge.

---

## 13. Open Risks / Unresolved Items

| # | Risk | Rank | Status |
|---|---|---|---|
| 1 | RevenueCat v2 client's exact response shapes have now been LIVE-validated in SANDBOX (unknown/Lifetime/subscription paths all confirmed per this task's summary) but **not yet against PRODUCTION RevenueCat traffic** | Medium | Live-tested in sandbox only; production behavior is very likely identical (same API, same project) but not independently confirmed |
| 2 | ~~HMAC scheme implements a reported spec~~ **RESOLVED in Revision 2** — independent review confirmed the implemented scheme matches RevenueCat's current official documentation exactly (§5). Remaining gap is narrower: no LIVE signed delivery has been processed yet. | Low (downgraded from Medium) | `REVENUECAT_HMAC_SECRET` remains unset until the corrected §5 sequence is completed; no production risk while unset |
| 3 | No production database backup/snapshot freshness was confirmed in this session before proposing schema changes | Medium | Standard practice, not verified here — should be confirmed as part of §12's pre-SQL checklist |
| 4 | ~~Postgres `ADD COLUMN DEFAULT` behavior unclear~~ **CLARIFIED in Revision 2** — confirmed metadata-only on Postgres 11+, no full-table rewrite (§2e). Remaining gap is narrower: GasCap's actual production Postgres version has not been confirmed. | Low | `SHOW server_version;` added as an explicit pre-SQL gate in §12 |
| 5 | AMOE read path still reads the file, not the database — a real production entry count has never been confirmed reconciled, since this dev environment can't read the Railway volume | Medium | Intentionally deferred (§9); the file remains authoritative and safe in the meantime; no data-loss risk from this specific gap |
| 6 | `docs/ADMIN_AUTH_MIGRATION.md` contains a stale claim (legacy-path warning logging "not added yet," when it already exists in code) | Low | Documentation drift only, no functional impact; not corrected in this packet (out of scope — review only) |
| 7 | No `.env.example` exists — no single source of truth in-repo for the complete list of required production variables | Low | Operational convenience gap, not a correctness risk; the variables are individually documented across code comments and this packet |
| 8 | `suspected_legacy_rc_contamination` candidates, if any exist in production, have no built-in remediation path — only manual, one-off action | Low | Deliberate scope decision (§7); not blocking, since the tool correctly does nothing automatic here |
| 9 | ~~GitHub CI's actual scope not independently confirmed~~ **RESOLVED in Revision 2** — `.github/workflows/ci.yml` read directly and confirmed: triggers on PRs to `main` and on pushes to `hardening/**` (and `feat/**`/`fix/**`); runs `npm run check:crons`, `npm test`, `npx tsc --noEmit`, `npm run build` in that order. | Closed | CI scope is now a confirmed, real gate for §11-J |
| 10 | `admin` role backfill (Don's account) has not been applied to production — until it is, the session-based admin login has no effect for anyone, silently falling back to the password prompt (safe, but not the intended end state) | Low | Expected, staged step (§2g/§8/§11), not itself a risk beyond "not yet done" |
| 11 | The production reconciliation dry run itself has never been run against real production data — every test to date is against mocked dependencies (unit tests) or the live RevenueCat sandbox API directly (not through GasCap's DB) | Medium | This is a later step in the corrected §11 sequence, explicitly not taken in this packet |
| 12 | **NEW in Revision 2:** `REVENUECAT_PRO_ENTITLEMENT_ID` was incorrectly documented as optional in Revision 1; the code's `'pro'` default is confirmed wrong for GasCap's real project (the actual value is `GasCap Pro`) | High (was undiscovered in Revision 1) | Corrected throughout this revision (§4, §5); must be set in Railway before Sprint 2 deploy — see §11/§12 |
| 13 | **NEW in Revision 2:** `hardening/sprint-2` has not yet absorbed `origin/main`'s separately-merged iOS trial hotfix (`3ff6426`, PR #2) — the branches have diverged since the packet's original merge-base | Medium | Required pre-PR sync step added to §11 (normal merge, not rebase); not performed as part of this documentation-only revision |

---

## Final Summary (Revision 3)

- **Review Target / code SHA:** `e07bd0865388534903b7fb54c6c746ab6697782c`
  (branch `hardening/sprint-2`) — the application code this packet's
  findings describe. Unchanged since Revision 1; Revisions 2 and 3 are
  both documentation/comment corrections (Revision 2: the HMAC doc-comment
  fix; Revision 3: this round's `lib/revenueCatHmac.ts` timestamp-wording
  fix and the `docs/migrations/2026-08-sprint2-schema.sql` comment
  corrections) — no behavioral code change in either revision, and neither
  re-targets a different code state.
- **`hardening/sprint-2` branch HEAD at the time this revision's packet
  document itself was committed:** will be one commit past Revision 2's
  packet commit (`dfd38a9`) — see the task-level report for this
  revision's exact commit SHA, since a document cannot self-reference the
  SHA of the commit that contains it.
- **Revision 1 packet commit:** `8dad1b8`.
- **Revision 2 packet commit:** `dfd38a9` (superseded by this revision).
- **`main` HEAD SHA (for comparison):** `3ff64267d69e3e6d0a4a155fd6ea8792be183943`
  — this now includes the iOS trial hotfix (PR #2, `3ff6426`) that
  `hardening/sprint-2` does not yet have; see §11-G and §13 risk #13.
  Unchanged since Revision 2 — `origin/main` was not re-fetched for this
  documentation-only revision, since nothing in this round's corrections
  depends on it having moved further.

**Exact files reviewed for this packet** (read directly, this session):
`prisma/schema.prisma` (full diff against merge-base `39de76a`),
`docs/migrations/2026-08-sprint2-schema.sql`,
`docs/migrations/2026-08-sprint2-amoe-backfill.md`,
`lib/adminAuth.ts`, `docs/ADMIN_AUTH_MIGRATION.md`,
`lib/rateLimitDb.ts`, `lib/revenueCatHmac.ts`,
`app/api/native/revenuecat/route.ts` (HMAC/auth sections),
`lib/entitlements.ts`, `lib/revenueCatApi.ts` (entitlement lookup key
resolution),
`lib/revenueCatHistoricalReconciliation.ts` (module doc comment +
`applyReconciliation`'s `data`-payload construction, grepped for every
`stripeInterval` reference),
`app/api/admin/revenuecat-historical-reconciliation/route.ts`,
`.github/workflows/ci.yml` (Revision 2 — confirmed CI scope directly),
`README.md` (Persistence inventory section),
`.env.local` (existence-only check per variable, no values read/printed),
`.gitignore`, full `git log`/`git diff` history since the merge-base,
including `origin/main`'s current state (`3ff6426`, confirmed to include
PR #2's iOS hotfix merge).

**Exact proposed production actions — NONE EXECUTED, all clearly marked
above:**
1. The additive schema SQL in §2g (`ALTER TABLE`/`CREATE TABLE`/`CREATE INDEX`) — **NOT EXECUTED**.
2. Don's admin-role `UPDATE` (§2g, separate) — **NOT EXECUTED**.
3. Railway environment variable configuration (§4), including the
   corrected **required** `REVENUECAT_PRO_ENTITLEMENT_ID=GasCap Pro` — **NOT PERFORMED**.
4. RevenueCat dashboard HMAC configuration (§5) — **NOT PERFORMED**.
5. Production reconciliation dry-run GET call (§6) — **NOT EXECUTED** (and
   per the §11 correction, not runnable-as-meaningful until after Sprint 2
   is deployed — the route doesn't exist on current `main`).
6. Any reconciliation apply — **NOT EXECUTED, not even proposed as runnable in this packet**.
7. `git merge origin/main` into `hardening/sprint-2` (§11-G) — **NOT PERFORMED** as part of this documentation-only revision.
8. PR open / merge / deploy — **NOT PERFORMED**.
9. **This revision's own edits** — comment/wording corrections only, to
   `docs/reviews/2026-08-19-hardening-sprint-2-production-preflight.md`,
   `docs/migrations/2026-08-sprint2-schema.sql`, and
   `lib/revenueCatHmac.ts`. No `ALTER TABLE`/`CREATE TABLE` statement text
   changed (verified via `git diff ... | grep -E "^\+ALTER|^\+CREATE|^\-ALTER|^\-CREATE"`
   returning empty for the migration file), and no logic in
   `verifyRevenueCatHmac` or `TIMESTAMP_TOLERANCE_MS` changed — **NOTHING
   EXECUTED, NOTHING BEHAVIORAL**.

**Test/build status, re-verified fresh in this session for Revision 3**
(re-run after this round's comment-only edits, since `lib/revenueCatHmac.ts`
was touched; still at the unchanged Review Target SHA `e07bd08` plus this
revision's comment-only commit — pre-dating the required §11-G branch
sync, which must still be re-verified fresh at the post-merge commit
before that commit is actually submitted for PR, per §12):
```
node --check scripts/revenuecat-smoke-test.mjs → syntax OK
npx tsc --noEmit    → clean, no output, exit 0                    [re-run this revision]
npm test            → Test Files: 30 passed (30) / Tests: 451 passed (451)  [re-run this revision]
npm run build       → succeeded (full Next.js production build)  [carried over from Revision 2 — this
                       revision's edits are comments/wording only in .ts/.sql/.md files with no import-
                       graph or bundling impact, so a fresh full build was judged unnecessary; tsc
                       --noEmit and the test suite were re-run because they're fast and directly cover
                       the touched .ts file]
npm run check:crons → ✓ cron inventory: 19 routes, 17 scheduled, 2 exempt  [carried over from Revision 2, unaffected by this revision's edits]
npx prisma validate → The schema at prisma/schema.prisma is valid 🚀       [carried over from Revision 2 — .sql migration file is a proposed script, not the Prisma schema itself, so this revision's edits to it don't affect prisma validate]
```

**Revision 3 changes from Revision 2, summarized:** all four
documentation/comment corrections this round requested were applied —
§3's required-order list now configures Railway env vars (step 4) before
deploy (step 5), matching §11's already-corrected sequence; the `role`
column's migration comments (top-of-file and inline) now distinguish
logical read-default from PostgreSQL 11+'s metadata-only physical write,
name the brief `ACCESS EXCLUSIVE` DDL lock explicitly (a real gap §2e's
own title had promised but not delivered), and recommend a low-traffic
window with a short `lock_timeout`; §5's HMAC timestamp-tolerance wording
no longer implies RevenueCat "expects" a tolerance, matching RevenueCat's
actual optional/example-value framing (code behavior — the 5-minute
`TIMESTAMP_TOLERANCE_MS` — is unchanged); and §3's rollback/forward-fix
wording now correctly ties code-rollback risk to whether RevenueCat
provider-state fields have actually been written, not to whether the
admin-role backfill has run. Nothing about the underlying release
sequence, risk ranking, or required pre-deploy steps changed as a result
— this revision corrects internal accuracy and consistency, it does not
change what must happen before deploy.

**Recommendation:**

# READY FOR FINAL PREFLIGHT APPROVAL

Every correction from both independent review rounds has been applied and
cross-checked for consistency: `REVENUECAT_PRO_ENTITLEMENT_ID` is
documented as required with its actual value (`GasCap Pro`) and now
correctly ordered before deploy in both §3 and §11; the reconciliation
dry run correctly follows deployment, not precedes it; the HMAC section
reflects the confirmed-correct specification, the corrected
enable-then-test ordering, and now-accurate timestamp-tolerance wording;
the required `origin/main` branch-sync step is documented; CI scope is
confirmed rather than flagged unknown; the Postgres `ADD COLUMN DEFAULT`
wording correctly separates the (non-)rewrite question from the DDL lock
question, with both a version gate and a lock-timeout/low-traffic-window
recommendation; SHA terminology throughout distinguishes the reviewed
code state from the packet's own documentation commits across all three
revisions; and the rollback-safety wording no longer misattributes risk
to the admin-role backfill. No production action was taken to produce
this revision — every change across all three revisions has been
comments, wording, and documentation only, confirmed by direct `git diff`
inspection showing zero SQL statement or executable-logic changes. Every
schema change remains additive, nullable-or-inert by default, with an
exact proposed (not executed) SQL statement. Every historical-data safety
rule remains verified by direct code inspection — most notably that
`stripeInterval` is structurally never written by the bulk reconciliation
apply path. `npx tsc --noEmit` and the full test suite (451 tests, 30
files) were re-run fresh against this revision's edits and pass cleanly.
The open risks in §13 are real but are either Low-rank operational gaps
or Medium-rank items whose next concrete step is explicitly a later stage
of the corrected release sequence (§11-G onward — branch sync, then
deploy, then §11-O's dry run) — not blockers to this packet being
considered complete and internally consistent for a final independent
review pass before Don's own release-sequence execution begins.

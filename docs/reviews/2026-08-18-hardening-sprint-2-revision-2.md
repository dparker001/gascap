# ChatGPT Review Packet — Hardening Sprint 2, REVISION 2

Response to "CHATGPT INDEPENDENT REVIEW — HARDENING SPRINT 2, STATUS:
REQUEST CHANGES." Every numbered finding from that review is addressed
below. **Not merged. No PR opened. No production SQL applied.**

---

## 1. Objective

ChatGPT independently reviewed the `hardening/sprint-2` branch (not just the
Revision 1 packet) and returned 15 numbered findings, 7 marked P0. This
packet documents what changed in response, so ChatGPT can review Revision 2
before Don authorizes the production schema migration or opens the PR.

## 2. Repository State

- **Branch:** `hardening/sprint-2`
- **Review Target SHA:** `78d3c14` (HEAD)
- **Base branch:** `main`, at `39de76a`
- **Prior Revision 1 packet:** `docs/reviews/2026-08-18-hardening-sprint-2.md`
  (renamed from `2026-08-19-...` — see finding 13)
- **Relevant PR:** none. Not opened, per instruction.
- **Review this diff:** `git diff --name-status main...hardening/sprint-2`,
  66 files, pasted verbatim in §4.
- **Commits since Revision 1** (`6f77811`): two —
  `b096ec2` (the substantive Revision-1-finding fixes) and `78d3c14`
  (an unrelated, independently-discovered fix to `app/rewards/page.tsx`'s
  Dining Voucher fee disclosure, committed separately since it's a distinct
  concern from this review).

## 3. Findings and responses

### Finding 1 (P0) — Entitlement provenance corruption

**Confirmed exactly as described.** Root cause, read directly in the code
before fixing:

- `app/api/native/revenuecat/route.ts`'s grant call passed `interval` (RC's
  own interval) as the top-level `stripe.interval` param to `setUserPlan()`,
  which writes straight into `stripeInterval` — the same field
  `resolveUserEntitlements()` reads as Stripe/gift Lifetime provenance.
- `revokeRevenueCatEntitlement()` / `revokeStripeSubscriptionEntitlement()`
  both wrote `resolved.effectiveInterval` (the resolver's own aggregate
  output) back into `stripeInterval` on a "stay Pro" outcome.

**Fix — Option A from the two offered, chosen after a full `stripeInterval`
consumer search** (`grep -rn "stripeInterval"` across the repo, ~50
call sites reviewed): keep `stripeInterval` strictly as Stripe/gift
provenance, touched only by a genuine Stripe grant. Concretely:

- `app/api/native/revenuecat/route.ts`: the grant call now passes `interval`
  **only** inside the `revenueCat` sub-object, never at the top level.
- `setUserPlan()`'s doc comment now states the invariant explicitly:
  `stripe.interval` must never carry an RC-sourced value.
- `isRealPurchaseOrRenewal` (which previously also gated on `stripe.interval`
  to decide whether to end a trial) now separately checks
  `stripe.revenueCat?.active`, so an RC-only grant still correctly ends a
  trial without needing to touch `stripeInterval`.
- All three revoke functions (`revokeRevenueCatEntitlement`,
  `revokeStripeSubscriptionEntitlement`, and the new
  `revokeAmbassadorEntitlement` — see Finding 2) now write only `{ plan:
  'pro' }` on a "stay Pro" outcome, never anything derived from
  `resolved.effectiveInterval`.

**Why Option A over Option B (a new dedicated field):** the consumer search
found ~15 UI/business-logic call sites (getaway promo gating, checkout
founding-offer dedup, gift-redeem dedup, `winbackOffer`/`newMemberOffer`
eligibility, `integrity-check` queries) that already correctly intend
`stripeInterval === 'lifetime'` to mean "genuinely bought Lifetime via
Stripe/web" — separating provenance from a general "is this user
Lifetime" concept was already the CORRECT semantic for those consumers, not
a new requirement. A handful of pure-display consumers (PlanBadge,
WelcomeBanner, StreakRewards perks gating, the giveaway's Lifetime bonus
entries) will now under-recognize an RC-Lifetime-only purchaser as
"Lifetime" for display/bonus purposes — a real, but scoped and
lower-severity, follow-up (native iOS Lifetime purchasers not showing a
"Pro Lifetime" badge or earning the Lifetime giveaway bonus). **Flagged
explicitly, not fixed in this revision** — it's a UX/reward-completeness
gap, not an incorrect-grant or incorrect-revoke risk, and touching ~15
display call sites was judged out of scope for a review-response pass
focused on correctness. Named as a Known Risk in §7.

**Requirement checklist:**
- RevenueCat grant never overwrites Stripe/gift provenance — ✅ (fixed, see above)
- RevenueCat revoke clears only RevenueCat provenance — ✅ (already correct in Revision 1; unchanged)
- Stripe revoke clears only Stripe subscription provenance — ✅ (already correct; unchanged)
- Ambassador revoke clears only Ambassador provenance — ✅ (new function, Finding 2)
- Aggregate/display interval never written into a provenance field — ✅ (fixed)
- Genuine Stripe/gift Lifetime survives all unrelated RC events — ✅ (tested, see below)
- RevenueCat Lifetime alone becomes free after a valid refund with no other source — ✅ (tested, see below)

**Integration tests — `__tests__/entitlementProvenance.test.ts` (new, 11
tests), exercising the REAL `lib/users.ts` write paths against a mocked
Prisma (not the pure resolver, which was already correct and never caught
this bug):**

1. Stripe Lifetime → RC Monthly grant → RC expiration ⇒ Lifetime remains — ✅
2. Gift Lifetime → RC Monthly → RC expiration ⇒ Lifetime remains — ✅
3. RC Lifetime only → RC refund ⇒ Free — ✅
4. Stripe Monthly + RC Lifetime → Stripe deletion → RC refund ⇒ Free — ✅
5. Stripe Lifetime + RC Lifetime → RC refund ⇒ Stripe Lifetime remains — ✅
6. RC Monthly + Stripe cancellation ⇒ Pro via RC — ✅
7. Ambassador + Stripe Monthly → Stripe cancellation → revoke Ambassador ⇒ Free — ✅
8. Multiple valid sources removed one at a time ⇒ only final removal downgrades — ✅

Plus 3 additional tests: an RC grant never writes `stripeInterval` even for
an RC-lifetime product with no prior Stripe state; a genuine Stripe Lifetime
purchase still sets `stripeInterval`/`lifetimePurchasedAt`; an RC grant
still ends an active trial via the new `revenueCat.active` check.

### Finding 2 (P0) — Admin comp-Pro revocation bypassed the resolver

**Confirmed.** `app/api/admin/users/route.ts`'s `revokeCompProForLife`
branch wrote `ambassadorProForLife: false, plan: 'free'` directly.

**Fix:** new `revokeAmbassadorEntitlement(userId)` in `lib/users.ts`,
identical shape to the other two revoke functions — clears only
`ambassadorProForLife`, resolves from the fresh state, only downgrades if
`resolved.pro` is false. The admin route now calls this and reports
`remainedPro` in its response and audit-log metadata (`survivingSources`)
so an admin can see immediately if the user kept Pro via another provider.

**Regression coverage:** covered by `entitlementProvenance.test.ts` test 7
and test 8 above (Ambassador + surviving Stripe/RC source).

### Finding 3 (P0) — RevenueCat reclaim not atomic

**Confirmed.** The failed/stale-processing reclaim paths used
`findUnique()` then a plain `update()` — two concurrent reclaimers could
both read the same row and both "win."

**Fix — `RevenueCatWebhookEvent.claimToken` (new column) + atomic CAS via
`updateMany`:**

- Every successful claim (fresh `create()`, or a failed/stale reclaim) is
  assigned a fresh, unique `claimToken`.
- Reclaiming a `failed` row: `updateMany({ where: { id, status: 'failed' },
  data: { status: 'processing', claimToken: <new>, ... } })` — CAS on
  `status`. If a concurrent reclaimer already flipped it, `count === 0` and
  this caller backs off to `duplicate-in-flight`.
- Reclaiming a stale `processing` row: `updateMany({ where: { id, status:
  'processing', receivedAt: <the exact value just read> }, ... })` — CAS on
  BOTH `status` and the precise lease timestamp, so a concurrent reclaimer
  who already moved `receivedAt` forward causes this caller's `updateMany`
  to match zero rows.
- `markProcessed(eventId, claimToken)` / `markFailed(eventId, claimToken,
  error)` now both require `{ id, claimToken, status: 'processing' }` to
  match before writing — an old claimant whose ownership was superseded by
  a newer reclaim cannot overwrite the newer claimant's state, in either
  direction.
- The route (`app/api/native/revenuecat/route.ts`) threads `claimToken`
  from `claimEvent`'s result through to `markProcessed`/`markFailed`.

**Tests — `__tests__/revenueCatEvents.test.ts` (rewritten, 13 tests), using
a mock that evaluates real Postgres `updateMany` semantics against live row
state rather than sequential canned mock returns** (a queued-return-value
mock would not actually exercise the CAS logic — see the file's own header
comment for why):

- Two simultaneous failed-event reclaim attempts ⇒ exactly 1 claimed — ✅
- Two simultaneous stale-processing reclaims ⇒ exactly 1 claimed — ✅
- Old claimant cannot mark failed after a newer claimant processed — ✅
- Old claimant cannot mark processed after ownership changed — ✅
- (Plus the original 9 non-concurrency tests, all still passing.)

### Finding 4 (P0) — Guessed RevenueCat HMAC scheme

**Rewritten to the documented protocol** ChatGPT reported after
independently checking RevenueCat's current docs:

- Header: `X-RevenueCat-Webhook-Signature`
- Header format: `t=<unix_timestamp>,v1=<signature>`
- Signed message: `<timestamp>.<raw_request_body>`
- Algorithm: HMAC-SHA256, hex-encoded, constant-time compared
  (`crypto.timingSafeEqual`)
- Added timestamp-tolerance replay protection (5-minute window)

**Honesty note carried forward, not removed:** this implementation is based
on ChatGPT's reported findings from RevenueCat's docs, not something
independently re-browsed and confirmed from this environment (which still
cannot reach RevenueCat's live dashboard). The file's header now states this
precisely rather than claiming the scheme is "unknown" (which Finding 4
correctly said should be removed) — it distinguishes "the scheme is now
believed correct, sourced from an independent check" from "verified
firsthand," and keeps `REVENUECAT_HMAC_SECRET` unset-by-default with the
same 3-step pre-production verification checklist as before (confirm
signing is enabled in RC's dashboard, send a real test delivery, only then
set the secret in Railway). `req.text()` first, preserved as directed.

**Tests — `__tests__/revenueCatHmac.test.ts` (rewritten against the new
scheme, 11 tests):** valid signature, wrong secret, missing header,
malformed header structure, malformed hex, stale timestamp rejected,
timestamp-within-tolerance accepted, tampered body rejected, tampered
timestamp-with-reused-signature rejected, empty body doesn't throw, no-op
when unconfigured.

### Finding 5 (P0) — event.id caveat

**Caveat removed**, per ChatGPT's independent confirmation that `event.id`
is an always-present, documented field RevenueCat recommends for dedup. The
route's `RcEvent.id` doc comment and the idempotency block's comment were
rewritten to state this as confirmed.

**Fail-safe behavior for a missing id on an actionable event, per the
review's explicit ask:** previously fell through to processing
unconditionally. Now: a GRANT/REVOKE event with no `id` is treated as
anomalous (contradicts the provider's own documented contract) and is
**skipped** — logged loudly, returns `{ ok: true, skipped:
'missing_event_id' }` (200, not 5xx, so RevenueCat doesn't retry a payload
that will never gain an id). This is a deliberate behavior change from
"process without idempotency" to "refuse to process" — documented in the
code as the exact decision point, and covered by a rewritten test
(`revenuecatWebhook.test.ts`, "an actionable event with no id is now
REJECTED").

### Finding 6 (P0/P1) — External side-effect semantics

**Two changes:**

1. **Durable marker for the highest-consequence one-time effect.** New
   `User.getawayChooseEmailSentAt` column, claimed atomically
   (`updateMany({ where: { id, getawayChooseEmailSentAt: null } })`)
   immediately before `maybeSendGetaway` sends anything. This closes exactly
   the scenario named in the review ("send getaway email → crash before
   markProcessed → retry re-sends") — the claim, not the event-level
   idempotency, is what now prevents the duplicate. New test file
   `__tests__/revenuecatGetawayIdempotency.test.ts` (3 tests): genuine first
   purchase sends the email; a retry of the same event (simulating the
   named crash window) does NOT send a second buyer email; a different
   user's claim is unaffected by another user's.
2. **Honest documentation of the remaining fire-and-forget effects** — a new
   header block in `app/api/native/revenuecat/route.ts` states plainly
   which side effects are durably one-time (the getaway email, now), which
   are protected by a narrower non-atomic user-state check (the welcome
   email / paid-campaign enrollment — `!user.paidCampaignEnrolledAt`, a
   read-then-act check, not a durable claim), and which are pure
   best-effort with no dedup at all (push notifications, admin
   notifications) — with the actual crash-window truth spelled out for each
   tier, and an explicit note that future consequential one-time effects
   should get the same atomic-claim treatment, not be assumed covered by
   event-level idempotency. A full outbox pattern was considered and
   explicitly deferred as disproportionate to this review's scope — the one
   effect that actually needed durability got it directly.

### Finding 7 (P0) — Admin session auth coverage

**Concrete miss confirmed and fixed:** `POST /api/announcements` was
legacy-header-only. Now dual-auth, matching its own `GET ?all=1` branch.
Regression test added (`__tests__/announcementsRoute.test.ts`, 5 tests,
including "THE FIX: allows an admin session with NO legacy header at all").

**Full re-audit performed, per the acceptance criterion:** `grep -rn
"x-admin-password.*===|=== .*x-admin-password|header === pw|..." app/api
--include="route.ts"` — **zero matches** after the fix (verified again
just before writing this packet). Every one of the 21 previously-widened
routes' local `auth()` helper now calls a new shared
`legacyAdminPasswordOk(req, configuredSecret)` in `lib/adminAuth.ts`
instead of reimplementing the comparison inline.

**Centralization decision — not a full `requireAdmin()` migration, and why:**
ChatGPT's strong preference was full centralization through `requireAdmin()`
everywhere. Several of the 21 routes return a 3-state `'ok' | 'no-env' |
'wrong'` for a distinct "misconfigured" HTTP status that `requireAdmin()`
doesn't produce, and restructuring 21 routes' control flow (several of
which send campaign emails, run the sweepstakes draw, or delete accounts) is
real risk for a review-response pass. Instead: the ONLY previously
duplicated, security-relevant logic — the raw secret comparison itself, and
the legacy-path observability log — is now centralized in one function,
called by all 21 routes' still-separate `auth()` wrappers. This closes both
concrete problems the review named (non-constant-time comparison,
`requireAdmin()`'s warning log not observing routes that bypassed it) without
the higher-risk restructuring. `legacyAdminPasswordOk` gained its own 6 new
tests in `__tests__/adminAuth.test.ts`, including one asserting it logs on
success and not on failure (closing the exact observability gap named).

### Finding 8 (P1) — Rate-limiter window-rollover race

**Confirmed and rewritten.** The `findUnique()` → decide-in-application-code
→ `upsert()` sequence is replaced with a single atomic
`INSERT ... ON CONFLICT ("key") DO UPDATE SET ...` (`prisma.$queryRaw`
tagged template, safely parameterized), with the expiry check itself
(`"resetAt" <= now`) evaluated as a `CASE` inside the same SQL statement —
no window exists between reading and deciding for a second request to land
in.

**`RateLimitCounter.resetAt` changed `String` → `DateTime`**, per the
review's suggestion — the table had not been deployed to production, so
this carries no migration-data risk. Matches Postgres `TIMESTAMP(3)`,
Prisma's default mapping (consistent with the schema's other unannotated
`DateTime` fields).

**Tests — `__tests__/rateLimitDb.test.ts` (rewritten, now 19 tests total,
9 new concurrency-specific):**

- Concurrent brand-new key ⇒ both counted, none lost — ✅
- Concurrent active window ⇒ both increments land — ✅
- Concurrent EXACT window rollover ⇒ exactly one reset, the other
  increments the NEW window (this is the precise assertion that would have
  failed against the old implementation) — ✅
- Exactly `limit` allowed, `limit+1` denied, including under concurrent
  arrival — ✅
- Plus the original 7 sequential-correctness tests, unchanged in intent.

The mock emulates the single atomic statement as one synchronous table
mutation per call — a faithful emulation given the fix's entire premise is
that Postgres's own atomicity guarantee (not JS-level ordering) is what
makes this safe; see the test file's header for the reasoning.

### Finding 9 (P1) — Trusted client-IP signal

**Fixed.** New `lib/clientIp.ts`, `getTrustedClientIp(req)`: prefers
`X-Real-IP` (Railway's documented trusted header), falls back to
`X-Forwarded-For` only when `X-Real-IP` is absent. Applied to both
Sprint-2-introduced rate-limited routes (`forgot-password`, `otp/send`) —
the two the review named. Pre-existing routes with the same old
XFF-preferred pattern (`register`, sign-in via `lib/auth.ts`) were **not**
touched — they predate Sprint 2, use the separate in-memory limiter, and
were judged out of this review-response's scope; noted as a follow-up in
§7 rather than silently left unaddressed.

**Safe behavior when no trusted IP exists at all:** the IP-layer rate-limit
check is **skipped** for that single request (the email-layer check still
applies) rather than falling back to one shared `'unknown'` bucket — a
shared bucket would let one client with no IP headers lock out every other
such client under the same limit, which is worse than temporarily skipping
one layer of protection for a request that shouldn't occur behind Railway's
edge in practice. 5 new tests in `__tests__/clientIp.test.ts`.

### Finding 10 (P1) — Rate-limit PII / retention

**Both parts fixed:**

1. **Hashing.** New `hashRateLimitIdentifier()` in `lib/rateLimitDb.ts` —
   deterministic SHA-256 of the normalized email, applied to both
   `pwreset-email:*` and `otp-send-email:*` keys before they become durable
   Postgres rows. Documented explicitly as NOT HMAC'd with a secret (table
   hygiene against casual plaintext exposure, not a defense against a
   determined dictionary attack) — a documented tradeoff, not an oversight;
   the header comment states when a stronger guarantee (HMAC with a
   dedicated secret) would be warranted. IP keys were left unhashed — the
   review named emails specifically, and IPs are already commonly logged
   elsewhere in this app unhashed.
2. **Retention.** New `GET /api/cron/cleanup-rate-limits`, CRON_SECRET-gated,
   deletes `RateLimitCounter` rows whose window closed more than 24h ago.
   Added to `.github/workflows/crons.yml` (daily, 21:00 UTC) and to
   `npm run check:crons`'s inventory (still passes — 19 routes, 17
   scheduled, 2 exempt). 4 tests in `__tests__/cleanupRateLimits.test.ts`
   (fails closed with no secret, rejects wrong secret, deletes with the
   correct ~24h cutoff, returns 500 rather than throwing on a DB error).

### Finding 11 (P1) — AMOE reconciliation

**Both problems fixed.**

1. **Real reconciliation, not a count match.** `backfillAmoeEntries()`
   rewritten to build a map of existing DB rows keyed by
   `(email, month)`, compare each file entry against it (missing vs. present
   vs. present-with-different-fields), and after inserting, compute
   `missingInDb` / `extraInDb` / `fieldMismatchCount` explicitly.
   `verified` is now `missingInDb === 0 && extraInDb === 0 &&
   fieldMismatchCount === 0` — genuinely proving the two datasets match, not
   just that they're the same size. The admin endpoint's response and
   message were updated to surface all four fields plus `verified`.
2. **Concurrency-safe insert.** The per-row `findUnique()` → `create()` race
   is replaced with a single atomic `createMany({ data: missing,
   skipDuplicates: true })` — one `INSERT ... ON CONFLICT DO NOTHING`
   statement, safe for concurrent or repeated invocation by construction.
3. **Doc wording corrected**, exactly as instructed: no longer says every
   submission "lands in BOTH" — now states "the file is authoritative, a
   PostgreSQL mirror is attempted for every successful submission; any
   missed mirrors are recoverable by backfill," in both
   `lib/amoeEntriesDb.ts`'s header and
   `docs/migrations/2026-08-sprint2-amoe-backfill.md`.
4. **Draw read path still NOT cut over** — unchanged from Revision 1,
   per the explicit instruction to leave this alone.

**Tests — `__tests__/amoeEntriesDb.test.ts` (rewritten, 12 tests)**,
including two specifically targeting the review's core complaint: a
same-count-but-different-content scenario (an extra DB row the file doesn't
have, same total size) correctly reports `verified: false`, and a
field-level mismatch on a matching key is detected and does NOT get
silently overwritten.

### Finding 12 — Migration SQL cleanup

- **"3 new tables" → 4**, corrected against a fresh count of
  `prisma/schema.prisma` (not trusted from the prior file's own count, per
  the repo's own standing rule about re-running counts).
- **`role DEFAULT 'user'` wording clarified** — the file now explicitly
  states this DOES write a real value to every existing row (the column
  didn't exist before), while narrowing the true claim to "no row's
  *effective application behavior* changes."
- **`RateLimitCounter.resetAt`** updated to `TIMESTAMP(3)` in the SQL,
  matching the schema change.
- **`claimToken`** added to the `RevenueCatWebhookEvent` `CREATE TABLE`.
- **`getawayChooseEmailSentAt`** added as a new `User` column (Finding 6's
  fix).
- Don's admin-role backfill kept explicit and separate, unchanged.
- **Still not run against production.**

### Finding 13 — Review-packet date

**Fixed.** Renamed `2026-08-19-hardening-sprint-2.md` →
`2026-08-18-hardening-sprint-2.md` (today is 2026-08-18). Checked every
other Sprint 2 doc for the same error — `docs/ADMIN_AUTH_MIGRATION.md`,
`docs/SECURITY_AUDIT.md`, `docs/RATE_LIMITING_PLAN.md`, `docs/SYSTEM.md`,
`docs/migrations/2026-08-sprint2-amoe-backfill.md`,
`docs/migrations/2026-08-sprint2-schema.sql`, and the (now-abandoned)
`docs/SWEEPSTAKES_WEEKLY_TIER_DRAFT.md` all had the same `2026-08-19` "today"
stamp — all corrected. Verified via a final grep with zero remaining hits.

## 4. Files Changed

```
git diff --name-status main...hardening/sprint-2
```

```
M	.github/workflows/crons.yml
M	CLAUDE.md
M	README.md
A	__tests__/adminAudit.test.ts
A	__tests__/adminAuth.test.ts
A	__tests__/amoeEntriesDb.test.ts
A	__tests__/announcementsRoute.test.ts
A	__tests__/cleanupRateLimits.test.ts
A	__tests__/clientIp.test.ts
A	__tests__/entitlementProvenance.test.ts
A	__tests__/entitlements.test.ts
A	__tests__/rateLimitDb.test.ts
A	__tests__/revenueCatEvents.test.ts
A	__tests__/revenueCatHmac.test.ts
A	__tests__/revenuecatGetawayIdempotency.test.ts
M	__tests__/revenuecatWebhook.test.ts
M	app/admin/analytics/page.tsx
M	app/admin/page.tsx
A	app/api/admin/amoe-backfill/route.ts
M	app/api/admin/analytics/route.ts
M	app/api/admin/campaigns/route.ts
M	app/api/admin/deleted-accounts/route.ts
M	app/api/admin/email-log/route.ts
M	app/api/admin/email-preview/route.ts
M	app/api/admin/email-retry/route.ts
M	app/api/admin/feedback/route.ts
M	app/api/admin/founding-member-blast/route.ts
M	app/api/admin/ghl-backfill/route.ts
M	app/api/admin/gifts/route.ts
M	app/api/admin/push-test/route.ts
M	app/api/admin/rental-pilot/[id]/route.ts
M	app/api/admin/rental-pilot/route.ts
A	app/api/admin/revenuecat-events/route.ts
M	app/api/admin/reviews/route.ts
M	app/api/admin/send-d1/route.ts
M	app/api/admin/sweepstakes/route.ts
M	app/api/admin/users/route.ts
M	app/api/amoe/route.ts
M	app/api/announcements/route.ts
M	app/api/auth/forgot-password/route.ts
A	app/api/cron/cleanup-rate-limits/route.ts
M	app/api/native/revenuecat/route.ts
M	app/api/otp/send/route.ts
M	app/api/push/broadcast/route.ts
M	app/api/push/digest/route.ts
M	app/api/push/fillup-reminder/route.ts
M	app/api/stripe/webhook/route.ts
M	app/rewards/page.tsx
M	docs/ADMIN_AUTH_MIGRATION.md
M	docs/RATE_LIMITING_PLAN.md
M	docs/SECURITY_AUDIT.md
M	docs/SYSTEM.md
A	docs/migrations/2026-08-sprint2-amoe-backfill.md
A	docs/migrations/2026-08-sprint2-schema.sql
A	docs/reviews/2026-08-18-hardening-sprint-2.md
A	lib/adminAudit.ts
A	lib/adminAuth.ts
A	lib/amoeEntriesDb.ts
A	lib/clientIp.ts
A	lib/entitlements.ts
D	lib/pushSubscriptions.ts
A	lib/rateLimitDb.ts
A	lib/revenueCatEvents.ts
A	lib/revenueCatHmac.ts
M	lib/users.ts
M	prisma/schema.prisma
```

(66 files — generated mechanically, pasted verbatim.)

## 5. Testing Performed

All four commands run from `hardening/sprint-2` at HEAD (`78d3c14`)
immediately before writing this packet:

```
npm test            → 282 passed (23 test files), 0 failed
npx tsc --noEmit     → clean, no output
npm run build        → ✓ Compiled successfully
npm run check:crons  → ✓ cron inventory: 19 routes, 17 scheduled, 2 exempt
npx prisma validate  → The schema at prisma/schema.prisma is valid
npx prisma generate  → ✔ Generated Prisma Client (7.7.0)
```

New/changed test files this revision: `entitlementProvenance.test.ts` (new,
11), `revenueCatEvents.test.ts` (rewritten, 13), `revenueCatHmac.test.ts`
(rewritten, 11), `revenuecatWebhook.test.ts` (updated for the new
`claimToken`/fail-safe-missing-id behavior, 27), `revenuecatGetawayIdempotency.test.ts`
(new, 3), `adminAuth.test.ts` (extended with `legacyAdminPasswordOk`
coverage, 16 total), `announcementsRoute.test.ts` (new, 5),
`rateLimitDb.test.ts` (rewritten for the atomic implementation + concurrency,
19), `clientIp.test.ts` (new, 5), `cleanupRateLimits.test.ts` (new, 4),
`amoeEntriesDb.test.ts` (rewritten for real reconciliation, 12).

## 6. Explicit Statement: No Production Database Changes Occurred

No `ALTER TABLE`, `CREATE TABLE`, or any other DDL/DML was executed against
the production database at any point in this revision. The schema changes
described above exist only in `prisma/schema.prisma` and
`docs/migrations/2026-08-sprint2-schema.sql`, not yet applied. No `git push
--force`. No merge to `main`. No PR opened. Branch pushed to
`origin/hardening/sprint-2` for backup/visibility only.

## 7. Known Risks / Remaining Questions

**New, from this revision's own tradeoffs (named explicitly, not hidden):**

- RC-Lifetime-only native IAP purchasers will not show a "Pro Lifetime"
  badge in the UI or earn the giveaway's Lifetime bonus entries, since those
  ~4 display/reward consumers still read only `stripeInterval` (see Finding
  1's Option A discussion). Not a wrongful-grant or wrongful-downgrade risk
  — a UX/reward-completeness gap for a real but currently small user
  segment (native iOS Lifetime buyers). Recommend a follow-up pass migrating
  those specific consumers to check `stripeInterval === 'lifetime' ||
  (revenueCatActive && revenueCatInterval === 'lifetime')`.
- `register`'s and sign-in's rate limiters still prefer
  `X-Forwarded-For` over `X-Real-IP` — same bug class as Finding 9, but
  those routes predate Sprint 2 and use the separate in-memory limiter;
  judged out of this review-response's scope, not silently missed.
- The RevenueCat HMAC scheme is now believed correct based on an
  independent report of RevenueCat's docs, not independently re-browsed
  from this environment. Still off by default; still needs a real test
  delivery before enabling in production.
- IP-based rate-limit keys remain unhashed (only the email component was
  hashed, per the review's specific wording). If IP-level PII exposure ever
  becomes a concern, the same `hashRateLimitIdentifier` pattern extends
  trivially.

**Carried forward, unchanged from Revision 1:**

- Legacy `ADMIN_PASSWORD` header path still fully live (intentional
  staging — steps 5/6 of `docs/ADMIN_AUTH_MIGRATION.md` not started).
- AMOE draw read path still reads the file, not the `AmoeEntry` table
  (explicitly out of scope again this revision).
- `support` role not built (not needed).

## 8. Claude's Assessment

**READY WITH KNOWN CONCERNS**, unchanged assessment tier from Revision 1 but
now covering a materially stronger foundation — every P0 finding from the
independent review has a concrete fix with regression coverage, not just a
design response. The two items in §7 marked "new, from this revision's own
tradeoffs" are the honest remaining gaps: a scoped UX/reward-completeness
issue for RC-Lifetime IAP buyers, and two pre-existing routes sharing
Finding 9's IP-header bug that weren't in this revision's explicit scope.
Neither is a wrongful-grant, wrongful-downgrade, or auth-bypass risk.

## 9. Questions for ChatGPT

1. Is the Option A / Option B tradeoff on `stripeInterval` (Finding 1)
   correctly scoped — does leaving the ~4 pure-display/reward consumers
   un-migrated (rather than doing the wider consumer migration Option B
   would have required) still satisfy the actual acceptance criteria you
   listed, given none of them are grant/revoke-path risks?
2. Does the `legacyAdminPasswordOk()` centralization (Finding 7) — closing
   the constant-time-comparison and observability gaps without restructuring
   all 21 routes onto `requireAdmin()` directly — meet the intent of "either
   eliminate all route-local comparisons or explicitly classify and justify
   every remaining one," or is full `requireAdmin()` migration still
   required before this can be considered resolved?
3. Any remaining doubt about the RevenueCat HMAC scheme (Finding 4) given
   it's sourced from your report rather than independently re-verified here
   — should Don be told to hold off enabling `REVENUECAT_HMAC_SECRET` even
   after a successful test delivery, pending a second independent check?

## 10. Requested Review Scope

Highest scrutiny, in order:
1. **The entitlement provenance fix itself** (Finding 1) — is the
   invariant actually enforced everywhere `setUserPlan`/the three revoke
   functions are called, or is there a remaining call site that could still
   write a Stripe-provenance value from a non-Stripe source?
2. **The RevenueCat claim-token CAS design** (Finding 3) — any remaining
   race in the fresh-claim path (the `create()` → `P2002` → re-read →
   `create()`-again fallback for the "row vanished" edge case) that the
   concurrency tests didn't exercise?
3. **The atomic rate-limit SQL** (Finding 8) — the raw `$queryRaw` tagged
   template is parameterized by Prisma automatically; confirm there's no
   injection surface given `key` is derived from user-controlled input
   (email/IP).
4. **Whether Finding 7's centralization decision is sufficient**, per
   Question 2 above.

Lower priority: the HMAC scheme details (already flagged as
report-sourced, not independently verified, and off by default); the AMOE
read-path (still explicitly not cut over).

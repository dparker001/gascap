# ChatGPT Review Packet — Hardening Sprint 2

---

## 1. Objective

Don (Product Owner) commissioned "GASCAP™ HARDENING SPRINT 2" — explicitly
**not a feature sprint** — covering eight areas: (1) migrate admin
authentication off a shared `ADMIN_PASSWORD` to NextAuth session + database
role, (2) make the RevenueCat webhook idempotent against at-least-once
delivery, (3) reconcile entitlements across multiple providers (Stripe,
RevenueCat, Ambassador) so one provider's revocation can't wipe another's
legitimate grant, (4) prepare (but not necessarily enable) RevenueCat HMAC
signature verification, (5) replace in-memory rate limiting with something
durable for at least the worst gaps, (6) plan and selectively execute
migration of file-backed persistence off the Railway volume, prioritizing
AMOE, (7) remove confirmed-dead persistence code, (8) add production
observability for security-sensitive operations. Pricing, trial length,
sweepstakes/AMOE/giveaway/getaway rules, reward values, and Rental Return
calculations were explicitly off-limits. The brief required an Implementation
Plan with three specific confirmation questions before coding, prohibited
any destructive database operation without explicit approval, required this
review packet before merge, and explicitly instructed: do not merge.

Don's only two messages this sprint: the full brief, and — after I presented
the Implementation Plan — *"Yes, dparker001@gmail.com is correct — proceed
with the column-based approach."* That confirmed (a) the admin-role backfill
target identity and (b) adding entitlement-provenance fields as columns on
`User` rather than a separate normalized table.

## 2. Repository State

- **Branch:** `hardening/sprint-2`
- **Review Target SHA:** `8712665` (HEAD — includes the docs-reconciliation
  commit; the last commit that changed application code/tests/config was
  `87adb0e`, "feat(P1): read-only RevenueCat webhook observability endpoint")
- **Packet Commit SHA:** this file is added in a follow-up commit after
  `8712665`; that commit's SHA is not yet known while this packet is being
  written — see the note in the template about this being expected, not an
  error.
- **Base branch:** `main`, at `39de76a` (Hardening Sprint 1's merge commit —
  confirmed via `git rev-parse main`)
- **Relevant PR:** none opened. Per the brief, `hardening/sprint-2` was
  pushed to `origin` for backup/visibility but **no PR was created and
  nothing was merged.**
- **Review this diff:** `git diff --name-status main...hardening/sprint-2`
  (54 files, generated mechanically, pasted verbatim in §10 — not hand-counted).

## 3. What I Found

Inspection before coding (per the brief's required file list) confirmed:

- All 21 `/api/admin/*`-family routes (plus `announcements`, `push/broadcast`,
  `push/digest`, `push/fillup-reminder`) used a local `auth()` closure
  comparing `x-admin-password` against `process.env.ADMIN_PASSWORD`,
  constant-time, failing closed on a missing secret. This was Sprint 1's
  already-audited state — confirmed still true, not re-litigated.
- `app/admin/page.tsx` persisted the raw password in `localStorage` for 8
  hours (`gascap_admin_session`), matching Sprint 1's finding.
- `/api/native/revenuecat` had no idempotency mechanism — no `event.id`
  tracking of any kind, verified by reading the full handler.
- `setUserPlan()`'s only cross-provider protection was a single ambassador
  check inside the function itself; the RevenueCat revoke path called
  `setUserPlan(userId, 'free')` unconditionally otherwise; the Stripe webhook
  had a separate, independent, ad-hoc `if (user.stripeInterval === 'lifetime')
  skip` guard that didn't know about RevenueCat at all. Two different,
  incomplete protections, confirmed by reading both call sites — this was the
  concrete mechanism behind the "multi-provider reconciliation" requirement.
- `/api/auth/forgot-password` had **zero** rate limiting — not degraded, not
  in-memory, genuinely absent. This was a new finding this sprint, not
  something Sprint 1 had flagged.
- `/api/otp/send` had its own redundant in-memory `Map`-based limiter,
  separate from `lib/rateLimit.ts`, keyed on email only (no IP layer).
- `lib/pushSubscriptions.ts` — re-grepped against current `main` per the
  brief's explicit instruction not to trust the Sprint 1 finding blindly.
  Zero callers confirmed again.
- AMOE (`data/amoe-entries.json`) was, per Sprint 1's fix, correctly read by
  the draw, but remained file-only with no database mirror and no backfill
  path.
- **Environment constraint (recurring from Sprint 1, now decisive for scope):**
  `railway run` executes locally against the production database over the
  network, but does **not** have access to the Railway volume — that's only
  mounted inside the actual running container. This means the real
  production `amoe-entries.json` row count could not be verified from this
  development environment at any point in the sprint.

## 4. What I Changed

**Admin authentication (`lib/adminAuth.ts`, new).** `requireAdmin(req)`
resolves role live from `prisma.user.findUnique` on every call — never from
the JWT or any client-supplied header — and accepts EITHER a session where
`role === 'admin'` OR the legacy `x-admin-password` header. `isAdmin()` is a
boolean convenience; `sessionHasAdminRole()` is the session-only half, used
to widen each of the 21 existing routes' own local `auth()` function with a
minimal diff (preserving each route's original return type and every call
site, just adding an OR branch) rather than replacing the pattern outright.
`app/admin/page.tsx` no longer writes the password to `localStorage` at all;
it silently probes the session on mount and only shows a password prompt if
that probe fails.

**RevenueCat idempotency (`lib/revenueCatEvents.ts`, new).**
`claimEvent(eventId, eventType, userId)` does an atomic claim via Prisma
`create()` + catching the `P2002` unique-constraint violation as the
concurrency primitive, with a 2-minute stale-processing reclaim so a mid-flight
crash can't permanently block a legitimate retried event. `/api/native/revenuecat`
now reads the body as raw text first (`req.text()`), parses it manually
(required so an eventual HMAC check can hash the exact original bytes — this
is the only parse point; nothing re-serializes-and-hashes), claims the event
before any grant/revoke, and marks it processed/failed afterward.

**Multi-provider entitlement reconciliation (`lib/entitlements.ts`, new).**
`resolveUserEntitlements(input, now?)` is a pure function computing aggregate
Pro status + `sources[]` from ambassador/Stripe-lifetime/Stripe-subscription/
RevenueCat-active/trial fields. `lib/users.ts` gained
`revokeRevenueCatEntitlement(userId)` and `revokeStripeSubscriptionEntitlement(userId)`
— each clears only its own provider's fields, then calls the resolver on the
fresh state, and only downgrades to free if no source survives. Both webhooks
(`app/api/native/revenuecat/route.ts`, `app/api/stripe/webhook/route.ts`) now
call the appropriate revoke function instead of an unconditional
`setUserPlan(userId, 'free')`.

**RevenueCat HMAC verification (`lib/revenueCatHmac.ts`, new).**
`verifyRevenueCatHmac(rawBody, signatureHeader)` — HMAC-SHA256-hex over the
raw body against an `X-RevenueCat-Signature` header. Shipped **off by
default**, gated entirely behind an unset `REVENUECAT_HMAC_SECRET`. The
header comment explicitly states the scheme was not independently verified
against RevenueCat's live documentation from this environment and lists four
things to confirm before enabling in production.

**Durable rate limiting (`lib/rateLimitDb.ts`, new).**
`checkRateLimitDb(key, limit, windowMs)` — Postgres-backed atomic
check-and-increment (`RateLimitCounter` table) with upsert-conflict recovery
for the first-request race, matching the call shape of the existing
in-memory `checkRateLimit` so callers didn't need restructuring.
`/api/auth/forgot-password` gained rate limiting for the first time (3/email
+ 10/IP per hour; rate-limited requests still return the generic `{ok:true}`
to avoid an enumeration signal). `/api/otp/send` moved off its redundant
local limiter onto the same primitive and gained an IP layer (3/email +
20/IP per 15 min).

**AMOE staged migration (`lib/amoeEntriesDb.ts`, new; `app/api/admin/amoe-backfill/route.ts`, new).**
`AmoeEntry` Prisma table, additive. `POST /api/amoe` now dual-writes: the
existing unconditional file write is unchanged and primary, and a
best-effort Postgres mirror (`mirrorAmoeEntryToDb`, never throws, never
blocks the real submission) runs alongside it. `POST /api/admin/amoe-backfill`
(admin-authenticated, audit-logged) does an idempotent backfill from the file
into Postgres and reports `fileCount`/`dbCountBefore`/`dbCountAfter`/`inserted`/
`alreadyPresent` plus a `verified` boolean. **The draw's read path was
deliberately NOT cut over this sprint** — see §5.

**Dead code removal.** `lib/pushSubscriptions.ts` deleted (`git rm`) after
re-confirming zero callers.

**Admin audit logging (`lib/adminAudit.ts`, new).** `logAdminAction()` is
best-effort and catches its own errors — it can never block the admin action
it's logging. Wired into the highest-risk mutations only, per the brief's
explicit allowance to prioritize over full coverage: user delete/plan-change/
comp-grant/comp-revoke, sweepstakes draw runs and winner-email releases, AMOE
backfill.

**Observability (`app/api/admin/revenuecat-events/route.ts`, new).**
Read-only, admin-authenticated, returns recent `RevenueCatWebhookEvent` rows
plus status-grouped counts. Never exposes the raw webhook payload — the
table doesn't store one.

**Schema (`prisma/schema.prisma`, additive only; SQL in
`docs/migrations/2026-08-sprint2-schema.sql`).** Added to `User`: `role`,
`revenueCatActive`, `revenueCatInterval`, `revenueCatProductId`. Four new
models: `RateLimitCounter`, `RevenueCatWebhookEvent`, `AdminAuditLog`,
`AmoeEntry`. Validated via `npx prisma validate` and `npx prisma generate`.
**Not applied to production** — see §7.

**Docs.** `docs/SECURITY_AUDIT.md`, `docs/ADMIN_AUTH_MIGRATION.md`,
`README.md`, `docs/SYSTEM.md` all updated to reflect the above (this was the
work immediately preceding this packet).

## 5. Architectural Decisions

**Dual-auth widening over a full replacement (admin auth).** Considered
replacing every route's auth check outright with `requireAdmin()`.
Rejected in favor of widening each route's own local `auth()` closure with a
minimal diff, preserving its exact return type and every call site. This
kept 21 file changes mechanically small and low-risk, and made the one bug
that did slip through (a multi-line import corruption in one auto-converted
file — see §11) trivial to isolate: only 1 of 15 similarly-converted files
was affected, and `tsc --noEmit` caught it immediately.

**Event-id idempotency without certainty about the field name.** RevenueCat's
exact webhook payload shape for `event.id` was not independently confirmed
against their current docs from this environment. Rather than block on that,
the claim/status state machine was built to degrade safely regardless: if
`event.id` is absent or wrong, `claimEvent` simply doesn't gate anything, and
real traffic still flows — it fails open on the dedupe check specifically,
not on the underlying grant/revoke logic, which was already believed to be
close to idempotent by construction (see the Sprint 1 deferred note this
item replaces).

**Column-based entitlement provenance over a separate table.** Don explicitly
confirmed this. Rejected: a normalized `EntitlementSource` table (more
extensible, cleaner joins) in favor of three columns directly on `User`
(`revenueCatActive/Interval/ProductId`) alongside the pre-existing Stripe/
ambassador fields, because the existing code already reads Stripe/ambassador
state as columns on `User`, and a resolver function unifying columns-vs-a-table
would need to special-case one provider anyway. The tradeoff: `User` grows
wider, and a future provider #4 repeats the pattern rather than fitting a
generic table. Documented as an acceptable, explicitly-approved tradeoff, not
a default choice.

**Separate `requireAdmin()` call in `sweepstakes/route.ts` instead of
replacing its existing gate.** That handler is large and delicate (runs the
actual draw). Rather than restructure its control flow to get an identity out
of a replaced auth check, a second `requireAdmin()` call was added purely for
audit-log attribution, accepting the minor redundancy of two auth checks in
exchange for zero risk to the draw logic itself.

**AMOE: dual-write + backfill, explicitly NOT a read-path cutover.** The
brief required verifying every existing entry is preserved before changing
anything the draw depends on. That verification step — confirming
production's real file row count — is not reachable from this development
environment (see §3, the `railway run`/volume constraint, also documented in
Sprint 1). Rather than claim a completed migration that couldn't actually be
verified, the scope was narrowed to what's honestly completable: dual-write
(so no future entry is ever at risk) plus an idempotent, on-demand,
admin-triggered backfill whose own response tells the caller whether it's
verified. The read-path cutover is left as an explicit, documented next step
requiring Don to run the backfill from the live production app and confirm
`verified: true` before anything changes.

## 6. Security Impact

**Security problems fixed:**
- Admin credential no longer written to browser `localStorage` in cleartext
  for 8 hours (was: any XSS on the origin could read a permanent credential).
- `/api/auth/forgot-password` now rate limited — was completely open to
  unlimited requests before this sprint.
- `/api/otp/send`'s rate limiter gained an IP layer — was previously
  email-only, so one caller could flood many different addresses without any
  single one hitting its own cap.
- A RevenueCat webhook retry (RevenueCat documents at-least-once delivery)
  can no longer duplicate a grant/revoke side effect.
- A RevenueCat-side expiration/refund event can no longer silently downgrade
  a user who separately holds a legitimate, active Stripe subscription (and
  vice versa) — previously the two providers' revoke paths didn't know about
  each other.

**New security considerations introduced:**
- The legacy `x-admin-password` header path is still fully live and
  accepted — this is deliberate (see §5, migration staging) but means the
  admin-auth attack surface is not actually reduced yet, only added-to. It
  will only shrink once step 6 of `docs/ADMIN_AUTH_MIGRATION.md` (removing
  the legacy branch) happens, which is explicitly not done this sprint.
- `REVENUECAT_HMAC_SECRET`, if set incorrectly against a scheme that doesn't
  actually match RevenueCat's real implementation, would create a false
  sense of verification without providing it. Mitigated by shipping it off
  by default with an explicit "confirm before enabling" note — but this is a
  real risk if someone sets the env var without reading that note.
- `GET /api/admin/revenuecat-events` is a new read surface over webhook
  metadata (event type, status, resolved user id — never raw payload). Low
  risk given it's session/role-gated like every other admin route, but it's
  a new query surface nonetheless.

**Remaining security concerns:**
- The legacy admin password path (see above) — not yet removed.
- `support` role was not built (not needed yet, per the brief's own
  "don't add roles for complexity" instruction) — so today it's binary
  user/admin, no read-only tier.
- CSP is still not implemented (pre-existing gap, `docs/CSP_ROLLOUT_PLAN.md`,
  not touched this sprint — out of scope).
- AI/scan/referral endpoints' rate-limit coverage was not audited this
  sprint (deferred, `docs/RATE_LIMITING_PLAN.md` items #6–8).

**Did authentication/authorization behavior change?** Yes — admin routes now
accept a second, additional valid credential (an admin-role session) beside
the existing password header; RevenueCat/Stripe revoke behavior changed from
unconditional-except-one-hardcoded-check to a resolver-driven decision.

## 7. Data / Database Impact

**Schema changes:** four new tables (`RateLimitCounter`,
`RevenueCatWebhookEvent`, `AdminAuditLog`, `AmoeEntry`) and four new columns
on `User` (`role`, `revenueCatActive`, `revenueCatInterval`,
`revenueCatProductId`). All additive — no column removed, no column type
changed, no existing row touched by the schema change itself.

**Migrations:** hand-written SQL in
`docs/migrations/2026-08-sprint2-schema.sql`, matching the project's standing
rule of never running a blind `prisma db push`. **Not yet executed against
production** — this requires Don's explicit go-ahead per the brief's
database-safety section, and hasn't been requested or given yet.

**Backfills:** the AMOE backfill (`POST /api/admin/amoe-backfill`) is built,
tested, and idempotent, but has not been run against production — it can
only meaningfully run from the deployed app (the file only exists on the
Railway volume). The admin-role backfill for `dparker001@gmail.com`
(confirmed as the correct target) is written as a commented-out `UPDATE` in
the same SQL file, also not yet executed.

**Destructive operations:** none. No `DROP`, `TRUNCATE`, mass `DELETE`, or
`prisma migrate reset` occurred or was proposed. `data/amoe-entries.json`
was not deleted and per the brief's explicit instruction will not be until
Don confirms the verified count match and approves.

**Rollback:** every schema addition is reversible by simply not using the new
columns/tables (nothing reads them until this code is deployed). The AMOE
dual-write is additive and reversible up through the backfill step; only the
(not-yet-done) read-path cutover would be behavior-changing, and that's
scoped as its own small, separately-reviewable change in
`docs/migrations/2026-08-sprint2-amoe-backfill.md`.

## 8. User / Business Impact

No pricing, trial duration, sweepstakes/AMOE/giveaway/getaway terms, reward
values, or Rental Return calculations were touched, per the brief's explicit
prohibition — confirmed by the diff in §10 (no changes to
`lib/calculations.ts`, `lib/giveaway.ts`, `lib/getaway.ts`, or any pricing
constant).

The two behavior changes closest to real users:
- **Stripe subscribers who also have RevenueCat history:** a RevenueCat-side
  expiration can no longer downgrade them if their Stripe subscription is
  still active. This is a **more permissive**, not more restrictive, change
  — nobody who is currently correctly-Pro becomes not-Pro as a result of this
  sprint; the risk this closes runs the other direction (a paying customer
  being wrongly downgraded).
- **AMOE (free/no-purchase-necessary sweepstakes entrants):** entries are now
  also mirrored to Postgres, but the draw's actual read path is unchanged —
  no entrant's eligibility or entry count changes as a result of this
  sprint's code.

Nothing here is user-visible or requires a support/marketing notice.

## 9. Testing Performed

```
npm test          → 229 passed (18 test files), 0 failed
npx tsc --noEmit   → clean, no output
npm run build      → ✓ Compiled successfully
npm run check:crons → ✓ cron inventory: 18 routes, 16 scheduled, 2 exempt
```

All four commands were run from `hardening/sprint-2` at the current HEAD
(`8712665`) immediately before this packet was written — not carried over
from an earlier point in the sprint.

Other tests (all new this sprint, all passing, counts from the actual test
run above): `__tests__/adminAuth.test.ts` (10), `__tests__/entitlements.test.ts`
(14), `__tests__/revenueCatEvents.test.ts` (9), `__tests__/revenueCatHmac.test.ts`
(7), `__tests__/rateLimitDb.test.ts` (8), `__tests__/adminAudit.test.ts` (6),
`__tests__/amoeEntriesDb.test.ts` (8); `__tests__/revenuecatWebhook.test.ts`
extended with a `duplicate event delivery` block (7 new cases) plus rewritten
assertions in existing cases (27 total in that file now).

## 10. Files Changed

```
M	CLAUDE.md
M	README.md
A	__tests__/adminAudit.test.ts
A	__tests__/adminAuth.test.ts
A	__tests__/amoeEntriesDb.test.ts
A	__tests__/entitlements.test.ts
A	__tests__/rateLimitDb.test.ts
A	__tests__/revenueCatEvents.test.ts
A	__tests__/revenueCatHmac.test.ts
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
M	app/api/native/revenuecat/route.ts
M	app/api/otp/send/route.ts
M	app/api/push/broadcast/route.ts
M	app/api/push/digest/route.ts
M	app/api/push/fillup-reminder/route.ts
M	app/api/stripe/webhook/route.ts
M	docs/ADMIN_AUTH_MIGRATION.md
M	docs/RATE_LIMITING_PLAN.md
M	docs/SECURITY_AUDIT.md
M	docs/SYSTEM.md
A	docs/migrations/2026-08-sprint2-amoe-backfill.md
A	docs/migrations/2026-08-sprint2-schema.sql
A	lib/adminAudit.ts
A	lib/adminAuth.ts
A	lib/amoeEntriesDb.ts
A	lib/entitlements.ts
D	lib/pushSubscriptions.ts
A	lib/rateLimitDb.ts
A	lib/revenueCatEvents.ts
A	lib/revenueCatHmac.ts
M	lib/users.ts
M	prisma/schema.prisma
```

(54 files — generated via `git diff --name-status main...hardening/sprint-2`,
pasted verbatim.)

## 11. Known Risks / Remaining Questions

**Genuinely unfinished, by design:**
- Schema not applied to production; admin role not backfilled for
  `dparker001@gmail.com`. Until that happens, the silent session-probe in
  `app/admin/page.tsx` will fail closed for Don and fall back to the password
  prompt — safe, but not the intended end state.
- Legacy `ADMIN_PASSWORD` header still fully accepted — steps 5 (soak with
  usage-logging) and 6 (remove the legacy branch) of
  `docs/ADMIN_AUTH_MIGRATION.md` are not started, and no warning-log
  instrumentation was added to make "has the legacy path gone quiet"
  answerable yet.
- AMOE draw read path still reads the file, not Postgres — see §5. This is
  the largest deliberately-incomplete piece of the sprint.
- RevenueCat HMAC verification is shipped but off — the exact header name
  and signing scheme were not independently confirmed against RevenueCat's
  current documentation from this environment.
- `event.id` as the RevenueCat dedupe key was assumed, not confirmed against
  current RevenueCat docs — believed to degrade safely if wrong (see §5),
  but not proven against a real RevenueCat payload.
- `support` role not built (deliberately — see §5).
- AI/scan/referral rate-limit coverage not audited this sprint.

**Process mistakes made and corrected during the work (not just code risk):**
- A batch auto-conversion script inserted the new `sessionHasAdminRole`
  import inside a pre-existing multi-line `import { ... } from
  '@/lib/emailCampaignPaid'` block in one file, producing invalid syntax.
  Caught immediately by `tsc --noEmit`; checked all 14 other
  similarly-converted files for the same pattern (only the one was affected);
  fixed with a targeted edit.
- An idempotency retry test initially asserted `setUserPlan` was called once
  across two POSTs, which was wrong — the function is genuinely invoked
  twice (once per request), only one call succeeds. Fixed the assertion to
  expect two calls, with a comment explaining why.
- A rate-limiter test's mock of Prisma's `upsert()` didn't match real Prisma
  semantics (it unconditionally threw on any existing row, instead of
  updating). This broke a legitimate "window expired, start fresh" test case
  and was masking whether the *real* concurrent-first-request race was being
  tested correctly. Fixed the mock, then rewrote the race test to genuinely
  simulate a concurrent-insert conflict via `mockImplementationOnce` rather
  than relying on the mock's default behavior.
- An audit-log test had a loosely-typed mock function that TypeScript didn't
  catch until later usage sites tried to index into `.mock.calls[0][0].data`
  — fixed by typing the mock's parameter explicitly.

None of the above reached a commit as "done" before being caught — all were
caught by `tsc --noEmit` or `vitest run` before being presented as complete,
per the sprint's own testing discipline. Flagging them here anyway because a
reviewer catching a pattern (e.g. "the auto-conversion script needs a
guard against multi-line imports") is as valuable as catching a live bug.

**No user-reported errors occurred this sprint** — Don's only two messages
were the brief and the single confirmation reply; everything above was
self-caught.

## 12. Claude's Assessment

**READY WITH KNOWN CONCERNS.** All eight brief areas were addressed to the
extent honestly completable from this development environment; nothing was
merged; no destructive database operation occurred; the two most consequential
pieces of *actual remaining risk* are both named explicitly rather than
buried: (1) the legacy admin-password path is still fully live (intentional
staging, not an oversight), and (2) the AMOE draw still reads the file, not
the new Postgres table (also intentional, blocked on a verification step
this environment cannot perform). Both have documented, concrete next steps.
Nothing in this sprint reduces existing production safety — every change is
additive-then-optional (dual-auth, dual-write) rather than a hard cutover.

## 13. Questions for ChatGPT

1. In `lib/entitlements.ts`, does `resolveUserEntitlements()` correctly
   handle every combination named in the original brief (Stripe+RC
   coexistence in both directions, Lifetime+RC-refund, Ambassador+all-expire,
   no-entitlement+expired-trial, gifted-lifetime+Stripe-failure) — or is
   there a combination the 14 tests in `__tests__/entitlements.test.ts`
   don't actually exercise?
2. In `lib/revenueCatEvents.ts`, is the 2-minute stale-processing reclaim
   window long enough to avoid double-claiming a genuinely-still-processing
   event under realistic webhook-handler latency, but short enough to
   recover from a real crash without an unacceptable stuck-event window? Is
   there a race between two concurrent requests for the *same* event ID that
   the `P2002`-catch approach doesn't actually close?
3. In `app/api/native/revenuecat/route.ts`, is reading the body as raw text
   first (`req.text()`) and parsing it manually actually sufficient to make
   the HMAC check (when eventually enabled) verify the exact bytes
   RevenueCat sent, or is there a Next.js/framework-level body-handling step
   upstream of this handler that could still alter the bytes before they
   reach it?
4. Across the 21 widened admin routes, is there any route where the
   dual-auth OR logic could be bypassed or where the session-role check
   could be tricked into reading a stale/forged role — e.g. any place role
   is read from something other than a fresh `prisma.user.findUnique` call?
5. Is there any code path — old or new — that can still wrongly **grant**
   Pro (not just wrongly revoke it) as a result of this sprint's changes to
   `setUserPlan`, `revokeRevenueCatEntitlement`, or
   `revokeStripeSubscriptionEntitlement`?
6. Does the AMOE dual-write in `app/api/amoe/route.ts` have any path where a
   Postgres failure could — even indirectly — affect the file write's
   success or the response returned to the entrant? (Intent: best-effort,
   never blocking; asking for confirmation it's actually implemented that
   way.)
7. Is the `docs/migrations/2026-08-sprint2-schema.sql` file, as written,
   safe to run against the live production database as-is, or does it need
   changes before Don runs it?

## 14. Requested Review Scope

Highest scrutiny, in order:
1. **Admin authorization boundaries** — `lib/adminAuth.ts` and the 21 widened
   routes (Question 4 above).
2. **Entitlement reconciliation correctness** — `lib/entitlements.ts` and its
   two call sites (Question 1, 5).
3. **RevenueCat idempotency** — `lib/revenueCatEvents.ts` and the raw-body
   handling in `app/api/native/revenuecat/route.ts` (Question 2, 3).
4. **Schema/migration safety** — `docs/migrations/2026-08-sprint2-schema.sql`
   (Question 7).
5. **AMOE preservation** — `lib/amoeEntriesDb.ts`, the backfill endpoint, and
   whether the dual-write can ever risk the primary file write (Question 6).
6. Any route still reachable via **only** the legacy `ADMIN_PASSWORD` path
   that should have gained a session path but didn't.
7. Rate-limit bypass or lockout risk in `lib/rateLimitDb.ts` — specifically
   whether an attacker can force `checkRateLimitDb` into a state that locks
   out a legitimate user indefinitely.

Lower priority (already scoped as explicitly incomplete, not hiding
anything): the HMAC verification code itself (it's off by default and
its own header comment already states the caveat), and the AMOE read-path
(explicitly not cut over this sprint).

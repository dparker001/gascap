# Security audit — machine-to-machine and admin authentication

**Status: CURRENT.** Audit date 2026-08-18, revised 2026-08-18 (independent
review) and 2026-08-18 (Sprint 2 — admin auth migration). Scope: every
endpoint authenticated by a shared secret and/or an admin role. No secret
values appear in this document.

> **Sprint 2 update.** All 21 `ADMIN_PASSWORD`-gated endpoints from the table
> below now accept EITHER a valid admin session (role resolved live from the
> database — see `lib/adminAuth.ts`) OR the legacy header, staged per
> `docs/ADMIN_AUTH_MIGRATION.md`. Two new admin endpoints were added this
> sprint (`amoe-backfill`, `revenuecat-events`), both session-first with no
> legacy fallback since they never existed with one. **Total is now 23
> privileged endpoints** (21 dual-auth + 2 session-only), plus the unchanged
> Stripe signature, RevenueCat header+HMAC, and public-by-design AMOE submit.

> **Revision note.** The original version of this document claimed "35
> endpoints, RevenueCat the only fail-open case" and organized the table by
> directory (`/api/admin/*`, `/api/cron/*`, …). An independent review found
> that classification incomplete: it omitted `/api/announcements` (which is
> ADMIN_PASSWORD-protected but outside `/api/admin/`), misclassified three
> `/api/push/*` routes as `CRON_SECRET` when they actually use
> `ADMIN_PASSWORD`, and missed the `WEBHOOK_SECRET`-authenticated
> `/api/webhooks/ghl-placement` entirely. This revision re-audits **by
> authentication mechanism**, not directory, per that review's instruction.
> The corrected total is **42** privileged endpoints. The finding that
> RevenueCat was the only fail-open case still holds — the miss was
> completeness of the inventory, not a second vulnerability.

---

## Method

Grepped every `route.ts` under `app/api/` for reference to any of the known
secret env vars, then independently grepped for `process.env.*_(SECRET|AUTH|TOKEN|KEY)`
across all routes and diffed the two lists to catch anything using a var not
already known about. That second pass is what surfaced `WEBHOOK_SECRET`.

```
grep -rl "ADMIN_PASSWORD\|CRON_SECRET\|REVENUECAT_WEBHOOK_AUTH\|STRIPE_WEBHOOK_SECRET" app/api/**/route.ts
grep -rl "process\.env\.[A-Z_]*\(SECRET\|AUTH\|TOKEN\|KEY\)\b" app/api/**/route.ts   # then diff against the above
```

Then read the auth block of every match and confirmed the fail-open shape:

```
if (secret && supplied !== secret)      # check vanishes when secret is unset
```

## Endpoints by mechanism

### NextAuth session (`getServerSession` / `getToken`)
Every non-listed `/api/*` route that requires sign-in. Not enumerated here —
this document covers **shared-secret** auth specifically. Session auth has its
own risk profile (see `lib/serverPlan.ts` re: stale JWT plan) covered in
`README.md` / `docs/SYSTEM.md`, not here.

### `ADMIN_PASSWORD` header **OR** admin session (dual-auth, Sprint 2) — 21 endpoints

All 21 originally guarded `if (!pw) return false` (or equivalent) before
comparing — **fail closed**, confirmed in the 2026-08-18 revision. Sprint 2
widened every one to also accept a live-resolved `role='admin'` session (see
`lib/adminAuth.ts` → `sessionHasAdminRole()`), staged so nothing could lock
Don out mid-migration. The legacy header still works, unchanged, and logs its
own use so "has it gone quiet" is answerable before removal — see
`docs/ADMIN_AUTH_MIGRATION.md`.

| Endpoint | Fails closed? | Session path added? | Audit-logged mutation? |
|---|---|---|---|
| `/api/admin/analytics` | ✅ | ✅ | — (read-only) |
| `/api/admin/campaigns` | ✅ | ✅ | — |
| `/api/admin/deleted-accounts` | ✅ | ✅ | — (read-only) |
| `/api/admin/email-log` | ✅ | ✅ | — |
| `/api/admin/email-preview` | ✅ | ✅ | — |
| `/api/admin/email-retry` | ✅ | ✅ | — |
| `/api/admin/feedback` | ✅ | ✅ | — |
| `/api/admin/founding-member-blast` | ✅ | ✅ | — |
| `/api/admin/ghl-backfill` | ✅ | ✅ | — |
| `/api/admin/gifts` | ✅ | ✅ | — (read-only today) |
| `/api/admin/push-test` | ✅ | ✅ | — |
| `/api/admin/rental-pilot` | ✅ | ✅ | — |
| `/api/admin/rental-pilot/[id]` | ✅ | ✅ | — |
| `/api/admin/reviews` | ✅ | ✅ | — |
| `/api/admin/send-d1` | ✅ | ✅ | — |
| `/api/admin/sweepstakes` | ✅ | ✅ | ✅ `sweepstakes.run_draw`, `sweepstakes.release_winner_email` |
| `/api/admin/users` | ✅ | ✅ | ✅ `user.delete`, `user.plan_change`, `user.grant_comp_pro_for_life`, `user.revoke_comp_pro_for_life` |
| `/api/announcements` (POST) | ✅ | ✅ | — |
| `/api/push/broadcast` | ✅ | ✅ | — |
| `/api/push/digest` | ✅ | ✅ | — |
| `/api/push/fillup-reminder` | ✅ | ✅ | — |

### Admin session only (no legacy fallback) — 2 endpoints, added Sprint 2

New endpoints have no reason to carry the legacy header pattern forward.

| Endpoint | Audit-logged? |
|---|---|
| `POST /api/admin/amoe-backfill` | ✅ `amoe.backfill` |
| `GET /api/admin/revenuecat-events` | — (read-only) |

### `CRON_SECRET` via query parameter — 18 endpoints

All 18 `/api/cron/*` routes. All guard `!process.env.CRON_SECRET` first —
fail closed. (18 confirmed by `find app/api/cron -name route.ts`, cross-checked
that every one references `CRON_SECRET`.)

### `STRIPE_WEBHOOK_SECRET` via signature — 1 endpoint

`/api/stripe/webhook` — `stripe.webhooks.constructEvent(body, sig, secret)`.
Cryptographic signature verification, not a string compare. Fails closed
(checks `!secret` before use).

### `REVENUECAT_WEBHOOK_AUTH` via `Authorization` header — 1 endpoint

`/api/native/revenuecat` — **fixed this sprint**, see below.

### `WEBHOOK_SECRET` via query param or `x-webhook-secret` header — 1 endpoint

`/api/webhooks/ghl-placement` — **missed entirely in the original audit.**
`if (!secret) return false` — fails closed. `secret === fromQuery ||
secret === fromHeader`. No change needed; documented now for completeness.

### Public by design — 1 endpoint

`/api/amoe` — intentionally unauthenticated (No Purchase Necessary). Protected
by a honeypot field and one-submission-per-email-per-month. The *read* path
(`readAmoeEntries`) was hardened this sprint to throw rather than silently
return empty, so a storage fault can't quietly exclude free entrants from the
draw.

**Total: 21 (dual-auth) + 2 (session-only, new) + 18 + 1 + 1 + 1 + 1 (public) = 45 rows, 44 privileged + 1 public.**

---

## Fixed this sprint

### RevenueCat webhook — unauthenticated entitlement control (critical)

```js
// before
const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
if (expected && req.headers.get('authorization') !== expected) return 401;
```

If `REVENUECAT_WEBHOOK_AUTH` were unset — never configured, typo'd, dropped in
a Railway migration — the condition short-circuits and **every** request is
treated as authentic. Any anonymous POST could grant Pro to an arbitrary
account or revoke it from a paying customer. The endpoint had zero test
coverage.

Now: absent secret → **503**, refuses to process; wrong or missing header →
**401**; comparison is constant-time; the secret is never logged or echoed.

**Corrected reasoning on the 503 choice** (an earlier draft of this document
overstated it): 503 is chosen because a missing secret is a **GasCap
configuration failure**, and the status code should say that honestly — not
because it changes RevenueCat's retry behavior. RevenueCat's documented
webhook behavior treats **any non-200 response as a failure and retries up to
5 times, regardless of status code.** So 401 would have been retried too. The
distinction is semantic correctness (server fault vs. caller fault), not
delivery guarantees. See `/CLAUDE.md` for the general rule this produced:
verify a provider's actual retry semantics before assuming a 4xx/5xx split
means anything to it.

Verified the regression tests fail against the old line and pass against the
fix — see `__tests__/revenuecatWebhook.test.ts` (19 cases).

### OTP verification brute force

`/api/otp/send` was rate limited; the code comparison in the `credentials-otp`
provider was not. Capped at 5 attempts per email per 10-minute window.

**Two corrections from independent review, both applied:**
- The throttle log previously printed the full email address on a hit
  (`console.warn(... for ${email})`). Now redacted.
- The rate-limit check ran *after* the Postgres `SELECT` for the OTP row. Moved
  ahead of the query — the cheap in-memory check should gate the database
  round-trip, not follow it.

**`docs/RATE_LIMITING_PLAN.md` previously stated OTP *send* was limited by
"email + IP".** Verified against `app/api/otp/send/route.ts`: it is
**email-only** (`checkRate(email)`, a local in-memory map keyed solely on the
address). Corrected there; flagged here so the send-side and verify-side
protections aren't confused with each other.

### Two OTP sources of truth

`lib/otpStore.ts` (in-memory `Map`) was reachable only from `/api/otp/verify`,
which nothing called. Both deleted. PostgreSQL `OtpCode` is now the sole
implementation.

### Sprint 2 — admin auth migration

`ADMIN_PASSWORD` typed into a browser and held in `localStorage` for 8h is
gone as the *only* path. Added `role` (DB-resolved, never trusted from the
client) + NextAuth session as the primary path; the legacy header stays as a
fallback, staged per `docs/ADMIN_AUTH_MIGRATION.md`, so Don was never at risk
of being locked out mid-migration. `app/admin/page.tsx` no longer persists
the raw password in `localStorage` at all — a signed-in admin session logs in
silently with no password prompt. See `lib/adminAuth.ts`,
`__tests__/adminAuth.test.ts` (10 tests).

### Sprint 2 — RevenueCat event idempotency

`/api/native/revenuecat` now claims each `event.id` via
`lib/revenueCatEvents.ts` (unique-constraint atomic claim + stale-processing
reclaim) before running any side effect, and marks the claim
processed/failed afterward. A duplicate delivery of the same event is now a
no-op rather than a second grant/revoke. See
`__tests__/revenuecatWebhook.test.ts`'s `duplicate event delivery` block (7
tests) and `__tests__/revenueCatEvents.test.ts` (9 tests). Caveat: `event.id`
as the field name was not independently confirmed against RevenueCat's
current docs from this environment — the design degrades safely if it's
wrong (an absent `id` just skips the dedupe check rather than blocking
traffic), but this should be confirmed before treating the dedupe as
guaranteed.

### Sprint 2 — cross-provider entitlement reconciliation

`lib/entitlements.ts`'s `resolveUserEntitlements()` is now the single source
of truth for "is this user Pro," consulted by both the RevenueCat and Stripe
webhooks before any downgrade. A RevenueCat expiration/refund can no longer
wipe a legitimate Stripe subscription (or vice versa) — each provider's
revoke path (`revokeRevenueCatEntitlement`, `revokeStripeSubscriptionEntitlement`)
clears only its own fields, then only actually downgrades to free if no
surviving source remains. 14 table-driven tests in
`__tests__/entitlements.test.ts` cover every combination named in the Sprint
2 brief (Stripe+RC both directions, Lifetime+RC-refund, Ambassador+all-expire,
gifted-lifetime+Stripe-failure, etc).

### Sprint 2 — durable rate limiting

`POST /api/auth/forgot-password` had **no rate limit at all** before this
sprint — found during the Sprint 2 inspection pass, not previously flagged.
Now limited (3/email + 10/IP per hour) via `lib/rateLimitDb.ts`, a
Postgres-backed `checkRateLimitDb()` that survives deploys and spans
instances (the in-memory `checkRateLimit` it's modeled on does neither).
`/api/otp/send` moved off its own redundant local in-memory limiter onto the
same primitive and gained an IP layer (previously email-only, contradicting
what `RATE_LIMITING_PLAN.md` claimed — see "Fixed this sprint" above from
Sprint 1). 8 tests in `__tests__/rateLimitDb.test.ts`.

### Sprint 2 — dead code removed

`lib/pushSubscriptions.ts` deleted after re-confirming (grep against current
`main`, not trusting the Sprint 1 finding blindly per the brief's
instruction) that nothing calls it.

---

## Deferred, with reasoning

| Item | Why deferred |
|---|---|
| **Cron/webhook secrets in query strings** | `CRON_SECRET` (18 routes) and part of `WEBHOOK_SECRET`'s accepted forms can appear in intermediary access logs. All CRON_SECRET callers are GitHub Actions over HTTPS. Deferred as a coordinated multi-route change. |
| **Content-Security-Policy** | Not yet present. `docs/CSP_ROLLOUT_PLAN.md`. Not touched in Sprint 2 — out of that sprint's named scope. |
| **WebView debugging in production** | `docs/NATIVE_HARDENING_REVIEW.md`. Not touched in Sprint 2. |
| **RevenueCat HMAC signature verification** | `lib/revenueCatHmac.ts` exists and is tested (7 tests), but is **off by default** — gated entirely behind an unset `REVENUECAT_HMAC_SECRET` env var. The exact header name and signing scheme were not independently confirmed against RevenueCat's live documentation from this environment, per the brief's explicit instruction not to guess. Enabling it in production requires confirming RevenueCat's actual current spec first (see the header comment in that file for the 4 steps). The existing `Authorization` header check remains the active defense in the meantime. |
| **AMOE read-path cutover** | Dual-write (file + Postgres) and an idempotent backfill (`POST /api/admin/amoe-backfill`) shipped this sprint, but the giveaway draw still reads `data/amoe-entries.json`, not the `AmoeEntry` table. This dev environment cannot reach the production Railway volume to verify the real file row count before cutting the read path over — see `docs/migrations/2026-08-sprint2-amoe-backfill.md` for the full runbook. **Do not delete the file** until Don confirms `verified:true` from the backfill endpoint and approves. |
| **`support` role** | The brief allowed adding `user`/`support`/`admin` but explicitly said not to add roles the current system doesn't need. Only `user`/`admin` exist — no code path currently needs a middle tier, so it wasn't built. Revisit if a real need appears. |
| **Full admin UI rewrite** | `app/admin/page.tsx` still supports the legacy password prompt as a fallback (now silent-first via session). A full UI rewrite that assumes session-only auth was out of scope — the goal this sprint was a safe dual-auth staging period, not a UI overhaul. |
| **AI/scan/referral endpoint rate limiting** | Only `forgot-password` and `otp/send` were touched, per the brief's explicit "at most one additional store"-style scoping guidance applied here to rate limiting too — these were the two with the clearest gap (one endpoint had zero limiting, the other had a real IP-layer gap). Other AI-cost or referral endpoints were not audited for rate-limit coverage this sprint. |

---

## Confirmed present in production (names only, never values)

`REVENUECAT_WEBHOOK_AUTH` · `STRIPE_WEBHOOK_SECRET` · `CRON_SECRET` ·
`ADMIN_PASSWORD`

`WEBHOOK_SECRET` (ghl-placement) was **not** re-checked for presence during
this revision — it was outside the original scope and isn't touched by any
sprint-1 change. Worth confirming before relying on this document for that
endpoint specifically.

The RevenueCat fix is safe to deploy **because** `REVENUECAT_WEBHOOK_AUTH` is
set. Had it been missing, merging fail-closed would have halted iOS Pro grants
— the ordering matters, and should be re-confirmed before any future deploy
that touches webhook auth.

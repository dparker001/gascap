# Security audit — machine-to-machine authentication

**Status: CURRENT.** Audit date 2026-08-18, revised 2026-08-18 after
independent review. Scope: every endpoint authenticated by a shared secret
rather than (or in addition to) a user session. No secret values appear in
this document.

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

### `ADMIN_PASSWORD` via `x-admin-password` header — 21 endpoints

All 21 guard `if (!pw) return false` (or equivalent) before comparing —
**fail closed**.

| Endpoint | Fails closed? |
|---|---|
| `/api/admin/analytics` | ✅ |
| `/api/admin/campaigns` | ✅ |
| `/api/admin/deleted-accounts` | ✅ |
| `/api/admin/email-log` | ✅ |
| `/api/admin/email-preview` | ✅ |
| `/api/admin/email-retry` | ✅ |
| `/api/admin/feedback` | ✅ |
| `/api/admin/founding-member-blast` | ✅ |
| `/api/admin/ghl-backfill` | ✅ |
| `/api/admin/gifts` | ✅ |
| `/api/admin/push-test` | ✅ |
| `/api/admin/rental-pilot` | ✅ |
| `/api/admin/rental-pilot/[id]` | ✅ |
| `/api/admin/reviews` | ✅ |
| `/api/admin/send-d1` | ✅ |
| `/api/admin/sweepstakes` | ✅ |
| `/api/admin/users` | ✅ |
| **`/api/announcements`** (POST — writes `data/announcements.json`) | ✅ — **outside `/api/admin/`, missed in the original table** |
| **`/api/push/broadcast`** | ✅ — **originally miscategorized as `CRON_SECRET`** |
| **`/api/push/digest`** | ✅ — **originally miscategorized as `CRON_SECRET`** |
| **`/api/push/fillup-reminder`** | ✅ — **originally miscategorized as `CRON_SECRET`** |

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

**Total: 21 + 18 + 1 + 1 + 1 + 1 (public) = 43 rows, 42 privileged + 1 public.**

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

---

## Deferred, with reasoning

| Item | Why deferred |
|---|---|
| **Admin auth mechanism** | Raw `ADMIN_PASSWORD` typed into a browser, held in `localStorage` ~8h, replayed on every request. Fails closed across all 21 endpoints using it, so not a sprint-1 emergency, but the design is wrong. Migration in `docs/ADMIN_AUTH_MIGRATION.md`. |
| **Cron/webhook secrets in query strings** | `CRON_SECRET` (18 routes) and part of `WEBHOOK_SECRET`'s accepted forms can appear in intermediary access logs. All CRON_SECRET callers are GitHub Actions over HTTPS. Deferred as a coordinated multi-route change. |
| **Distributed rate limiting** | In-memory `Map`, resets on deploy, doesn't span instances. `docs/RATE_LIMITING_PLAN.md`. |
| **Content-Security-Policy** | Not yet present. `docs/CSP_ROLLOUT_PLAN.md`. |
| **WebView debugging in production** | `docs/NATIVE_HARDENING_REVIEW.md`. |
| **RevenueCat event-id idempotency** | The handler does not dedupe by `event.id`. RevenueCat documents at-least-once delivery, so the same event can arrive more than once. Current handlers (`setUserPlan`, campaign enrollment) are largely idempotent by construction — granting Pro twice sets the same plan twice — but this hasn't been verified exhaustively for every event/side-effect combination (e.g. whether a duplicate `INITIAL_PURCHASE` could double-send the welcome email or double-enroll a campaign step). **Sprint 2 payment-hardening item**, not fixed this sprint — flagged by independent review, confirmed present by inspection, out of scope to fix here. |
| **RevenueCat HMAC webhook verification** | RevenueCat now supports signing webhook payloads with HMAC in addition to the static `Authorization` header this app checks. Worth adopting alongside the idempotency work — same review cycle, same endpoint. |
| **Cross-provider entitlement reconciliation** | `setUserPlan(userId, 'free')` on a RevenueCat `EXPIRATION`/`REFUND` protects Ambassador Pro-for-Life (verified: checks `ambassadorProForLife` before reverting) but does **not** check whether the user separately holds an active Stripe subscription. A user with both a legitimate Stripe-paid Pro subscription and any RevenueCat entitlement history could theoretically have Stripe-paid access revoked by a RevenueCat-side expiration event. No evidence this has happened; flagged as a structural gap for Sprint 2, not fixed here — the brief scoped this sprint to the fail-open fix, not a redesign of `setUserPlan`'s multi-provider logic. |

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

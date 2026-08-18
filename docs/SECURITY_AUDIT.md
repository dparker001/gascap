# Security audit — machine-to-machine authentication

**Status: CURRENT** · Audit date 2026-08-18 · Hardening sprint 1
Scope: every endpoint authenticated by a shared secret rather than a user
session. No secret values appear in this document.

---

## Method

Searched for the fail-open shape — a guard that disappears when its env var is
absent:

```
if (secret && supplied !== secret)      # check vanishes when secret is unset
if (expected && …)
process.env.*SECRET / *_AUTH / ADMIN_PASSWORD
authorization / x-*-secret headers
```

Then read the auth block of every match. 35 privileged endpoints inspected.

---

## Findings

| Endpoint | Auth mechanism | Failed closed before? | Change made | Remaining concern |
|---|---|---|---|---|
| `POST /api/native/revenuecat` | `Authorization` header vs `REVENUECAT_WEBHOOK_AUTH` | **NO — critical** | Refuses (503) when secret absent; 401 on wrong/missing header; constant-time compare; 19 regression tests | None. Env var confirmed present in production. |
| `POST /api/stripe/webhook` | Stripe signature via `constructEvent` + `STRIPE_WEBHOOK_SECRET` | Yes | None | None — cryptographic signature, not a shared-string compare. |
| `GET /api/cron/*` (18 routes) | `?secret=` vs `CRON_SECRET` | Yes — all guard `!process.env.CRON_SECRET` first | None | Secret travels in the **query string**, so it can land in access logs. Low risk (GitHub Actions → HTTPS), but a header would be better. Deferred. |
| `/api/admin/*` (15 routes) | `x-admin-password` header vs `ADMIN_PASSWORD` | Yes — every route guards `if (!pw) return false` | None | Mechanism itself is the concern, not fail-open — see below. |
| `POST /api/admin/push-test` | Same, via `Boolean(pw && …)` | Yes | None | As above. |
| `POST /api/admin/ghl-backfill` | Same, via `Boolean(adminPw && …)` | Yes | None | As above. |
| `POST /api/admin/founding-member-blast` | `!pwd \|\| pwd !== env` | Yes — `undefined` never equals a supplied string | None | As above. |
| `POST /api/push/*` | `CRON_SECRET` | Yes | None | Same query-string note as cron. |
| `POST /api/amoe` | Public by design (No Purchase Necessary) | n/a | Read path now throws instead of silently returning empty | Intentionally unauthenticated. Protected by honeypot + one-per-email-per-month. |

**Result: RevenueCat was the only fail-open endpoint.** Everything else already
guarded a missing secret. That is a good baseline; the one exception was the
one that grants paid access.

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

Now: absent secret → **503** and refuses to process (RevenueCat retries 5xx, so
a genuine purchase is not lost while the misconfiguration is fixed); wrong or
missing header → **401**; comparison is constant-time; the secret is never
logged or echoed.

Verified the regression tests fail against the old line and pass against the
fix — see `__tests__/revenuecatWebhook.test.ts` (19 cases).

### OTP verification brute force

`/api/otp/send` was rate limited; the code comparison in the `credentials-otp`
provider was not. A 6-digit code is a 1,000,000-value space with a 10-minute
life, and a correct guess mints a session. Capped at 5 attempts per email per
10-minute window.

Trade-off, deliberate: keying on email means an attacker can block one address
from OTP sign-in for the window. Keying on IP is trivially defeated by
rotation, and password sign-in stays available.

### Two OTP sources of truth

`lib/otpStore.ts` (in-memory `Map`) was reachable only from `/api/otp/verify`,
which nothing called. Both deleted. PostgreSQL `OtpCode` is now the sole
implementation.

---

## Deferred, with reasoning

| Item | Why deferred |
|---|---|
| **Admin auth mechanism** | Raw `ADMIN_PASSWORD` typed into a browser, held in `localStorage` ~8h, replayed on every request. Fails closed, so not a sprint-1 emergency, but the design is wrong. Migration in `docs/ADMIN_AUTH_MIGRATION.md`. Sprint brief scoped this to design only. |
| **Cron secret in query string** | Can appear in intermediary access logs. All callers are GitHub Actions over HTTPS. Moving to a header requires changing 18 routes and the workflow together — mechanical, but it is a coordinated change that deserves its own PR. |
| **Distributed rate limiting** | In-memory `Map` resets on deploy and does not span instances. Acceptable while single-instance. `docs/RATE_LIMITING_PLAN.md`. |
| **Content-Security-Policy** | Not yet present. Enforcing one blind risks breaking Stripe, Google Places, analytics, and the service worker. Staged Report-Only plan in `docs/CSP_ROLLOUT_PLAN.md`. |
| **WebView debugging in production** | `webContentsDebuggingEnabled: true` for both platforms in a committed config consumed by Codemagic. Fixing it safely needs a build-time split plus a device test. `docs/NATIVE_HARDENING_REVIEW.md`. |

---

## Confirmed present in production (names only, never values)

`REVENUECAT_WEBHOOK_AUTH` · `STRIPE_WEBHOOK_SECRET` · `CRON_SECRET` ·
`ADMIN_PASSWORD`

The RevenueCat fix is safe to deploy **because** its variable is set. Had it
been missing, merging fail-closed would have halted iOS Pro grants — the
ordering matters, and should be re-confirmed before any future deploy that
touches webhook auth.

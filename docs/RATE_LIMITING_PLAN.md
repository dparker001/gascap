# Rate limiting — current state and migration path

**Status: PARTIALLY IMPLEMENTED.** Sprint 1 (2026-08-18) was analysis only.
Sprint 2 (2026-08-18) implemented Option A below (PostgreSQL) and applied it
to the two confirmed real gaps — password reset (had none) and OTP send
(consolidated off a redundant in-memory implementation). No new
infrastructure dependency was added.

---

## Current implementation

`lib/rateLimit.ts` — a module-level `Map`, with a 10-minute sweep for expired
entries. `checkRateLimit(key, limit, windowMs)`.

Two properties that matter:

1. **Resets on every deploy.** Counters live in process memory. GasCap deploys
   often; each deploy clears every limiter.
2. **Per-instance.** Correct only while Railway runs a single instance. Scaling
   horizontally silently multiplies every limit by the instance count.

Neither is a defect today — it is a documented single-instance design. Both
become defects the moment a second instance exists, and **silently**, which is
the concerning part.

## Coverage audit

| # | Surface | Limited today | Key | Backing store | Assessment |
|---|---|---|---|---|---|
| 1 | **OTP verify** | ✅ | email | in-memory (Sprint 1) | 5 / 10 min. Was unlimited: a 6-digit code, 10-minute life, and a correct guess mints a session. Not moved to Postgres this sprint — see note below. |
| 2 | OTP send | ✅ | email **+ IP** (Sprint 2) | **Postgres** | Was its own separate in-memory implementation (redundant with `lib/rateLimit.ts`), email-only. Consolidated onto `checkRateLimitDb`, gained an IP layer — email-only meant one caller could flood many different addresses since no single one ever hit its own cap. |
| 3 | Password sign-in | ✅ | IP | in-memory (pre-existing) | 15 / 15 min (`lib/auth.ts`). IP-keyed, so rotation defeats it; acceptable given bcrypt cost. |
| 4 | **Password reset** | ✅ **added Sprint 2** | email **+ IP** | **Postgres** | Confirmed to have NO rate limiting at all before Sprint 2's inspection. 3/email + 10/IP per hour, matching the reset token's own 1-hour expiry. Rate-limited requests still return the same generic `{ok:true}` as a real send — a different response shape on rate-limit would itself be an enumeration signal. |
| 5 | Registration | ✅ | IP | in-memory (pre-existing) | Adequate. |
| 6 | AI endpoints | ⚠️ partial | plan gate | — | Open-ended questions are Pro-gated, which bounds cost by subscription rather than by rate. A compromised Pro account could still run up Anthropic spend. **Deferred to Sprint 3** — see note below. |
| 7 | Receipt / gauge / VIN scan | ⚠️ partial | plan gate | — | Same as above — these spend real tokens per call. **Deferred to Sprint 3.** |
| 8 | Referral / giveaway | ⚠️ not audited | — | — | Compliance-sensitive: entry inflation is a sweepstakes-integrity issue, not just abuse. **Deferred to Sprint 3** — not touched this sprint; scoping it properly (which endpoints, what abuse pattern, what limit is even correct for a sweepstakes) is its own piece of work, not something to bolt on at the end of an already-large sprint. |

### Why #6–8 were not done this sprint

Sprint 2 already carried admin-auth migration, RevenueCat idempotency, and
entitlement reconciliation — all higher-consequence than these three. Rather
than rush a mechanical sweep across endpoints this pass didn't otherwise touch
(and risk a shallow, box-checking implementation), #6–8 are named explicitly
as deferred rather than silently left out. `checkRateLimitDb` is a stable,
tested primitive now — applying it to these three is mechanical work for
whoever picks it up next, not a design problem.

### Why OTP verify (#1) stayed on the in-memory limiter

Deliberately not moved to Postgres this sprint. It already works — Sprint 1
closed the actual vulnerability (unlimited guessing) — and moving a working
control for infrastructure-purity reasons alone is exactly the kind of churn
`/CLAUDE.md` and this sprint's brief both warn against. Worth doing eventually
for consistency, not urgent.

## Why not Redis this sprint

The brief said not to over-engineer, and it is right:

- Single instance today — a distributed store solves a problem not yet present.
- It adds a paid dependency, a failure mode (what happens when Redis is
  unreachable — fail open or fail closed?), and operational surface.
- The highest-value fix (#1) needed none of it.

## Migration path, in order of preference

**Option A — PostgreSQL. IMPLEMENTED Sprint 2** as `lib/rateLimitDb.ts` +
the `RateLimitCounter` table (additive, see
`docs/migrations/2026-08-sprint2-schema.sql`). `checkRateLimitDb(key, limit,
windowMs)` — same signature shape as the in-memory `checkRateLimit`, on
purpose, so callers read identically regardless of which backs them. Applied
to OTP send and password reset (§ above); #6–8 are the remaining surfaces to
point at it.

**Option B — Upstash Redis.** Serverless, HTTP, free tier. Correct if limits
ever need sub-millisecond checks or very high volume. Adds a vendor.

**Option C — Edge/WAF (Cloudflare).** DNS is already on Cloudflare. Best for
volumetric abuse *in front of* the app; a complement to A or B, not a
replacement — it cannot express "5 attempts per email address."

**Recommendation: A, then C.** Postgres removes the correctness problems with
zero new vendors; Cloudflare rules add volumetric protection at the edge.

## Design constraint for whoever does this

Keep `checkRateLimit(key, limit, windowMs)` as the call signature and swap the
backing store behind it. Sprint 1 deliberately used the existing helper for OTP
verify for exactly this reason: one implementation to replace, and no caller
changes. Decide explicitly whether the backing store failing means **fail open**
(availability) or **fail closed** (security) — per `/CLAUDE.md`, security-
sensitive paths fail closed, and OTP verify is one.

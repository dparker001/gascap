# Rate limiting — current state and migration path

**Status: PLANNED (analysis CURRENT).** Hardening sprint 1, 2026-08-18.
No new infrastructure dependency is proposed for adoption without approval.

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

| # | Surface | Limited today | Key | Assessment |
|---|---|---|---|---|
| 1 | **OTP verify** | ✅ added sprint 1 | email | 5 / 10 min. Was unlimited: a 6-digit code, 10-minute life, and a correct guess mints a session. |
| 2 | OTP send | ✅ pre-existing | email + IP | Adequate. |
| 3 | Password sign-in | ✅ pre-existing | IP | 15 / 15 min (`lib/auth.ts`). IP-keyed, so rotation defeats it; acceptable given bcrypt cost. |
| 4 | Password reset | ⚠️ verify | — | Confirm before Sprint 2; token-based, so exposure is lower. |
| 5 | Registration | ✅ pre-existing | IP | Adequate. |
| 6 | AI endpoints | ⚠️ partial | plan gate | Open-ended questions are Pro-gated, which bounds cost by subscription rather than by rate. A compromised Pro account could still run up Anthropic spend. |
| 7 | Receipt / gauge / VIN scan | ⚠️ partial | plan gate | Same as above — these spend real tokens per call. |
| 8 | Referral / giveaway | ⚠️ verify | — | Compliance-sensitive: entry inflation is a sweepstakes-integrity issue, not just abuse. Audit in Sprint 2. |

Priorities 6–8 are the meaningful gaps. All three are **cost or integrity**
risks rather than account-takeover risks, which is why sprint 1 addressed #1
first.

## Why not Redis this sprint

The brief said not to over-engineer, and it is right:

- Single instance today — a distributed store solves a problem not yet present.
- It adds a paid dependency, a failure mode (what happens when Redis is
  unreachable — fail open or fail closed?), and operational surface.
- The highest-value fix (#1) needed none of it.

## Migration path, in order of preference

**Option A — PostgreSQL (recommended first step).** A `RateLimit` table keyed
`(key, windowStart)` with an atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING
count`. No new dependency: the database is already there, already backed up,
already survives deploys. Slower than Redis, but these are auth and AI paths
measured in requests per minute, not per millisecond. **Fixes both current
weaknesses (deploy resets, multi-instance) with infrastructure already owned.**

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

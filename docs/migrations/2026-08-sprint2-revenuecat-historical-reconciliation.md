# Historical RevenueCat entitlement reconciliation — rollout sequence

**Status: BUILT, NOT RUN.** Post-Sprint-2 Revision 5, 2026-08-19. Nothing in
this document has been executed against production. This document
supersedes the Revision 4 version — the RevenueCat lookup client's actual
API contract, the legacy-contamination logic, Stripe evidence handling, and
the apply endpoint's atomicity/safety were all substantially rewritten in
Revision 5 in response to ChatGPT's independent review; see
`docs/reviews/2026-08-19-hardening-sprint-2-revision-5.md` for the full
findings and fixes.

---

## Why this exists

Before this hardening sprint's provenance fix, every RevenueCat grant wrote
`interval` into `stripeInterval` — the same field genuine Stripe/gift
purchases use. Separately, old RevenueCat EXPIRATION/REFUND handling called
`setUserPlan(userId, 'free')`, which never cleared `stripeInterval`. That
means an existing production row can have a `stripeInterval` value that's
either genuine Stripe/gift provenance, or leftover contamination from the
old RC bug — and a `plan='free'` row can still be hiding a legitimate
surviving entitlement. The new `revenueCatActive`/`revenueCatInterval`
columns also default to `false`/`null` on every existing row, which is not
necessarily true for a currently-active RevenueCat customer.

See `lib/revenueCatHistoricalReconciliation.ts` for the full design
rationale, `lib/revenueCatApi.ts` for the RevenueCat lookup client, and
`lib/stripeEvidence.ts` for the verified-Stripe-purchase check. All three
are unit-tested (`__tests__/revenueCatHistoricalReconciliation.test.ts` — 29
tests, `__tests__/revenueCatApi.test.ts` — 13 tests,
`__tests__/stripeEvidence.test.ts` — 7 tests) but have never been run
against real data — this environment has no path to production's actual
database contents or a live RevenueCat account to validate the
classification against real rows.

## RevenueCat API — v2, read-only, production-only, paginated

Revision 3's dry run used `GET /v1/subscribers/{app_user_id}` — RevenueCat's
own documentation titles this endpoint "Get **or Create** Customer," meaning
it can create a RevenueCat customer for an unknown `app_user_id` as a side
effect. Revision 4 replaced it with a v2 client, but that FIRST v2
implementation was itself found to be wrong on independent re-review of
RevenueCat's actual v2 contract: `active_entitlements` items don't have a
`product_id` field at all, `entitlement_id` there is RevenueCat's INTERNAL
entitlement id (not the configured lookup key like `pro` — comparing it
against `'pro'` directly could never actually match in real use), and the
endpoint doesn't distinguish sandbox from production transactions.

Revision 5 abandons `active_entitlements` entirely for a different, more
authoritative set of v2 resources:

1. `GET /v2/projects/{project_id}/customers?search={app_user_id}` — resolve
   a customer id without creating one. Paginated.
2. `GET /v2/projects/{project_id}/entitlements` — the project's entitlement
   catalog; resolves the configured lookup key (`pro`) to RevenueCat's
   internal entitlement id. Paginated.
3. `GET /v2/projects/{project_id}/customers/{customer_id}/subscriptions?environment=production`
   — the customer's PRODUCTION subscriptions only. Paginated. Only counts if
   an item's `entitlements` array includes the resolved internal entitlement
   id and its `status` is one of the "still has access" states.
4. `GET /v2/projects/{project_id}/customers/{customer_id}/purchases?environment=production`
   — the customer's PRODUCTION one-time purchases (e.g. Lifetime) only.
   Paginated. A non-refunded matching purchase grants Pro permanently.
5. `GET /v2/projects/{project_id}/products/{product_id}` — resolves
   RevenueCat's internal product id to the store-facing identifier
   (`gascap_pro_monthly` / `gascap_pro_lifetime`) already used everywhere
   else in this codebase for `revenueCatProductId`. If this resolution
   fails, `productId` is reported as `null` — RevenueCat's internal id
   (`prod...`) is never allowed to leak into that column.

Every list response's pagination is followed via its own `next_page` value
— never a hand-constructed offset/cursor — until exhausted.

Required env vars, distinct from `REVENUECAT_WEBHOOK_AUTH`:

- `REVENUECAT_V2_SECRET_KEY` — grant this key **read-only** permissions in
  the RevenueCat dashboard (Project Settings → API Keys). Minimal categories:
  `customer_information:customers:read`,
  `customer_information:subscriptions:read`,
  `customer_information:purchases:read`,
  `project_configuration:entitlements:read`,
  `project_configuration:products:read`. **No `read_write` permission.**
- `REVENUECAT_PROJECT_ID` — the RevenueCat project id.
- `REVENUECAT_PRO_ENTITLEMENT_ID` (optional, defaults to `'pro'`) — the
  entitlement LOOKUP KEY (not RevenueCat's internal id) RevenueCat uses for
  GasCap Pro, only needed if it differs from `'pro'` in the RevenueCat
  dashboard.

Without both required vars configured, or if the configured lookup key
doesn't match any entitlement in the project's catalog,
`fetchAuthoritativeRevenueCatState` throws rather than silently returning
"not found" — a missing/misconfigured lookup is never conflated with a
confirmed-inactive result anywhere in this pipeline.

`__tests__/revenueCatApi.test.ts` (25 tests) includes the specific proof
this review required: an unknown `app_user_id` makes exactly **one** fetch
call (the search) and never creates anything; every list endpoint's
pagination is exercised with a target record on the second page; production
filtering is asserted on every subscriptions/purchases call; and a resolved
product id is proven to be the store-facing identifier, never RevenueCat's
raw internal id.

## What changed in candidate scope (Revision 3 → 4)

Revision 3's query only searched `plan IN ('pro','fleet') AND stripeInterval
!= null`. That misses rows where the old RC-revoke bug already downgraded
`plan` to `'free'` without clearing `stripeInterval` — a legitimate Stripe/
gift Lifetime user could exist today as `plan='free',
stripeInterval='lifetime'` purely because of an unrelated RC-side event.

Revision 4's candidate query is not plan-gated. It includes any user with
**any** of: `stripeInterval != null`, `stripeSubscriptionId != null`,
`ambassadorProForLife`, a redeemed Gift, or `plan IN ('pro','fleet')`.

For **every** candidate — not only ones lacking internal evidence — the dry
run now performs a live RevenueCat lookup. Revision 3 skipped the lookup
whenever internal evidence already existed, which meant a user with an
active Stripe subscription who *also* had a live RevenueCat entitlement
never got `revenueCatActive` backfilled — a later Stripe cancellation would
then wrongly downgrade them, since the resolver had no record of the
surviving RC source. `classifyProvenance()` now combines both evidence
sources unconditionally and reports `multiple_legitimate_sources` whenever
more than one confirmed source exists.

## Classification categories

- `confirmed_stripe_subscription` — active `stripeSubscriptionId`.
- `confirmed_stripe_lifetime` — **only** via a verified Stripe Checkout
  Session for the Lifetime price (`lib/stripeEvidence.ts`), never from
  `stripeCustomerId` presence alone. `stripeCustomerId` gets attached to a
  User row just from opening Stripe's billing portal, with no purchase
  involved (see `isRealPurchaseOrRenewal` in `lib/users.ts`) — combined with
  historical RC code separately writing `stripeInterval='lifetime'`,
  `stripeCustomerId + stripeInterval==='lifetime'` alone proves nothing.
- `confirmed_gifted_lifetime` — a redeemed Gift record.
- `confirmed_ambassador` — `ambassadorProForLife`.
- `confirmed_active_rc_monthly` / `confirmed_active_rc_lifetime` — a live,
  authoritative RevenueCat lookup confirms an active `pro` entitlement.
- `confirmed_legacy_rc_contamination` — exactly one confirmed source, and
  it's a lone active RC entitlement, with a `stripeInterval` value that
  nothing else explains.
- `multiple_legitimate_sources` — more than one confirmed source (e.g.
  Stripe subscription + RC monthly, gift Lifetime + RC monthly, Ambassador +
  RC Lifetime).
- `ambiguous_legacy_provenance` — nothing could be confirmed. Left
  completely untouched by apply, always.

### Field-specific legacy contamination logic (Revision 5)

Revision 4 only proposed clearing `stripeInterval` when the candidate had
**exactly one** confirmed source overall — but a user can have TWO genuine,
unrelated confirmed sources where NEITHER explains a specific contaminated
`stripeInterval` value. Example: a genuine Stripe MONTHLY subscription
**and** a genuine active RevenueCat LIFETIME entitlement, with a leftover
`stripeInterval='lifetime'` marker from the pre-fix bug. The monthly
subscription doesn't explain a Lifetime marker; Ambassador status doesn't
explain a Stripe-provenance marker either.

Revision 5 separates two questions:

- **"What sources does this user have?"** — drives the overall
  classification label (`multiple_legitimate_sources` vs. a single
  `confirmed_*` category) and which RC fields get backfilled.
- **"What legitimate source explains THIS specific `stripeInterval`
  value?"** — drives `proposedClearLegacyStripeInterval`, independently of
  the label above. For `stripeInterval='lifetime'`, only a VERIFIED Stripe
  Lifetime purchase or a redeemed Gift explain it. For `'monthly'`/`'annual'`,
  only a genuine `stripeSubscriptionId` explains it. A candidate can
  therefore be `multiple_legitimate_sources` **and** carry
  `proposedClearLegacyStripeInterval: true` at the same time — the RC
  backfill and the genuine second source are both preserved; only the
  unexplained marker is cleared.

**Stripe Lifetime evidence is tri-state**, not a boolean
(`VERIFIED_LIFETIME` / `VERIFIED_NO_LIFETIME` / `INCONCLUSIVE` — see
`lib/stripeEvidence.ts`). Only `VERIFIED_NO_LIFETIME` may ever support a
destructive clear; `INCONCLUSIVE` (a Stripe API failure, pagination error,
etc.) makes that specific field's contamination proposal ineligible, even
when RevenueCat's state would otherwise support it — a Stripe outage must
never be read as proof of absence. `verifyStripeLifetimePurchase` fully
paginates both the Checkout Session list and each session's line items
before concluding `VERIFIED_NO_LIFETIME`, so an older purchase past the
first 100 sessions is never missed.

## Historical plan repair requires LIVE Stripe subscription verification

During normal runtime, GasCap's billing policy treats
`stripeSubscriptionId != null` as sufficient — the Stripe webhook keeps it
fresh, clearing it only on `customer.subscription.deleted`. This migration
does **not** change that policy. But a `plan='free' → 'pro'` REPAIR must not
fire off a stale id that Stripe would actually report as canceled (e.g.
from a missed webhook delivery, which this repair tool exists specifically
to catch and correct for other fields). Whenever a repair might depend on a
stored `stripeSubscriptionId`, `verifyStripeSubscriptionActive` checks
Stripe live before that specific decision (tri-state: `VERIFIED_ACTIVE` /
`VERIFIED_INACTIVE` / `INCONCLUSIVE`). If the check is inconclusive or
reports inactive, the repair is not proposed **on that evidence alone** —
another independently confirmed source (Ambassador, verified Stripe
Lifetime, gift, active RC) can still justify it on its own.

## Proposed repairs, computed per candidate

After classification, the dry run recomputes the central
`resolveUserEntitlements()` resolver using the *proposed* RC fields, a
possibly-nulled `stripeInterval`, and — for the repair decision specifically
— a `stripeSubscriptionId` that's only included if it was live-verified
active. If that recomputation says Pro but the stored `plan` says free, the
candidate is flagged `historicalPlanInconsistency: true` with
`proposedPlanRepair: 'pro'`. A repair is **never** proposed in the other
direction — this migration cannot downgrade anyone.

## Apply is atomic per candidate and bound to the reviewed report

Every candidate's approved changes — RC field backfill, legacy
`stripeInterval` clear, plan repair — are combined into exactly **one**
`prisma.user.update` call. Either all of that candidate's proposed changes
land, or none do; one candidate's DB failure never leaves it in a partial,
mixed state, and never blocks another candidate's independent update.

`POST` requires `{ "confirm": true, "reportHash": "<the GET response's reportHash>" }`.
`reportHash` is a deterministic, canonical (order-independent) hash over
every candidate's proposed mutation only — never volatile counters or log
text. `POST` recomputes the dry run live and compares hashes; if RevenueCat
or Stripe state changed between GET and POST (or anything else changed the
proposal) since the report was reviewed, the hash won't match and the
request is refused with **409**, applying nothing. Only an exact match
proceeds to apply.

## What it does NOT do

It never downgrades anyone. It never clears `stripeInterval` except when a
specific value is positively proven unexplained. It never guesses — a
candidate whose provenance can't be confirmed from GasCap's own records or a
live RevenueCat/Stripe lookup is left completely untouched and reported as
`ambiguous_legacy_provenance`. It never applies a proposal that wasn't the
one actually reviewed (`reportHash` binding).

## Rollout sequence

1. **Deploy this sprint's code.** No behavior change on deploy — the new
   endpoint requires an explicit admin call.
2. **Configure `REVENUECAT_V2_SECRET_KEY` and `REVENUECAT_PROJECT_ID`** in
   Railway, using a key scoped to **read-only** permissions in the
   RevenueCat dashboard. Without both configured, `GET` on the endpoint will
   fail outright (the lookup throws) rather than silently degrading to
   internal-evidence-only classification — this is intentional, since a
   degraded run without a clear signal risks under-classifying
   `multiple_legitimate_sources` candidates as single-source.
3. **Smoke-test the v2 client against a real RevenueCat account before
   trusting it operationally** — specifically confirm a known active
   customer resolves correctly, and a genuinely unknown `app_user_id`
   returns `customerFound: false` **without** creating a customer in the
   RevenueCat dashboard. This has not been independently verified against a
   live account from this environment.
4. **Run the dry-run report** (read-only, makes zero writes to GasCap's
   database or to RevenueCat):
   ```bash
   curl https://www.gascap.app/api/admin/revenuecat-historical-reconciliation \
     -H "x-admin-password: $ADMIN_PASSWORD"
   ```
   (Or via a signed-in admin session — no header needed.)
5. **Review the report before doing anything else.** Check:
   - `totalCandidates` — the full candidate pool under the broadened scope.
   - Classification breakdown, especially `multiple_legitimate_sources`
     count (this category did not exist as a distinct signal before
     Revision 4) and `confirmed_legacy_rc_contamination` count (the only
     category that proposes a destructive `stripeInterval` clear).
   - `historicalPlanInconsistencyCount` — accounts currently `plan='free'`
     that resolved evidence says should be Pro. Inspect these individually.
   - `ambiguousCount` — never touched by apply, automatically.
   - Any RC lookup failure count — a failed lookup is reported distinctly
     from a confirmed-inactive result; a spike here means fix the API
     configuration and re-run before trusting a high ambiguous count.
6. **Manually inspect a sample of `confirmed_active_rc_*`,
   `confirmed_legacy_rc_contamination`, and `historicalPlanInconsistency`
   candidates** against the RevenueCat dashboard and Stripe dashboard
   directly before trusting the automated classification at scale.
7. **Only after Don explicitly approves**, apply — echoing back the EXACT
   `reportHash` from the GET response just reviewed:
   ```bash
   curl -X POST https://www.gascap.app/api/admin/revenuecat-historical-reconciliation \
     -H "x-admin-password: $ADMIN_PASSWORD" \
     -H "content-type: application/json" \
     -d '{"confirm": true, "reportHash": "<paste the reviewed GET response'\''s reportHash here>"}'
   ```
   If RevenueCat/Stripe state changed since that GET (or any other
   proposal-relevant change occurred), the live hash won't match and this
   returns **409** with `"Reconciliation report changed. Run/review GET
   again."` — applying nothing. On a match, each candidate's approved
   changes (RC field backfill, legacy `stripeInterval` clear, plan repair —
   whichever apply to that specific candidate) are combined into ONE atomic
   update per candidate; a failure on one candidate never partially mutates
   it and never blocks another candidate's independent update.

   Every `ambiguous_legacy_provenance` row, and every candidate with no
   proposed changes at all, is left exactly as it was.
8. **Re-run the GET afterward** to confirm the apply's effect and that
   `ambiguousCount` reflects the expected remainder.
9. **Ambiguous rows are a separate, manual follow-up** — not automatable
   from GasCap's data alone. Options for a future pass: request a full
   RevenueCat customer export and cross-reference by email, or accept the
   remaining ambiguity as permanent (the provenance fix means
   `stripeInterval` can no longer be corrupted going forward — ambiguity
   here is strictly about the past, not an ongoing risk).

## Live webhook edge cases now use this same authoritative lookup

Revision 4 also routes two live webhook paths through the same
`fetchAuthoritativeRevenueCatState` / `syncRevenueCatEntitlementFromProvider`
helpers used by this migration, rather than trusting the webhook payload's
own claims:

- **CANCELLATION with `cancel_reason=CUSTOMER_SUPPORT`** — RevenueCat's docs
  warn this doesn't necessarily mean auto-renewal was deactivated. The route
  now re-fetches authoritative RC state and only clears the RC contribution
  if it's actually gone; a lookup failure fails the webhook (500) so
  RevenueCat retries, rather than guessing.
- **TRANSFER** — reconciles both `transferred_from` and `transferred_to`
  identities against their real current RC state (never a guessed
  "monthly" grant), gathering all lookups before mutating any GasCap user
  so a failure partway through never leaves a half-guessed state.

See `app/api/native/revenuecat/route.ts` and
`__tests__/revenuecatWebhook.test.ts` for the full behavior and test
coverage.

## Rollback

The apply step is purely additive/corrective on existing columns — a
targeted rollback needs the exact user id list from that run's
`AdminAuditLog` entry (`revenuecat.historical_reconciliation_apply`), which
records totals but not individual ids. If a rollback by exact id list is
ever needed, capture the POST response's full data before running it, since
it isn't separately persisted beyond the audit log summary.

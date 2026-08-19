# Historical RevenueCat entitlement reconciliation — rollout sequence

**Status: BUILT, NOT RUN.** Post-Sprint-2 Revision 4, 2026-08-19. Nothing in
this document has been executed against production. This document
supersedes the Revision 2 version — the RevenueCat lookup client, candidate
scope, and classification categories were all substantially rewritten in
Revision 4 in response to ChatGPT's independent review; see
`docs/reviews/2026-08-19-hardening-sprint-2-revision-4.md` for the full
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

## RevenueCat API — v2, read-only, dedicated key

Revision 3's dry run used `GET /v1/subscribers/{app_user_id}` — RevenueCat's
own documentation titles this endpoint "Get **or Create** Customer," meaning
it can create a RevenueCat customer for an unknown `app_user_id` as a side
effect. That made the "read-only" dry run not actually read-only with
respect to RevenueCat's system of record. Revision 4 replaces it with the
v2 API's genuinely read-only endpoints:

- `GET /v2/projects/{project_id}/customers?search={app_user_id}` — search,
  never creates.
- `GET /v2/projects/{project_id}/customers/{customer_id}/active_entitlements`
  — read the customer's current entitlement state.

Required env vars, distinct from `REVENUECAT_WEBHOOK_AUTH`:

- `REVENUECAT_V2_SECRET_KEY` — grant this key **read-only** permissions in
  the RevenueCat dashboard (Project Settings → API Keys). It should not be
  able to create, modify, or grant/revoke entitlements.
- `REVENUECAT_PROJECT_ID` — the RevenueCat project id.
- `REVENUECAT_PRO_ENTITLEMENT_ID` (optional, defaults to `'pro'`) — the
  entitlement identifier RevenueCat uses for GasCap Pro, only needed if it
  differs from `'pro'` in the RevenueCat dashboard.

Without both required vars configured, `fetchAuthoritativeRevenueCatState`
throws rather than silently returning "not found" — a missing lookup is
never conflated with a confirmed-inactive result anywhere in this pipeline.

`__tests__/revenueCatApi.test.ts` includes the specific proof this review
required: an unknown `app_user_id` makes exactly **one** fetch call (the
search) and never a second call to any write/create endpoint.

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
- `confirmed_legacy_rc_contamination` — **exactly one** confirmed source,
  and it's a lone active RC entitlement, with a `stripeInterval` value that
  nothing else explains. Only this category ever proposes
  `proposedClearLegacyStripeInterval: true`.
- `multiple_legitimate_sources` — more than one confirmed source (e.g.
  Stripe subscription + RC monthly, gift Lifetime + RC monthly, Ambassador +
  RC Lifetime). Never proposes clearing `stripeInterval` — genuine
  multi-source Lifetime provenance is preserved exactly as-is.
- `ambiguous_legacy_provenance` — nothing could be confirmed. Left
  completely untouched by apply, always.

## Proposed repairs, computed per candidate

After classification, the dry run re-runs the central `resolveUserEntitlements()`
resolver using the *proposed* RC fields (and a possibly-nulled
`stripeInterval` for confirmed contamination) to compute
`resolvedShouldBePro` / `resolvedSources`, and compares that against the
row's *current stored* `plan`. If the resolver says Pro but the stored plan
says free, the candidate is flagged `historicalPlanInconsistency: true` with
`proposedPlanRepair: 'pro'`. Examples this catches: `plan=free` + a
confirmed Stripe Lifetime purchase; `plan=free` + a redeemed gift Lifetime;
`plan=free` + Ambassador; `plan=free` + an active RC entitlement. A repair
is **never** proposed in the other direction — this migration cannot
downgrade anyone.

## What it does NOT do

It never downgrades anyone. It never clears `stripeInterval` except for the
narrowly-defined `confirmed_legacy_rc_contamination` case. It never guesses
— a candidate whose provenance can't be confirmed from GasCap's own records
or a live RevenueCat/Stripe lookup is left completely untouched and
reported as `ambiguous_legacy_provenance`.

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
7. **Only after Don explicitly approves**, apply the confirmed subset:
   ```bash
   curl -X POST https://www.gascap.app/api/admin/revenuecat-historical-reconciliation \
     -H "x-admin-password: $ADMIN_PASSWORD" \
     -H "content-type: application/json" \
     -d '{"confirm": true}'
   ```
   This performs three independent, additive-only operations, each only for
   the candidates that specifically qualify:
   - RC field backfill (`revenueCatActive`/`revenueCatInterval`/
     `revenueCatProductId`) for any candidate with a confirmed active RC
     entitlement.
   - Legacy `stripeInterval` clear — **only** for
     `confirmed_legacy_rc_contamination` candidates.
   - Plan repair (`plan` → `'pro'`) — **only** for candidates with
     `proposedPlanRepair: 'pro'`.

   Every `ambiguous_legacy_provenance` row, and every candidate not
   specifically flagged for one of the three operations above, is left
   exactly as it was.
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

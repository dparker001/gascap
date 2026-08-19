# Historical RevenueCat entitlement reconciliation — rollout sequence

**Status: BUILT, NOT RUN.** Post-Sprint-2 Revision 2, 2026-08-18. Nothing in
this document has been executed against production.

---

## Why this exists

Before this hardening sprint's provenance fix, every RevenueCat grant wrote
`interval` into `stripeInterval` — the same field genuine Stripe/gift
purchases use. That means an EXISTING production user's `stripeInterval`
value may be genuine Stripe/gift provenance, or may be a RevenueCat-
originated value from the old bug — the column alone can't tell you which.
Separately, the new `revenueCatActive`/`revenueCatInterval` columns default
to `false`/`null` on every existing row, which is not necessarily true for a
currently-active RevenueCat customer.

See `lib/revenueCatHistoricalReconciliation.ts` for the full design
rationale and `lib/revenueCatApi.ts` for the RevenueCat subscriber-lookup
client. Both are built and unit-tested (`__tests__/revenueCatHistoricalReconciliation.test.ts`,
19 tests) but have never been run against real data — this environment has
no path to production's actual database contents or a live RevenueCat
account to validate the classification against real rows.

## What it does NOT do

It never downgrades, clears, or overwrites `stripeInterval` or any other
existing field. It never guesses. A user whose provenance can't be confirmed
from GasCap's own records or a live RevenueCat lookup is left completely
untouched and reported as `ambiguous_legacy_provenance` — not assumed to be
either Stripe-provenance or RC-inactive.

## Rollout sequence

1. **Deploy this sprint's code.** No behavior change on deploy — the new
   endpoint requires an explicit admin call.
2. **(Optional but recommended) Configure `REVENUECAT_SECRET_API_KEY`** in
   Railway — RevenueCat's Secret API Key (Project Settings → API Keys in
   the RevenueCat dashboard), distinct from `REVENUECAT_WEBHOOK_AUTH`. Without
   it, the dry-run report can still classify every user with corroborating
   internal evidence (Stripe subscription, gift redemption, Ambassador flag)
   but cannot resolve any candidate that has none — those all report as
   ambiguous rather than being confirmed either way.
3. **Run the dry-run report** (read-only, makes zero writes):
   ```bash
   curl https://www.gascap.app/api/admin/revenuecat-historical-reconciliation \
     -H "x-admin-password: $ADMIN_PASSWORD"
   ```
   (Or via a signed-in admin session — no header needed.)
4. **Review the report before doing anything else.** Check:
   - `totalCandidates` — how many pro/fleet users have a non-null
     `stripeInterval` at all (the full candidate pool).
   - `classifications` — the breakdown by category.
   - `ambiguousCount` — how many could not be confirmed either way. These
     are NOT touched by step 6 below, ever, automatically.
   - `rcLookupConfigured` / `rcLookupAttempted` / `rcLookupFailed` — if the
     API key wasn't configured, or many lookups failed, `ambiguousCount`
     will be inflated by that, not by genuine ambiguity — fix the
     configuration and re-run the GET before treating a high ambiguous
     count as final.
5. **Manually inspect a sample of `confirmed_active_rc_*` candidates**
   against the RevenueCat dashboard directly before trusting the automated
   classification at scale — this has never been validated against a real
   RevenueCat account from this environment.
6. **Only after Don explicitly approves**, apply the confirmed subset:
   ```bash
   curl -X POST https://www.gascap.app/api/admin/revenuecat-historical-reconciliation \
     -H "x-admin-password: $ADMIN_PASSWORD" \
     -H "content-type: application/json" \
     -d '{"confirm": true}'
   ```
   This populates `revenueCatActive`/`revenueCatInterval`/`revenueCatProductId`
   ONLY for candidates classified `confirmed_active_rc_monthly`,
   `confirmed_active_rc_lifetime`, or `multiple_legitimate_sources` with a
   confirmed RC component. Every other row, including every
   `ambiguous_legacy_provenance` row, is left exactly as it was.
7. **Re-run the GET afterward** to confirm the apply's effect and that
   `ambiguousCount` reflects the expected remainder.
8. **Ambiguous rows are a separate, manual follow-up** — not automatable
   from GasCap's data alone. Options for a future pass: request a full
   RevenueCat customer export and cross-reference by email, or accept the
   remaining ambiguity as permanent (their `stripeInterval` value is
   presumed to keep meaning whatever it already implies today, since the
   provenance fix means it can no longer be corrupted going forward —
   ambiguity here is about the past, not an ongoing risk).

## Rollback

Step 6 is purely additive (new columns only) — reverting is a targeted
`UPDATE "User" SET "revenueCatActive" = false, "revenueCatInterval" = NULL,
"revenueCatProductId" = NULL WHERE id IN (...)` using the exact user id list
from that run's `AdminAuditLog` entry (`revenuecat.historical_reconciliation_apply`),
which records the totals but not (yet) the individual ids — if a rollback
by exact id list is ever needed, capture the POST response's data before
running it, since it isn't separately persisted beyond the audit log summary.

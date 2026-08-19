# ChatGPT Review Packet — Hardening Sprint 2, Revision 7

Response to ChatGPT's Revision 6 independent review ("CHATGPT INDEPENDENT
REVIEW — HARDENING SPRINT 2 REVISION 6 — STATUS: REQUEST CHANGES — FINAL
CODE-SAFETY PASS BEFORE LIVE PROVIDER SMOKE TEST").

---

## 1. Objective

Revision 6's review was, in its own words, "substantially accepted," with
a small, targeted correction pass: fix the RevenueCat alias-lookup
endpoint (found to be assumed rather than the real documented resource),
de-scope the automatic `stripeInterval` clear entirely (a deliberate
architecture reduction, not a bug fix — the review concluded no rule this
tool can build is safe enough for an automatic destructive bulk action),
rename the Stripe evidence result so search absence can't be mistaken for
proof, exclude trial status from historical plan repairs, and add
`currentRevenueCatProductId` to the optimistic-concurrency precondition.
The review explicitly said this pass should be small and told Claude not
to reopen any previously-accepted architecture. After this pass, the
review declared the live RevenueCat smoke test a hard gate — no further
abstract API-shape redesign should happen without checking a real
response first — and asked for a prepared, read-only smoke-test procedure.

## 2. Repository State

- **Branch:** `hardening/sprint-2`
- **Review Target SHA:** `9f55b96`
- **Packet Commit SHA:** to be assigned when this file is committed (a
  separate, later commit).
- **Base branch:** `main`
- **Relevant PR:** none opened, per standing instruction.
- **Review this diff:** `git diff --name-status 24d55ce...9f55b96`
  (`24d55ce` = the Revision 6 packet's own commit, the state ChatGPT's
  Revision 6 review was reviewing):
  ```
  M	__tests__/revenueCatApi.test.ts
  M	__tests__/revenueCatHistoricalReconciliation.test.ts
  M	__tests__/stripeEvidence.test.ts
  M	app/api/admin/revenuecat-historical-reconciliation/route.ts
  M	docs/migrations/2026-08-sprint2-revenuecat-historical-reconciliation.md
  M	lib/revenueCatApi.ts
  M	lib/revenueCatHistoricalReconciliation.ts
  M	lib/stripeEvidence.ts
  A	scripts/revenuecat-smoke-test.mjs
  ```
  9 files: 1 new, 8 modified.

## 3. What I Found

Verified every Revision 6 finding against the actual repository:

- `lib/revenueCatApi.ts`'s `verifyAlias` did call
  `GET .../customers/{customer_id}` (the Customer detail resource) and
  parse an `aliases?: string[]` field from it — confirmed no such
  dedicated field exists per RevenueCat's actual documented contract; the
  review's description of the correct dedicated `/aliases` endpoint (with
  its `customer.alias` item shape) matches what independent review found.
- Confirmed `lib/revenueCatHistoricalReconciliation.ts`'s
  `applyReconciliation` did still write `data.stripeInterval = null` when
  `c.proposedClearLegacyStripeInterval` was true — the exact destructive
  path the review said to remove.
- Confirmed `lib/stripeEvidence.ts`'s `StripeLifetimeEvidenceStatus`
  union still included `VERIFIED_NO_LIFETIME`, and that
  `verifyStripeLifetimePurchase` returned it whenever a complete search
  found no match — a genuinely ambiguous name for a result that (per the
  review's point about Stripe Search's eventual consistency) is not
  actually verified-absent.
- Confirmed `buildDryRunReport`'s `repairResolved` computation passed
  `u.isProTrial`/`u.trialExpiresAt` straight through unmodified — verified
  against `lib/entitlements.ts` that `resolveUserEntitlements` does treat
  an active trial alone as sufficient for `pro: true`, confirming the
  described gap.
- Confirmed `computeReportHash`'s canonical projection and
  `applyReconciliation`'s `updateMany` `where` clause both omitted
  `revenueCatProductId` entirely, even though `applyReconciliation` writes
  that field on RC backfill — a real gap in the optimistic-concurrency
  coverage.

No part of Revision 6's finding was found to be stale or already
addressed — every item required real code changes.

## 4. What I Changed

**`lib/revenueCatApi.ts`**:
- New `verifyAlias(customerId, appUserId, apiKey, projectId)` calls
  `GET /v2/projects/{project_id}/customers/{customer_id}/aliases`,
  paginated via the shared `fetchAllPages` helper, and checks whether any
  page's `items[].id` equals the searched app_user_id.
- `findCustomerId` rewritten per the review's exact 7-step algorithm: an
  exact `id` match on any search-result page accepts immediately;
  otherwise every distinct non-exact candidate id is collected and its
  alias list is verified individually (not just when there's a single
  candidate, as Revision 6 did); exactly one verified match resolves to
  that canonical id; zero or more than one verified match resolves to "not
  found," never a guess; any alias-list fetch failure propagates (throws).

**`lib/stripeEvidence.ts`**:
- `StripeLifetimeEvidenceStatus` is now `'VERIFIED_LIFETIME' | 'NO_MATCH' |
  'INCONCLUSIVE'` — `NO_MATCH` replaces `VERIFIED_NO_LIFETIME`, with an
  expanded doc comment explaining why: Stripe's Search API is documented
  as eventually consistent, and this repository can only prove *today's*
  Checkout Session code writes the metadata this evidence correlates on —
  not every historical GasCap Lifetime sale across every prior code
  version. The renamed type makes it structurally harder for a future
  caller to mistake "no match found" for "proven absent."
- `verifyStripeSubscriptionActive`'s status matrix is unchanged this round
  (already correct per the Revision 6 review's explicit "past_due —
  approved" note).

**`lib/revenueCatHistoricalReconciliation.ts`** — the largest change this
round:
- `ReconciliationCandidate.proposedClearLegacyStripeInterval` renamed to
  `suspectedLegacyStripeIntervalContamination`, documented explicitly as
  report-only. `classifyProvenance` still computes it identically (same
  field-specific-explanation logic from Revision 5, still correctly
  requiring `NO_MATCH` — never `INCONCLUSIVE` — plus a live active RC
  entitlement to flag it), but the value is now purely informational.
- New `currentRevenueCatProductId` field on `ReconciliationCandidate`,
  populated from the newly-added `revenueCatProductId` column in
  `CandidateUserRow`'s Prisma select, included in `computeReportHash`'s
  canonical precondition projection.
- Historical plan repair's `repairResolved` computation now hard-codes
  `isProTrial: false, trialExpiresAt: null` — trial status can never
  contribute to a repair decision, regardless of the candidate's actual
  stored trial state. The informational `resolved` computation (used for
  `resolvedShouldBePro`/`resolvedSources` reporting) is untouched and still
  reflects full evidence including trial status, for transparency.
- `applyReconciliation` rewritten: the `data` payload building code no
  longer has any branch that can set `stripeInterval`. The optimistic-
  concurrency `updateMany` `where` clause now includes `revenueCatProductId:
  c.currentRevenueCatProductId`. `BackfillResult.legacyClearProposed`
  removed; new `BackfillResult.suspectedContaminationCount` (a simple
  report-only tally, computed once at the top of the function from
  `report.candidates`, never influencing any write).

**`app/api/admin/revenuecat-historical-reconciliation/route.ts`** — Doc
comments and the POST response `message` updated to state plainly that
this bulk endpoint never clears `stripeInterval` and to surface
`suspectedContaminationCount` as informational.

**`scripts/revenuecat-smoke-test.mjs`** (new) — A standalone, dependency-
free Node script (no Prisma import, no Next.js build dependency) mirroring
`lib/revenueCatApi.ts`'s request logic, runnable directly with
`node scripts/revenuecat-smoke-test.mjs --flag=<app_user_id>` for each of
the five identity types the review asked for (active-monthly, lifetime,
no-entitlement, unknown, alias). Every call is a `GET`; never logs the
secret key, the Authorization header, or a full raw provider payload —
only the derived, sanitized `customerFound`/`active`/`interval`/
`productId` classification. Exits with a clear error if the required env
vars aren't set, rather than silently no-op'ing.

**Tests** — `__tests__/revenueCatApi.test.ts` rewritten for the alias
section (31 tests, was 29): provider-real `/aliases` list mocks throughout,
a nested-pagination test for the alias list itself, and a new test proving
every non-exact candidate is individually verified (a match on the
*second* candidate is found, not skipped after the first fails).
`__tests__/stripeEvidence.test.ts` (21 tests, same count — mechanical
rename of `VERIFIED_NO_LIFETIME` → `NO_MATCH` throughout, no logic
change). `__tests__/revenueCatHistoricalReconciliation.test.ts` rewritten
extensively (64 tests, was 58): every prior contamination-detection test
now asserts the flag is set but never checks for a destructive proposal
(since there is none); new tests proving `applyReconciliation` writes
`stripeInterval` under zero circumstances, checked individually and across
a mixed batch of three different candidate types in one call; the required
trial-exclusion matrix (trial-only → no repair, trial+RC → repair via RC,
trial+Ambassador → repair via Ambassador, trial+Stripe → repair via
Stripe, plus an additional trial+unverified-Stripe → still no repair);
and a `currentRevenueCatProductId` optimistic-concurrency staleness test.

## 5. Architectural Decisions

- **`suspectedLegacyStripeIntervalContamination` is a genuine field rename
  with genuinely different semantics, not a cosmetic relabeling.** The
  underlying `classifyProvenance` computation is unchanged — same
  field-specific explanation logic, same requirement that only a live
  active RC entitlement plus a definitively non-explaining Stripe check
  (`NO_MATCH`, never `INCONCLUSIVE`) can flag it. What changed is that
  `applyReconciliation` now structurally cannot read this field for
  mutation purposes — there is no code path from "flag is true" to "a
  write happens." This was a deliberate choice to make the safety
  guarantee hard to accidentally regress, rather than relying on a
  comment or convention.
- **The trial-exclusion is scoped narrowly to the repair DECISION, not to
  reporting.** Considered stripping trial fields from the informational
  `resolved` computation too (for consistency), but kept that computation
  using the real stored trial state — an admin reviewing the dry-run
  report should still see "this account currently resolves as Pro
  (including via trial)" as context, even though that fact specifically
  cannot justify an automatic historical repair. Two separate resolver
  calls with different inputs, serving different purposes, was judged
  clearer than one call with a flag threading through.
- **The smoke-test script is deliberately standalone (no imports from
  `lib/`).** Considered having it import and call
  `fetchAuthoritativeRevenueCatState` directly for less duplication, but
  that would require either compiling TypeScript or adding a runtime
  dependency (ts-node/tsx) this repository doesn't currently have
  installed. A plain `.mjs` script anyone can run with just `node` was
  judged more valuable for an operational, one-off diagnostic tool than
  avoiding ~150 lines of mirrored logic. The mirrored logic is kept
  intentionally close to `lib/revenueCatApi.ts`'s actual implementation so
  a mismatch between the two would be easy to spot on review.

## 6. Security Impact

- **Fixed:** the automatic bulk reconciliation tool can no longer delete a
  `stripeInterval` value under any circumstance — closing the risk (present
  in Revisions 4 through 6, each with a progressively narrower but still
  ultimately unsafe rule) of destroying genuine historical Stripe/gift
  Lifetime provenance based on an eventually-consistent search result or an
  unprovable assumption about historical checkout code.
- **Fixed:** customer-alias verification now queries RevenueCat's actual
  documented resource instead of a field that doesn't exist on the
  Customer detail response — meaning Revision 6's alias verification would
  likely have always failed silently in real use (an `undefined` `aliases`
  field would make `Array.isArray(json.aliases)` false, so `verifyAlias`
  would always have returned `false`), silently degrading TRANSFER
  resolution to "not found" for every genuine alias case. This is now
  fixed to actually work.
- **Fixed:** a historical plan repair can no longer be granted purely from
  an active trial, closing a path where trial status (not a real payment
  or entitlement) could drive an automatic, bulk-applied plan elevation.
- **Fixed:** a concurrent change to `revenueCatProductId` between report
  and apply is now caught by the optimistic-concurrency check, closing a
  narrow gap where that specific field could have been silently
  overwritten by a stale proposal.
- No new attack surface. The new smoke-test script requires real
  credentials to do anything and makes no writes; it's a manual diagnostic
  tool, not a deployed code path.

## 7. Data / Database Impact

No production SQL was run. No production data was read or written. The
reconciliation endpoint was not invoked against production, and the new
smoke-test script has not been run against a live RevenueCat account
either — it requires real credentials this environment doesn't have. No
schema changes this round (the `revenueCatProductId` column already
existed — confirmed via `prisma/schema.prisma` before use).

## 8. User / Business Impact

None yet — nothing in this round has been run against production. This
round is strictly more conservative than every prior revision: it removes
a destructive capability entirely (the `stripeInterval` clear), tightens
the plan-repair eligibility rules (trial exclusion), and closes a gap in
concurrency protection (`currentRevenueCatProductId`). No change in this
round could cause the tool to do MORE than before; every change causes it
to do less, or to do the same thing more safely.

## 9. Testing Performed

All run at Review Target SHA `9f55b96`:

```
npm test           → Test Files: 27 passed (27) / Tests: 426 passed (426)
npx tsc --noEmit    → clean, no output, exit 0
npm run build       → succeeded (full Next.js production build, all routes compiled)
npm run check:crons → ✓ cron inventory: 19 routes, 17 scheduled, 2 exempt
npx prisma validate → The schema at prisma/schema.prisma is valid 🚀
npx prisma generate → ✔ Generated Prisma Client (7.7.0) to ./lib/generated/prisma
```

Additionally: `node --check scripts/revenuecat-smoke-test.mjs` confirms
the new smoke-test script is syntactically valid (it cannot be functionally
tested without real RevenueCat credentials, which this environment lacks
by design).

Test breakdown for this round specifically:
- `__tests__/revenueCatApi.test.ts` — 31/31 (was 29). New/changed
  coverage: alias verification via the dedicated `/aliases` endpoint
  (provider-real `customer.alias` item shape) for both the exact-match and
  alias-match paths; pagination on the `/aliases` list itself (a matching
  alias found on the second page); a non-matching alias resolving to no
  match; an alias-lookup failure throwing; ambiguous multi-candidate
  resolution where NEITHER alias list matches; and a new test proving
  every non-exact candidate is checked (a match found on the *second*
  candidate after the first fails, not skipped).
- `__tests__/stripeEvidence.test.ts` — 21/21 (same count as before,
  mechanically renamed). Every prior `VERIFIED_NO_LIFETIME` assertion now
  reads `NO_MATCH`; no test logic changed since the underlying behavior is
  identical, only the name.
- `__tests__/revenueCatHistoricalReconciliation.test.ts` — 64/64 (was 58).
  New/changed coverage: every field-specific contamination test now
  asserts `suspectedLegacyStripeIntervalContamination` is set correctly
  but makes no assertion about a destructive proposal (there is none to
  assert); a candidate classified `confirmed_legacy_rc_contamination` gets
  its RC fields backfilled while `stripeInterval` is completely absent
  from the update payload and the stored value survives untouched; the
  same for a `multiple_legitimate_sources` candidate flagged as suspected;
  a mixed three-candidate batch test asserting `stripeInterval` never
  appears in ANY update call regardless of classification; the full
  required trial-exclusion matrix (trial-only → not even a candidate under
  current scope, confirming trial alone can't surface anything; trial+RC →
  repair via RC; trial+Ambassador → repair via Ambassador; trial+Stripe →
  repair via Stripe; trial+unverified-Stripe → still no repair); and
  `revenueCatProductId` changing between report and apply correctly
  yielding a stale candidate with zero mutation.

## 10. Files Changed

```
M	__tests__/revenueCatApi.test.ts
M	__tests__/revenueCatHistoricalReconciliation.test.ts
M	__tests__/stripeEvidence.test.ts
M	app/api/admin/revenuecat-historical-reconciliation/route.ts
M	docs/migrations/2026-08-sprint2-revenuecat-historical-reconciliation.md
M	lib/revenueCatApi.ts
M	lib/revenueCatHistoricalReconciliation.ts
M	lib/stripeEvidence.ts
A	scripts/revenuecat-smoke-test.mjs
```
(9 files: 1 new, 8 modified — `git diff --name-status 24d55ce...9f55b96`,
pasted verbatim.)

## 11. Known Risks / Remaining Questions

- **The alias-endpoint fix is itself unverified against a live account** —
  same caveat as every RevenueCat-shape claim in this migration, now
  addressed by the smoke-test script's `--alias` flag specifically. Given
  that Revision 6's alias check likely silently always failed (see §6),
  this is a meaningful thing to confirm actually works before trusting
  TRANSFER-related identity resolution.
- **The smoke-test script has not been run.** This environment has no
  RevenueCat credentials. It has been syntax-checked (`node --check`) and
  carefully mirrors `lib/revenueCatApi.ts`'s logic, but has not itself been
  exercised against any HTTP response, real or mocked, outside of manual
  code review. Running it for the first time IS the verification step —
  per the review's own instruction, this is now the correct next action
  rather than another round of code-only review.
- **`suspectedLegacyStripeIntervalContamination` accumulates with no
  resolution path built yet.** This migration can now identify suspected
  contamination but has no tooling to help Don act on it (a targeted,
  single-user cleanup endpoint or script). That's explicitly out of scope
  per the review ("handle that as a targeted operation, not this bulk
  migration"), but is worth flagging as a known gap for a future,
  separate piece of work if the suspected-contamination list turns out to
  be large once the dry run is actually run against production.
- **The historical reconciliation has still never been run against
  production data of any kind**, not even a read-only dry run.

## 12. Claude's Assessment

**READY FOR REVIEW**, and — pending only the live smoke test the review
itself designated as the next gate — closer to READY FOR AN ACTUAL DRY RUN
than any prior revision, since this round removed the single riskiest
capability (automatic destructive `stripeInterval` clearing) rather than
adding another layer of rules around it.

## 13. Questions for ChatGPT

1. Does the `suspectedLegacyStripeIntervalContamination` report-only
   design fully satisfy the intent of de-scoping this feature, or should
   the classification categories themselves (`confirmed_legacy_rc_contamination`
   specifically) also be softened/renamed now that nothing in this tool
   ever acts on them destructively?
2. Is there anything else in the current design that implicitly assumes a
   future "apply suspected contamination cleanups" feature will exist
   (e.g., persisting `suspectedLegacyStripeIntervalContamination` anywhere
   beyond the transient dry-run report), or is the report-only surface
   area in this round sufficient as a permanent stopping point unless Don
   explicitly asks for more?
3. Given that Revision 6's alias check likely silently always failed
   (§6) — is there a broader lesson here about testing a mocked
   implementation's *positive* path (a genuine alias match) rather than
   only its *negative* path (no match / not found), and should that be a
   standing practice for the rest of this codebase's provider-integration
   tests?

## 14. Requested Review Scope

Highest scrutiny, in order:
1. `scripts/revenuecat-smoke-test.mjs` — confirm the request logic
   faithfully mirrors `lib/revenueCatApi.ts` (any divergence here would
   make the smoke test validate the wrong thing) and that the sanitization
   discipline (never logging the key, headers, or full payloads) is
   actually complete.
2. `lib/revenueCatApi.ts`'s new `findCustomerId`/`verifyAlias` — the exact
   alias-verification algorithm, since this is the most likely place for a
   subtle discrepancy against RevenueCat's real `/aliases` contract to
   still exist.
3. `lib/revenueCatHistoricalReconciliation.ts`'s `applyReconciliation` —
   confirm by inspection (not just by the tests) that there is truly no
   remaining code path by which `stripeInterval` could end up in an update
   payload.

# Native IAP Verification Checklist — iap_checkout_started + Exact Package Selection

**Status: PLANNED — not yet executed.** This document defines the on-device
verification procedure required before `iap_checkout_started` data (shipped
in PR #16, `iap_checkout_started` exact-package-selection fix shipped in
PR #17, both merged into `main` as of 2026-08-20) is trusted as
decision-grade funnel analytics, per ChatGPT's review of the Post-P0C
Cleanup packet. Nothing in this file has been run. No claim is made
anywhere in this repo that on-device verification has happened — unit
tests (`__tests__/iapCheckoutStarted.test.ts`) prove the mocked logic is
correct; they do not prove StoreKit/Play Billing, the RevenueCat bridge, or
a real native build behave the same way.

**Confirmed 2026-08-20 (code/config review, no device access): no new
native build is required.** `capacitor.config.json`'s `server.url` points
at the live remote web app (`https://www.gascap.app/?native=ios` /
`.../?native=android`) — the installed TestFlight build loads `lib/iap.ts`
and all other app code live from `gascap.app` at runtime, not bundled into
the binary. PR #16/#17 touched only web code, no native config — see
`/CLAUDE.md`: "web changes need no Codemagic rebuild — but a native-config
change does." The last native-config-relevant change was the iOS 1.1.1
marketing-version bump (already shipped), with no drift since. The
currently-installed TestFlight build should already be running the fixed
`lib/iap.ts`.

## Prerequisites
- A TestFlight build (or Xcode-run debug build on a physical device/
  simulator with StoreKit sandbox configured) with a signed-in GasCap
  account that is NOT already Pro.
- Access to the production or sandbox Railway database (read-only) to
  query the `AnalyticsEvent` table, OR access to whatever admin/analytics
  view GasCap currently exposes for this table.
- A RevenueCat sandbox/test account with both `gascap_pro_monthly` and
  `gascap_pro_lifetime` products configured and purchasable in sandbox.

## iOS — TestFlight / StoreKit Sandbox

1. **Start Lifetime purchase.** From `/upgrade`, tap "Get Lifetime" (native
   IAP path — confirm the app is actually in native mode, not showing the
   web Stripe path; per `app/upgrade/page.tsx`, native never sees Stripe).
2. **Verify exactly one `iap_checkout_started` with `billing:'lifetime'`.**
   Query `AnalyticsEvent` for this user filtered to `eventType =
   'iap_checkout_started'`, emitted in the last few minutes. Expect exactly
   one row, `metadata.billing = 'lifetime'`, `originPlatform = 'ios'`.
3. **Cancel the StoreKit purchase sheet** (do not complete the transaction).
4. **Confirm no authoritative `purchase_completed`.** Query `AnalyticsEvent`
   for `eventType = 'purchase_completed'` — confirmed as the exact event
   name the RevenueCat webhook writes on grant
   (`app/api/native/revenuecat/route.ts`'s `doGrant()`) — for this user;
   expect zero rows. Also confirm the account's `plan`/`stripeInterval`/
   entitlement fields are unchanged (still not Pro).
5. **Start Lifetime again and complete the sandbox transaction** this time.
6. **Confirm the start → completion relationship.** Expect: the `iap_checkout_started`
   row from step 5 (a second one, since step 2's was for the cancelled
   attempt), followed by a RevenueCat webhook firing and the account's
   entitlement actually updating to Pro/Lifetime. Confirm the timestamps are
   in the expected order (`iap_checkout_started` before the entitlement
   grant) and that there is exactly one entitlement-granting event for this
   purchase, not a duplicate.
7. **Repeat steps 1–6 for Monthly**, using a separate test account (or after
   fully resetting/removing the Lifetime entitlement from the first
   account, if RevenueCat sandbox allows that) — confirm `billing:'monthly'`
   throughout, and that Monthly's purchase does not also grant Lifetime or
   vice versa.
8. **Confirm the exact RevenueCat product/package shown matches the billing
   plan selected.** In the StoreKit purchase sheet itself, confirm the
   product name/price displayed matches Monthly ($2.99/mo) or Lifetime
   ($19.99 one-time) as selected — this is the on-device confirmation that
   `fix/iap-exact-package-selection`'s exact-match logic (no `pkgs[0]`
   fallback) is resolving the correct package in a real environment, not
   just in the mocked unit tests.
9. **Document any duplicate, missing, or incorrectly labeled events** found
   during steps 1–8 — append findings to this file or a dated follow-up
   note, do not silently discard them.

## Android — Play Billing Sandbox (equivalent plan, for when Android
## testing is available)

1. Start Lifetime purchase from a licensed test account in the Play Console
   (internal testing track or license-testing group), from `/upgrade` in
   the Android app (Android IAP goes through RevenueCat/Play Billing, same
   as iOS/StoreKit — see `lib/iap.ts`, platform-agnostic).
2. Verify exactly one `iap_checkout_started` with `billing:'lifetime'`,
   `originPlatform:'android'`.
3. Cancel the Play Billing purchase flow.
4. Confirm no authoritative `purchase_completed` and no entitlement change.
5. Start Lifetime again and complete the test transaction.
6. Confirm the start → completion relationship, as in iOS step 6.
7. Repeat for Monthly.
8. Confirm the exact product/package shown in the Play Billing sheet
   matches the billing plan selected.
9. Document any duplicate, missing, or incorrectly labeled events.

## What this checklist does NOT cover
- Restore-purchase flow (`restorePurchases()` in `lib/iap.ts`) — does not
  fire `iap_checkout_started` at all (by design; restoring isn't a new
  purchase attempt) and is out of scope for this checklist.
- RevenueCat's own webhook payload shape/contract — covered separately by
  the existing `__tests__/revenuecatWebhook.test.ts` provider-contract
  tests, not by this on-device checklist.
- Pricing or product-catalog correctness in App Store Connect / Play
  Console themselves — assumed already correct; this checklist verifies
  GasCap's own event instrumentation and package-selection logic only.

## Execution log
_(Append entries here each time this checklist is actually run — date,
platform, tester, pass/fail per step, and a link to or copy of any
`AnalyticsEvent` query output used as evidence.)_

- No entries yet.

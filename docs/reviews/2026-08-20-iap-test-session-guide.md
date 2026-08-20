# Native IAP Test Session Guide — for Don, on the iPhone/TestFlight build

Controlling doc: `docs/IAP_NATIVE_VERIFICATION_CHECKLIST.md`. This guide
turns that checklist into exact steps for you to perform, paired with the
exact command I'll run to verify each one. **I cannot perform any step in
this guide myself** — no device/simulator access, and completing a
sandbox purchase requires a signed-in sandbox Apple ID, which is credential
entry I'm not permitted to do on your behalf.

## Status before you start

**READY FOR ON-DEVICE TEST** — see the full findings/blockers list at the
end of this guide. Nothing here has been run; this section only documents
that preparation is complete.

## What you need before starting
1. Your iPhone with the current TestFlight GasCap build installed, **or**
   an Xcode simulator run with StoreKit sandbox configured — either works,
   since the fix under test lives in web code the app loads live.
2. A **sandbox Apple ID** signed into Settings → App Store → Sandbox
   Account (Apple's test-purchase account, not your real Apple ID). If you
   don't have one, create it in App Store Connect → Users and Access →
   Sandbox Testers first — that's a one-time Apple-side setup, not
   something I can do.
3. A GasCap test account that is **not** currently Pro (free or expired
   trial) — the App Store review demo account
   (`dparker001+gascapreview@gmail.com`) works if it's currently in that
   state; otherwise sign up fresh from the app.
4. Tell me the test account's email before you start each numbered section
   below — I'll use it to run the read-only verification query after each
   of your steps.

## Verification tool
I'll run, after each of your steps:
```
railway run npx tsx scripts/diagnostics/check_iap_test_events.ts <test-account-email> 15
```
This prints (read-only, no writes): the account's current
`plan`/`stripeInterval`/`isProTrial` state, every `iap_checkout_started`
and `purchase_completed` `AnalyticsEvent` row for that account in the last
15 minutes, and every `RevenueCatWebhookEvent` row in the same window. You
don't need to run anything yourself — just tell me when you've completed
each numbered step and I'll check.

---

## Part A — Lifetime purchase, cancel path

**A1.** Open the app, go to Upgrade, tap **Get Lifetime**.
→ I verify: exactly one `iap_checkout_started` row, `billing: "lifetime"`,
`originPlatform: "ios"`. Zero `purchase_completed` rows.

**A2.** When the StoreKit purchase sheet appears — **before confirming** —
check that the sheet's product name/price shown matches Lifetime ($19.99
one-time), then **cancel** the sheet (tap Cancel, don't complete it).
→ I verify: still zero `purchase_completed` rows, account `plan` still
not `pro`. Confirms cancelling never grants entitlement.

## Part B — Lifetime purchase, completed

**B1.** Tap **Get Lifetime** again, this time **complete** the sandbox
purchase (confirm with Face ID/Touch ID/sandbox prompt as usual).
→ I verify: a **second** `iap_checkout_started` row (`billing: "lifetime"`)
appears — from this attempt, not A1's. A `RevenueCatWebhookEvent` row
appears with `status: "processed"`. A `purchase_completed` `AnalyticsEvent`
row appears, `billing: "lifetime"`. The account's `plan` is now `"pro"`,
`stripeInterval` is `"lifetime"`. Timestamps confirm `iap_checkout_started`
precedes the webhook/`purchase_completed` row, and there's exactly one
`purchase_completed` for this purchase (not a duplicate).

## Part C — Monthly, cancel and complete (needs a Lifetime-free account)

Lifetime is a permanent, non-consumable entitlement — Part B's account now
owns it and can't meaningfully buy Monthly afterward. Use a **second**,
still-free test account for this part.

**C1.** Sign in as the second test account. Tap **Get Monthly**, cancel the
StoreKit sheet before confirming.
→ I verify: one `iap_checkout_started` row, `billing: "monthly"`. Zero
`purchase_completed` rows.

**C2.** Tap **Get Monthly** again, complete the sandbox purchase.
→ I verify: second `iap_checkout_started` (`billing: "monthly"`), a
`purchase_completed` row with `billing: "monthly"`, account `plan: "pro"`,
`stripeInterval: "monthly"` — **not** `"lifetime"`. This is the direct
on-device proof that PR #17's exact-package-selection fix resolves the
correct product: Monthly never resolves to Lifetime, and (from Part B)
Lifetime never resolves to Monthly.

## Part D — Restore Purchases smoke test

Use the **Part B account** (the one that completed a real Lifetime
purchase).

**D1.** Sign out of the GasCap app (or reinstall/reset the app per however
your sandbox setup makes "not currently entitled from the client's point
of view" easiest — RevenueCat's own entitlement record for this Apple ID
doesn't change either way), then sign back in with the same account and
tap **Restore Purchases**.
→ I verify:
  - The account's `plan` reflects the restored entitlement (`"pro"`,
    `stripeInterval: "lifetime"`) — confirming the restore actually
    worked.
  - **Zero new `iap_checkout_started` rows** appear from this step —
    `restorePurchases()` in `lib/iap.ts` never calls `trackClientEvent` at
    all (confirmed by reading the current source — there's no call site
    for it in that function), so this should hold structurally, not just
    by chance.
  - **No second `purchase_completed` row** and no second charge — RevenueCat
    restoring an existing entitlement to the same account is not a new
    purchase event; confirm no new `RevenueCatWebhookEvent` row appears
    that looks like a fresh `INITIAL_PURCHASE`/`NON_RENEWING_PURCHASE`
    (a `RESTORE`-flavored event, if RevenueCat sends one for this exact
    scenario, is a separate and acceptable thing to see — the point is no
    *duplicate purchase*, not "zero webhook activity at all").

## After the session
Report back to me: pass/fail per lettered step above, and anything that
looked duplicate, missing, or mislabeled. I'll append the results to
`docs/IAP_NATIVE_VERIFICATION_CHECKLIST.md`'s Execution Log and, if
anything failed, stop and prepare a review packet for ChatGPT before
touching any billing/purchase code — per your standing instruction, I will
not apply a fix for a discovered issue without that packet first.

---

## Preparation summary (for the record)

**1. `main` contains PR #17 / exact-package-selection fix:** confirmed.
`origin/main` at `e89aba64c4dbcab32f92660408fd5042a9440952`. Deployed
`lib/iap.ts` shows `pkgs.find(...)` with no `?? pkgs[0]` fallback.

**2. Native build requirement:** **no rebuild required.**
`capacitor.config.json`'s `server.url` is a remote URL
(`https://www.gascap.app/?native=ios`) — the app loads current web code
live at runtime. PR #16/#17 touched only web code. Last native-config
change was the already-shipped iOS 1.1.1 version bump; no drift since.

**3. RevenueCat configuration (read-only checks against production, via
`railway run`):** `gascap_pro_monthly` and `gascap_pro_lifetime` both
exist as products and are both attached to the `"GasCap Pro"` entitlement
(`entl2e4d389a65`) — correct mapping, matches `lib/iap.ts`'s `PRODUCT_IDS`.
**Blocker, not fixed:** the configured `REVENUECAT_V2_SECRET_KEY` lacks
`project_configuration:offerings:read` and `project_configuration:apps:read`
— I could not verify current offering/package availability or confirm
which RevenueCat `app_id` is iOS vs. Android via the API. This doesn't
block the test session (you'll see real offerings directly on-device
regardless of what the API key can read), but it does mean I can't
pre-confirm offerings server-side. Widening the key's permissions is a
RevenueCat dashboard config change I did not make without your
authorization.

**4. App Store Connect / StoreKit assumptions:** not independently
verifiable from this session — no App Store Connect API access configured
here. Per existing project memory, iOS v1.1.1 is live/approved; both IAP
products should already be "Ready to Submit"/approved status in App Store
Connect (an earlier gotcha noted `'no-offerings'` specifically means "IAP
products aren't approved yet, or the Paid Apps Agreement just activated" —
if Part A/C's `iap_checkout_started` never fires and `purchasePro()`
instead returns `no-offerings`, that's the first thing to check in App
Store Connect).

**5. Safe inspection tooling:** built and compiles clean —
`scripts/diagnostics/check_iap_test_events.ts` (read-only; queries
`AnalyticsEvent`, `RevenueCatWebhookEvent`, and `User` entitlement fields
for one test account). No writes anywhere in this script.

**6/7.** Covered above; `docs/IAP_NATIVE_VERIFICATION_CHECKLIST.md`
updated with the two factual corrections found (PR #17 reference, firmed
up `purchase_completed` as the confirmed webhook event name) — no other
drift found.

**Exact test account/setup requirements:** current TestFlight build (or
simulator + StoreKit sandbox), a sandbox Apple ID signed into device
Settings, two GasCap test accounts not currently Pro (one for Lifetime,
one for Monthly, since Lifetime is permanent and can't be "un-owned" for a
Monthly test on the same account).

**Blockers:** none that block starting the test session. The RevenueCat
API key permission gap (§3) is a real, disclosed limitation on what I
could pre-verify, not a blocker to you running the on-device steps.

**Status: READY FOR ON-DEVICE TEST.**

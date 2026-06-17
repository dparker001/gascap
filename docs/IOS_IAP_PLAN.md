# iOS In-App Purchase (Pro) — Build Plan

**Why:** App Store rejection 3.1.1. Apple requires that Pro (sold on the web via Stripe)
be **purchasable inside the iOS app via In-App Purchase**, since the app delivers Pro
features. This adds IAP on iOS while keeping web Stripe; the entitlement syncs so Pro is
cross-platform.

**Approach:** Capacitor + **RevenueCat** (wraps Apple StoreKit, handles receipts, and syncs
entitlements to the user's account). Commission: **15%** (Apple Small Business Program,
<$1M/yr). First change that requires a **new native build** (Codemagic).

---

## Don's prerequisites in App Store Connect (do these first — IAP can't go live without them)
1. **Business → Agreements:** sign the **Paid Applications Agreement**; complete **banking** and **tax** forms. (Until this is "Active," IAP products stay in "Missing Metadata" and can't be tested or sold.)
2. **Create the IAP products** (Features → In-App Purchases / Subscriptions):
   - **Auto-renewable subscription** — "GasCap Pro (Monthly)", **$2.99/mo**, product ID e.g. `gascap_pro_monthly`. Put it in a Subscription Group "GasCap Pro".
   - **Non-consumable** — "GasCap Pro (Lifetime)", **$19.99**, product ID e.g. `gascap_pro_lifetime`.
   - Add a localized display name, description, and a review screenshot for each.
3. **RevenueCat** (revenuecat.com, free tier is fine): create a project, add the iOS app, and connect it to ASC:
   - Upload the **App Store Connect API key** (in-app purchase key) + the **App-Specific Shared Secret**.
   - Create an **Entitlement** `pro`, and **Offerings/Packages** mapping to the two product IDs above.
   - Grab the **RevenueCat public SDK (Apple) API key** for the app.

## Engineering (Claude)
1. **Add the SDK:** `@revenuecat/purchases-capacitor` (+ pod install in CI). Its JS ships in the Next.js bundle so the web app — running inside the iOS shell — can call the native StoreKit plugin over the Capacitor bridge (works even though the app loads the remote gascap.app URL).
2. **Identify the user to RevenueCat:** on native, after login call `Purchases.logIn(<gascap userId>)` so the StoreKit entitlement maps to the GasCap account (not an anonymous device).
3. **Native purchase UI:** when on iOS native, the Pro/upgrade surfaces show **IAP buttons** that call `Purchases.purchasePackage(...)` (RevenueCat) instead of the Stripe checkout. On purchase success, RevenueCat reports the `pro` entitlement. Remove the remaining web-Stripe pricing/links on native (the `/#pricing` the reviewer reached) — IAP is the only purchase path on iOS.
4. **Grant Pro on the backend (cross-platform):** add `/api/native/revenuecat` webhook — on RevenueCat's `INITIAL_PURCHASE`/`RENEWAL`/`NON_RENEWING_PURCHASE` events, look up the user by the RevenueCat appUserID (= GasCap userId) and `setUserPlan(userId, 'pro', …)` with the right interval (monthly vs lifetime). On `EXPIRATION`/refund, revert. This is the same grant path Stripe uses, so Pro works on web + iOS from one account.
5. **Reconcile with Stripe:** a user who already bought Pro on the web keeps it on iOS (entitlement comes from the account, not StoreKit). A user who buys on iOS gets Pro everywhere. Guard against double-charging (if account already Pro, the native UI shows "You're Pro" instead of a buy button).
6. **Restore Purchases:** add a "Restore purchases" action on iOS (Apple requires it for non-consumables) → `Purchases.restorePurchases()`.
7. **New Codemagic build** with the plugin; test in **StoreKit sandbox** (sandbox Apple ID) end-to-end before submitting.

## Reply to App Review (after the build)
State that Pro is now offered via In-App Purchase (StoreKit) for both the monthly subscription
and the lifetime option; the web Stripe path is no longer presented inside the iOS app.

## Sequencing
- **Now (done):** 5.1.1 + 5.1.2 privacy fixes (web, live).
- **Don, in parallel:** Paid Apps Agreement + banking/tax, create the two IAP products, set up RevenueCat.
- **Then (Claude):** implement the SDK + purchase UI + webhook + restore; new Codemagic build; sandbox test.
- **Resubmit** with all three guidelines addressed.

## Effort / risk
Biggest piece of the whole store push — touches the native shell, the web purchase UI, and the
backend grant. Plan ~1–2 focused build sessions + sandbox testing, gated on Don's ASC/RevenueCat
setup. RevenueCat removes most of the StoreKit/receipt complexity; the main custom work is the
entitlement webhook + native-vs-web purchase branching.

## Open decision
- Confirm **RevenueCat** (recommended) vs raw StoreKit (`@capacitor-community/in-app-purchases` + your own receipt validation — more code, no entitlement sync). Plan above assumes RevenueCat.

# Native (Capacitor) production hardening review

**Status: CURRENT (review) / PLANNED (changes).** Hardening sprint 1,
2026-08-18. **No settings were changed.** Per the sprint decision, this is a
documented recommendation only.

---

## Architecture note

Both shells load the **remote deployed site** (`server.url =
https://www.gascap.app/?native=ios|android`) rather than bundled assets. So:

- Web changes reach users without a Codemagic rebuild.
- **Any change in `capacitor.config.json` requires a full native rebuild and an
  App Store / Play review to reach users.** That asymmetry is why nothing here
  was flipped speculatively — a mistake is not a redeploy, it is a release
  cycle.

## Findings

### 1. `webContentsDebuggingEnabled: true` — both platforms · **should change**

Enables remote WebView inspection (Safari Web Inspector / Chrome DevTools) on
production builds. An attacker with physical access to an unlocked device — or
anyone running the shipped app on a simulator — can inspect the DOM, read
`localStorage` and execute JavaScript in the app's origin.

Worth stating precisely: this does **not** expose other users' data remotely.
It widens local inspection of the signed-in session. On iOS, `WKWebView`
debugging is additionally gated by the OS to development-provisioned builds on
modern iOS; on **Android it is not**, so the Android exposure is the real one.

**Recommendation:** disable for release builds, keep for debug. Requires a
build-time config split (below), not an edit — flipping it in the committed
file removes it from development too.

### 2. `useLegacyBridge: true` — Android · **leave alone**

Opts into the pre-Capacitor-6 bridge. This is almost certainly load-bearing:
combined with `overrideUserAgent` and a remote `server.url`, it is the shape of
a fix for a specific Android WebView issue. Turning it off is a behavioural
change to the bridge every native request crosses.

**Recommendation:** leave. If revisited, it needs a device test matrix, not a
code review. Not a security setting.

### 3. `limitsNavigationsToAppBoundDomains: false` — iOS · **leave, with reason**

Setting this `true` restricts the WebView to domains declared in
`WKAppBoundDomains`. Sounds strictly better, but it is not compatible here:
enabling app-bound domains **disables several WKWebView APIs** and constrains
navigation to at most three declared domains. GasCap's WebView legitimately
reaches Stripe Checkout, Google, and OneSignal.

Navigation is already constrained by `server.allowNavigation`
(`www.gascap.app`, `gascap.app`, `*.gascap.app`) — an explicit allow-list,
which is the protection that matters.

**Recommendation:** leave `false`. Document that the allow-list is the control.
Revisit only if third-party WebView navigation is eliminated.

### 4. `server.cleartext: false` · **correct — no change**

HTTPS enforced. Keep.

### 5. `allowNavigation` · **correct — no change**

Explicit and narrow. `*.gascap.app` is a wildcard over an owned domain, which
is acceptable; it should not grow to include third parties.

## Proposed change for #1 (not implemented)

`capacitor.config.json` is static and committed. Two options:

**Option A — `capacitor.config.ts` (preferred).** Capacitor supports a
TypeScript config, so the value can be derived:

```ts
const isProd = process.env.NODE_ENV === 'production'
            || process.env.CM_BUILD_TYPE === 'release';   // Codemagic
android: { webContentsDebuggingEnabled: !isProd },
ios:     { webContentsDebuggingEnabled: !isProd },
```

Requires deleting the `.json` (Capacitor rejects both present) and confirming
Codemagic sets a distinguishable variable.

**Option B — Codemagic patch step.** Keep the JSON; have the release workflow
rewrite the two flags before `npx cap sync`. Less elegant, no config-format
change, and trivially revertible.

**Recommendation: Option B first.** It is one workflow step, reversible, and
does not risk the config being unreadable to a build that currently works.
Verify on a TestFlight build before a public release.

## Verification required before any of this ships

1. Codemagic build succeeds.
2. TestFlight build launches and reaches the live site.
3. Sign-in, a fuel calculation, and **a RevenueCat purchase restore** all work
   — purchases cross the bridge, so bridge-adjacent changes must be exercised
   against IAP, not just the UI.
4. Confirm debugging is actually off in the release build and still on in debug.

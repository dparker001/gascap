# GasCap™ Mobile App — Build & Submit Guide

Wrap the existing PWA (www.gascap.app) as native apps:
- **Android** → Trusted Web Activity (TWA), generated with PWABuilder/Bubblewrap.
- **iOS** → Capacitor shell loading the live site + native push.

**Payment model (v1):** free utility. No in-app purchase — Pro is sold on the web.
The web app already hides all purchase UI inside the wrappers via `hooks/useIsNative.ts`.

---

## 0. Prerequisites (already in place / one-time)
- Apple Developer Program + Google Play Developer accounts ✅
- macOS + Xcode (for iOS), Android Studio (optional, for testing the AAB)
- Node 18+, `npm i -g @bubblewrap/cli` (or use https://pwabuilder.com)
- Decide bundle/app IDs (used everywhere):
  - **Android package / iOS bundle id:** `app.gascap.mobile`

---

## 1. Android — TWA (fastest; can be live in days)

### 1a. Generate the project
Easiest: go to **https://www.pwabuilder.com**, enter `https://www.gascap.app`, → **Package for stores → Android**. Or with Bubblewrap:
```bash
bubblewrap init --manifest https://www.gascap.app/manifest.json
# host: www.gascap.app   app id: app.gascap.mobile   launcher name: GasCap
bubblewrap build
```
This produces `app-release-bundle.aab` (upload to Play) and a signing key.

### 1b. Wire up Digital Asset Links (removes the URL bar)
The endpoint already exists: `https://www.gascap.app/.well-known/assetlinks.json`
(served by `app/api/assetlinks/route.ts` via a rewrite). It reads two Railway env vars:
- `ANDROID_PACKAGE_NAME` = `app.gascap.mobile`
- `GOOGLE_PLAY_SHA256` = the SHA-256 fingerprint(s), comma-separated

Get the fingerprints from **Play Console → Test and release → Setup → App signing**
(include BOTH the *App signing key* and your *upload key* SHA-256). Bubblewrap also
prints the upload key fingerprint. Set both env vars in Railway → redeploy →
verify: `curl https://www.gascap.app/.well-known/assetlinks.json` shows them.

### 1c. Test + submit
- Play Console → create app → **Internal testing** track → upload the AAB.
- Add yourself as a tester, install, confirm it opens full-screen (no URL bar) and
  the calculator + giveaway work, and **no purchase UI appears**.
- Promote to Production when ready.

---

## 2. iOS — Capacitor + native push (~2–3 weeks incl. review)

> Keep the Capacitor project **outside the Next.js tsconfig** (its own `/native/ios`
> folder or a sibling repo) so it never interferes with the web build/typecheck.

### 2a. Scaffold
```bash
npm i @capacitor/core @capacitor/ios @capacitor/push-notifications @capacitor/splash-screen
npm i -D @capacitor/cli
npx cap init GasCap app.gascap.mobile --web-dir public
npx cap add ios
```

### 2b. `capacitor.config.ts` (load the live site)
```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId:   'app.gascap.mobile',
  appName: 'GasCap',
  webDir:  'public',
  server:  {
    // Load the live, server-rendered app. The ?native=ios marker + the injected
    // window.Capacitor are both detected by hooks/useIsNative.ts to hide purchase UI.
    url:       'https://www.gascap.app/?native=ios',
    cleartext: false,
  },
  ios: { contentInset: 'always', backgroundColor: '#005F4A' },
  plugins: {
    SplashScreen:      { launchShowDuration: 1200, backgroundColor: '#005F4A' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};
export default config;
```

### 2c. Satisfy App Store Guideline 4.2 ("not just a website")
Add real native value — at minimum **push notifications** wired to the existing
Gas Price Drop Alerts:
- Register for push on launch (`PushNotifications.requestPermissions()` →
  `register()`), POST the device token to a small new endpoint, store it on the
  user, and send via APNs (or FCM→APNs) when a price-drop alert fires.
- Native splash + app icon (assets below), haptics on the fuel-gauge drag, and the
  native share sheet are easy bonus signals.

### 2d. Login on iOS — already handled
We **hide Google login in the iOS app** (email/password only) so Apple's
Sign-in-with-Apple requirement (Guideline 4.8) doesn't apply. Done in
`app/signin/page.tsx` + `app/signup/page.tsx` via `useNativePlatform()==='ios'`.
(If you later want social login on iOS, add Sign in with Apple instead.)

### 2e. Build + submit
```bash
npx cap copy ios && npx cap open ios   # opens Xcode
```
In Xcode: set the bundle id `app.gascap.mobile`, your signing team, the app icon &
launch screen → **Product → Archive** → upload to **App Store Connect** → TestFlight
→ submit for review.

---

## 3. App icons & splash
Generate from the existing brand mark:
- iOS: 1024×1024 App Store icon + the full icon set (use Xcode's asset catalog or
  `@capacitor/assets`).
- Android: adaptive icon (foreground + `#005F4A` background).
- `npm i -D @capacitor/assets` then `npx capacitor-assets generate` from a single
  1024×1024 source + a splash image.

## 4. Store listings & privacy
See **`docs/APP_STORE_LISTINGS.md`** for names, subtitles, descriptions, keywords/ASO,
and the answers for Apple's **Privacy Nutrition Labels** + Google's **Data Safety** form.

## 5. Updates after launch (the big win)
Both apps load the live site, so **feature/content changes ship through your normal
Railway deploy — no app resubmission.** Only changes to the native shell (icons,
push, Capacitor/TWA config, OS target) require a new store build.

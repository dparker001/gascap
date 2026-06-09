# GasCap™ iOS App — Build Plan (Capacitor + Codemagic cloud build)

Wrap the live PWA as an iOS app and ship to the App Store **without installing Xcode
locally** — a cloud Mac (Codemagic) builds, signs, and uploads to TestFlight.

- **Bundle ID:** `app.gascap.mobile` (same as Android — fine; separate store namespace)
- **App name:** `GasCap`
- **Loads:** the live site `https://www.gascap.app/?native=ios` (server-driven, like the TWA)
- **Payment model:** free utility — in-app purchase already hidden on native; Google login
  already hidden on iOS (Apple Sign-in-with-Apple rule satisfied). Both done in the web app.

Why Codemagic, not local Xcode: the Mac has only ~12 GB free; Xcode needs ~30–40 GB.

---

## Prereqs (have / get)
- ✅ Apple Developer Program account
- App Store Connect access (comes with the dev account)
- A **Codemagic** account (free tier) — sign up with the GitHub that holds the gascap repo
- We'll build from a **Capacitor iOS project committed to the repo** (or a branch)

---

## Step 1 — Add Capacitor to the project (Claude does this with you)
Add the deps + a config that loads the live site:
```bash
npm i @capacitor/core @capacitor/ios @capacitor/push-notifications @capacitor/splash-screen @capacitor/status-bar
npm i -D @capacitor/cli
```
`capacitor.config.ts` (or `.json` to avoid touching the Next build):
```ts
{
  "appId": "app.gascap.mobile",
  "appName": "GasCap",
  "webDir": "public",
  "server": { "url": "https://www.gascap.app/?native=ios", "cleartext": false },
  "ios": { "contentInset": "always", "backgroundColor": "#005F4A" },
  "plugins": {
    "SplashScreen": { "launchShowDuration": 1200, "backgroundColor": "#005F4A" },
    "PushNotifications": { "presentationOptions": ["badge", "sound", "alert"] }
  }
}
```
> Keep Capacitor config out of the Next.js tsconfig (use the `.json` form or a subfolder)
> so it can never break the web build.

## Step 2 — Native value for Apple Guideline 4.2 (Claude builds the web/server side)
A bare webview gets rejected. Add **push notifications** wired to the existing
Gas Price Drop Alerts:
- App registers for push on launch → posts the APNs device token to a new endpoint.
- New endpoint stores the token on the user; the price-drop-alert job sends via APNs.
- Bonus native signals: splash, app icon, haptics on the fuel gauge.
Requires an **APNs Auth Key** (.p8) from the Apple Developer portal (Keys → +) and the
Push Notifications capability/entitlement in the iOS project.

## Step 3 — Apple signing for Codemagic (you, guided)
- App Store Connect → **My Apps → + → New App** → bundle `app.gascap.mobile`, name GasCap.
- App Store Connect → **Users and Access → Integrations → App Store Connect API** →
  generate an **API key** (Issuer ID, Key ID, .p8). This lets Codemagic sign + upload
  automatically (no certificates to juggle).
- In Codemagic → add the App Store Connect API key (Team integrations) → enable
  **automatic code signing**.

## Step 4 — Codemagic workflow (`codemagic.yaml`, Claude drafts)
Pipeline: install deps → `npx cap add ios` → `npx cap sync ios` → `pod install` →
`xcodebuild` archive + export → publish to **App Store Connect / TestFlight**. Trigger a
build; Codemagic's cloud Mac does the rest.

## Step 5 — TestFlight + submit (you, guided)
- Install the TestFlight build on your iPhone; confirm it opens full-screen, the
  calculator/giveaway work, **no purchase UI**, and push permission prompts.
- Complete the App Store listing using **docs/APP_STORE_LISTINGS.md** (name, subtitle,
  keywords, screenshots `public/store-screenshots/final/apple/`, privacy nutrition labels,
  reviewer notes: no IAP + free-entry sweepstakes).
- Submit for review.

---

## Tomorrow's quick checklist
1. Sign up for **Codemagic** (with the gascap GitHub).
2. Apple: create the **App Store Connect app record** (bundle `app.gascap.mobile`) + an
   **App Store Connect API key** + an **APNs Auth Key (.p8)**.
3. Tell Claude → he adds Capacitor config + the push endpoint + `codemagic.yaml`, commits.
4. Connect the repo in Codemagic, add the API key, run the build → TestFlight.
5. Install on your iPhone, finish the listing, submit.

Updates after launch ship via the normal Railway deploy (the app loads the live site) —
only native-shell changes (push, icons, config) need a new build.

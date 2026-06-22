# GasCap — Native App Shell Spec (bottom tab bar)

**Goal:** make the iOS/Android wrappers read as a *native app*, not a wrapped PWA — primarily by adding a persistent bottom tab bar and dropping the marketing/website chrome on native.

**Key enabler:** the wrappers load the live site, so this is all **web code gated behind `useIsNative()`**. It ships live and the app picks it up on next open — **no Codemagic rebuild** (as long as we stay pure-web: CSS transitions, no new Capacitor plugins).

**Timing:** build AFTER Apple approval. The app loads the live site, so a layout overhaul mid-review changes what the reviewer sees. (Footer-hide already shipped — commit on `main`.)

---

## 1. The bottom tab bar (the #1 change)
A fixed, safe-area-aware bottom nav — the single biggest "feels like an app" win.

**Tabs (5):** every item shows an **icon ABOVE a text label** (standard mobile tab bar — e.g. a gear for Settings). Active tab = brand color (orange/teal); inactive = slate-400. Use inline SVGs (matches the codebase's icon style), ~22–24px, with the label ~10–11px below.

| Tab | Label | Icon | Content (reuse existing) |
|---|---|---|---|
| **Calculator** | "Calculator" | fuel pump / gauge | the fuel-cost calculator (`#gascap-calculator` / FuelGauge + ResultCard) |
| **History** | "History" | clock with arrow (or list) | `components/FillupHistory.tsx` + savings dashboard |
| **Tools** | "Tools" | wrench (or 2×2 grid) | `components/ToolsPanel.tsx` (MPG, gas price, optimizer, etc.) |
| **Rewards** | "Rewards" | gift / star (or trophy) | hub — lead with the monthly gas-card **giveaway** (hero), then streaks/daily bonus + referral credits; later, **Kard card-linked cash-back** slots in here (web-first, native-gated until vetted) |
| **Settings** | "Settings" | gear | `app/settings` content (account, legal links, delete) |

5 tabs is the iOS max and Android-friendly. Keep labels short (one word) so they don't truncate on narrow phones. Each button: vertical stack (icon, then label), full tap target, `aria-label` per tab.

**Behavior:** active-tab highlight (brand orange/teal), instant switch (no full-page reload), `padding-bottom: env(safe-area-inset-bottom)`, hides on full-screen flows (`/upgrade`, `/delete-account`, `/redeem`).

---

## 2. Strip marketing chrome on native
Native users should land in the tool, not a homepage. On native, **do not render**: `GuestHero`, `EndorserMarquee`, `StatsBar`, `FaqSection`, `UseCases`, `GuestCtaBanner`, `ProblemSolution`, the web `Header`, and the footer (footer already done). Most pricing/hero is already `useIsNative`-gated — the shell makes this clean by simply not mounting them.

## 3. Edge-to-edge app shell
- Drop the centered `max-w-lg mx-auto` + side web padding on native; go full-width with app padding.
- Native **title bar per tab** (reuse the navy header style; pairs with the navy status-bar fix in [native-safe-area]).
- Removes the "responsive website in a phone" feel.

---

## 4. Implementation plan
**New files**
- `components/native/NativeAppShell.tsx` (client) — holds `activeTab` state; renders the active tab's content + `<NativeTabBar/>`. Edge-to-edge, safe-area aware.
- `components/native/NativeTabBar.tsx` — the fixed bottom bar (5 icon+label buttons, active state, safe-area bottom inset).
- `components/native/tabs/` — thin wrappers that mount existing components (Calculator, History, Tools, Rewards, Settings) so we reuse, not rewrite.

**Changed files**
- `app/page.tsx` — at the top of `Home()`: `if (isNative) return <NativeAppShell/>;` → bypasses the entire marketing/scroll page for native. Web path unchanged.
- `app/globals.css` — native shell + tab-bar styles, safe-area insets (coordinate with the `gc-safe-area` work if we do the contentInset overhaul).

**Architecture choice — state-based shell (recommended) vs route-based:**
- **State-based (recommended):** `NativeAppShell` swaps tab *views* via local state → instant, no reloads, true app feel. Reuses existing components as panels.
- **Route-based (faster interim):** tabs are `Link`s to routes (`/`, `/settings`, +new `/history`,`/tools`). Lower effort, but full-page nav feels web-y. Use only if we need a quick win.

**Persistence:** keep last-active tab in `localStorage` so reopening the app returns to where they were.

---

## 5. Preserve access / compliance
- Legal links (Help/Terms/Privacy/Contact) already live in **Settings** ✅ — nothing lost by hiding the web footer/nav.
- A2P business info stays on the public web footer ✅.
- Privacy Policy also provided via App Store Connect metadata ✅.

## 6. Testing
- **Browser preview:** force native mode with `localStorage.setItem('gc_native_platform','ios')` + reload (or spoof the `GasCapiOS` UA) to see the shell without a device.
- **TestFlight / Play internal:** verify tab bar, safe-area insets (top + bottom), no marketing chrome, legal links reachable in Settings, full purchase/giveaway flows still work.

## 7. Phasing
1. **Phase 1:** `NativeTabBar` + `NativeAppShell` (5 tabs w/ icon+label, state-based), marketing stripped on native.
2. **Phase 2:** edge-to-edge + per-tab native title bars + last-tab persistence.
3. **Phase 3:** polish — CSS slide transitions, active-tab micro-animations. (Optional: Capacitor Haptics for tab taps — that one *would* need a rebuild.)

**Effort:** Phase 1 ≈ 1 focused session. All web, no rebuild (Phases 1–2).

# GasCap™ $20 Gift Campaign — Funnel Spec

**Status: IMPLEMENTED on branch `feat/gift20-campaign`** (not yet merged/deployed). Spec written 2026-10-01 against `main` @ `8f0e86f`.

### Decisions (Don, 2026-10-01)
- **D1 — RESOLVED:** price is **$19.99**; cards print $19.99.
- **D2 — RESOLVED:** landing at **`/gift/20`**; QR → `www.gascap.app/q/GIFTxx`.
- **D3 — RESOLVED:** founder letter approved with the corrected vacation sentence.
- **D6 — pull quote OMITTED** (not confirmed as Don's own words).
- Founder photo: pending from Don → drop at `public/marketing/gift20/don-parker.jpg` and redeploy (initials placeholder until then).

> **Live copy is `translations.gift20` (EN + ES), not §3 below.** §3 is the original draft; the review round on 2026-10-01 tightened eligibility, precision and price-freshness wording (see `docs/reviews/2026-10-01-gift20-campaign.md`).

### What was built (differs from the plan below where noted)
- `app/gift/20/` — landing page (copy in `translations.gift20`, EN + ES). No "Read more" expander — the letter is short and hiding the "$20 is really yours" paragraph would bury the key message.
- Hero image: crop of the store screenshot's result cards only (`public/marketing/gift20/result-card.jpg`) — the full screenshot says "exact fill-up cost" and shows giveaway entries, both off-message here.
- `cta_click` / `section_view` events (allowlisted in `lib/gift20.ts`); `/q` sets `utm_medium=physical-card` for `placement='card'`.
- `/api/campaign/lead` now requires `emailConsent: true`; phone forwarded to GHL only with `smsConsent: true`.
- `components/Gift20ThankYou.tsx` on `/upgrade/success` (web Lifetime + GIFT cookie only). The existing getaway picker already covers "claim", so no separate claim CTA.
- Per-card funnel: `GET /api/admin/campaigns?gift20=1` (existing admin auth, read-only) + panel on `/admin/campaigns`. Replaces the planned local report script — campaign events live on the Railway volume, so a local script can't read them.
- `scripts/gift20-placements.mjs` — creates GIFT00–10 (dry run by default; `--apply` writes). The admin form can't set campaign/landingPath; `card` was added to its placement list so editing a card doesn't reset it to `counter`.
- QR print files: `https://www.gascap.app/api/qr?size=1200&data=<encoded /q/GIFTxx URL>` (existing branded QR endpoint; the script prints all 11).
- GHL chat widget excluded on `/gift/20`; `/gift` shows a "Got a card from Don?" link; `/terms#getaway` anchor; help FAQ + APP FEATURES updated.

---

**Original plan (PLANNED → largely implemented above):**
**Owner:** Don Parker · **Test size:** 10 cards, each with a real $20 bill · **Window:** first weekend of Oct 2026

This doc covers what exists today, what blocks launch, and the funnel design: copy, CTAs,
analytics, implementation tasks. Every product claim was checked against the repo. Anything
not verifiable is marked **⚠ VERIFY** or **⛔ DECISION**.

---

## 0. What exists today (repo inspection)

| Area | What exists | Reusable? |
|---|---|---|
| **`/gift` route** | **Already live in production.** It's the "Gift GasCap™ Pro Lifetime" page, where someone *buys* Lifetime for another person via `/api/stripe/gift-checkout`. `/gift/success` and `/redeem` are part of the same flow. | ⛔ **Collides** with the card's `GasCap.app/gift`. See D2. |
| **QR attribution system** | `/q/[code]` (`app/q/[code]/route.ts`). Each code is a `CampaignPlacement` row in Postgres. A scan logs a `scan` event, sets a 90-day `gc_src` attribution cookie and a 30-min `gc_ssn` session cookie, then redirects to `placement.landingPath` with UTMs. Placements are managed in `/admin/campaigns`, which already shows a per-placement funnel. | ✅ Yes, and it's the backbone of this plan. |
| **Client event tracking** | `POST /api/campaign/track` + `components/CampaignTracker.tsx`. Accepts `page_view`, `calc_start`, `calc_complete`, `save_to_phone`, `lead_capture`, `return_visit`. | ✅ Needs 2 new event types (task T3). |
| **Signup attribution** | `app/api/auth/register/route.ts:194` reads `gc_src` and logs a `signup` event with `userId`. | ✅ Works for **web** signups. Native signups are blind to it (see §6.4). |
| **Lead capture** | `POST /api/campaign/lead` stores a `lead_capture` event and upserts to GHL with attribution tags. | ✅ Needs consent fields (task T5). |
| **Event storage** | Placements live in Postgres. **Events live in `data/campaign-events.json`**, one of the 7 known file-backed stores (CLAUDE.md). | ⚠ OK for a 10-card pilot because we're reusing the store, not creating one. Export the data after the test, since it's invisible to DB backups. |
| **Web Lifetime checkout** | `/signup?next=/upgrade?auto=lifetime` → sign up → auto-starts Stripe checkout (`app/upgrade/page.tsx:105`). Checkout requires a session (401 otherwise). **No Stripe automatic tax**, so the web charge is exactly $19.99. | ✅ No payment-code change needed. |
| **Native purchase** | iOS/Android use RevenueCat IAP. The button label is hard-coded to `$19.99` (`PRICING.pro.lifetime`). The actual StoreKit/Play price isn't in the repo. | ⚠ VERIFY the store prices in App Store Connect / Play Console. |
| **Cross-platform entitlement** | `lib/entitlements.ts` resolves Pro from `stripe_or_gift_lifetime` \| `stripe_subscription` \| `revenuecat` \| `ambassador`. A web Lifetime purchase unlocks Pro in the app **when they sign in with the same account**. | ✅ Safe to say, with the "same account" caveat. |
| **Free trial** | Every new signup gets **30 days of Pro** (`register/route.ts:107`). | ✅ An honest, strong hook. |
| **Getaway (vacation certificate)** | `lib/getawayPromo.ts`: active, no end date. Fires on **any** Lifetime purchase: Stripe webhook **and** RevenueCat (`app/api/native/revenuecat/route.ts`). Buyer picks a destination at `/getaway`. Certificate is auto-issued via the Marketing Boost API after a **72-hour verification**. Eligibility = promo active AND not already Lifetime. Terms are in `GETAWAY_DISCLOSURE`, `/terms` §4b and `/privacy` §6c. | ✅ Terms are verified (§8). |
| **App store links** | iOS `https://apps.apple.com/app/id6761315915` · Android `https://play.google.com/store/apps/details?id=app.gascap.mobile`. `/download` already has UA-based button ordering + store-click tracking. | ✅ Reuse its badge components and UA logic. |
| **Brand assets** | `public/gascap-icon-raw.png` (orange nozzle+gauge) + "GasCap™" wordmark via `components/BrandBar.tsx`. Also `public/logo-lockup-green.png`, `logo-lockup-white.png`, and iPhone screenshots in `public/store-screenshots/`. | ✅ Use `BrandBar` + the existing lockups. **No new logo.** The gauge/speedometer concept is a post-TRNDY rebrand idea only. |
| **Popups** | `AdLandingBanner` (getaway modal) mounts only on `app/page.tsx`. The GHL chat widget is desktop-only. | ✅ A new route gets neither. Keep it that way. |
| **Social proof** | There's a `/api/user-count`, but per the brief, **no user counts, reviews or savings totals**. | Don't use it. |

### Features verified as live (source: `APP FEATURES` block in `app/api/ai/chat/route.ts`)
- **Fuel calculator.** Enter the current level as %, gallons, or miles-to-empty, and get estimated gallons and cost to fill. All results are estimates.
- **Budget calculator.** Enter a dollar amount and get approximate gallons at today's price (`budgetIntroSub` in translations).
- **Find Gas.** Live nearby prices via Google Places plus community reports. **Pro**, so it's included in the 30-day trial.
- **Rental Return Assistant.** Starting a rental requires **Pro** (trial covers it). An active rental stays usable if Pro lapses.
- **Saved vehicles + VIN decode.** Unlimited vehicles is a Pro feature. Free has a limit, so say "save your vehicles", not "unlimited".
- **Lifetime is a one-time payment.** Per `/terms` §4 it is **final / non-refundable**. Lifetime Perks ($9.99/yr) is a separate, optional add-on.

---

## 1. Blockers and decisions — resolve BEFORE printing

### ⛔ D1. Price mismatch: the card says $19.95, the product is $19.99
The live Lifetime price is **$19.99** on Stripe (`price_1TdrsuDBVCOLcbY2FUvZXsZr`), in `lib/stripe.ts`, on `/terms`, and on the native button. Nothing in the repo is $19.95.

- **Recommended:** print **$19.99**. The core message still holds: $20 covers the web price with 1¢ left over.
- Not recommended for this test: changing Lifetime to $19.95. That means a new Stripe price object, a new Railway env var, and re-checking the `$X-off` founding/win-back coupons. $19.95 may also not be an available App Store price point (⚠ VERIFY if pursued). CLAUDE.md requires explicit instruction before any price change, and it isn't worth doing for a 10-card test.
- **If cards are already printed with $19.95:** reprint, or add a correction sticker. A printed price that doesn't match checkout is a consumer-trust problem, even at 4¢.

### ⛔ D2. `gascap.app/gift` is already taken
Pointing the QR at `/gift` would land recipients on a page asking them to **buy a gift for someone else**. That's the opposite of the message.

**Recommended routing:**
- **QR codes encode** `https://www.gascap.app/q/GIFT01` … `GIFT10`. This uses the existing `/q` system, so each card gets per-card attribution with zero new tracking infrastructure. Use `www`, because apex redirects through Cloudflare and adds a hop.
- **Landing page:** new route **`/gift/20`**. A static segment coexists safely with `/gift/success`, and it still reads like the card.
- **Printed text** under the QR: `gascap.app/gift/20`. This is for anyone who types it rather than scans. Typed visits get UTMs but no card code.
- **Safety net:** add a one-line banner to the existing `/gift` page: "Got a card from Don with $20 attached? **Start here →** /gift/20". This covers anyone who types the shorter URL.

### ⛔ D3. The vacation certificate requires a Lifetime purchase
The draft founder copy says the certificate is "another thank-you for taking the time to check out something I created." **That's inaccurate.** The certificate goes only to people who make a **non-refunded Pro Lifetime purchase** (72-hour verification, one per household per 12 months, not available to existing Lifetime members). Copy that implies it's available just for visiting would mislead people. Corrected wording is in §3.4.

### ⚠ D4. Questions for an attorney (not blockers for 10 cards, but flag now)
1. **Florida Sellers of Travel Act** (Fla. Stat. ch. 559, Part XI) regulates offering "vacation certificates" in Florida. I can't determine from the repo whether GasCap, as an offeror of a third-party certificate bundled as a purchase bonus, is covered or exempt. **This is a question, not a conclusion.** Ask before scaling past a handful of cards.
2. The meaning of **"Lifetime"** (the life of the GasCap service vs. the buyer's life). `/terms` §4 says "permanent license" but doesn't define the term limit.
3. The memory note says RedeemVacations certificates are **void if "purchased by recipient."** The current framing keeps Lifetime as the product and the certificate as a bonus. This funnel must hold that line: never "use your $20 to get a vacation."

### ⚠ D5. Store prices and tax
- The web price is exactly $19.99 because no tax is collected (`automatic_tax` isn't used).
- Apple and Google may add sales tax in some states, so "$20 covers it" is only guaranteed for the **web** purchase. The copy says "currently $19.99" and doesn't promise to-the-penny coverage in-app.

### ⚠ D6. The founder quote must be approved by Don
"Sometimes good technology doesn't need to make life complicated…" is **proposed copy**. Use it only if Don accepts it as his own words. Otherwise drop it.

---

## 2. Funnel strategy

**The visitor is holding a $20 bill a stranger just gave them.** Their first thought is *"what's the catch?"* The page has one job in the first 3 seconds: **remove the catch.** Every later section depends on that trust.

Conversion path, in psychological order:
1. **Confirmation.** "Yep, it's really yours." This resolves suspicion and confirms they're in the right place.
2. **Autonomy.** "Your $20, your choice." Explicitly endorsing *not* buying makes buying feel like a free choice rather than an obligation. That's the honest version of reciprocity, and it's also more persuasive.
3. **Understanding.** What GasCap does, in one plain question: *"How much gas do I actually need?"*
4. **Person.** Who Don is and why he built it. Founder credibility stands in for social proof we don't have yet.
5. **Low-commitment action.** Download free. **Everyone gets 30 days of Pro**, so they can judge the app before spending a cent. This is the primary CTA.
6. **Optional purchase.** Lifetime, $19.99, one-time. Presented calmly, once, with "all sales final" disclosed.
7. **Bonus.** The vacation certificate, clearly tied to Lifetime and fully disclosed, below the Lifetime offer and never above it.

**Primary success metric:** app download / account created. **Secondary:** Lifetime purchase.
A 10-card test won't produce statistically meaningful conversion rates. Treat the results as **qualitative signal plus per-card stories**, and present them that way at TRNDY (§6.6).

---

## 3. Page structure and final copy (`/gift/20`)

Mobile-first. Single column. One scrollable page; the "pages" in the brief are sections. EN copy below. ES must also be added in `lib/translations.ts` (task T7). The page should honor `?lang=es` like the existing `/q` flow.

### 3.1 Hero (first viewport, nothing else)
- `BrandBar` (official icon + GasCap™ wordmark, green bar).
- Eyebrow: **My gift to you**
- **H1:** I really did give you $20.
- **Sub:** It's yours. Spend it however you'd like. No strings attached.
- Body: I built GasCap to help drivers make smarter decisions at the pump, and I'd love for you to try it.
- **Primary CTA:** `Download GasCap — free` (store chosen by device, §5)
- **Secondary (text link):** `Why did I give you $20? ↓` (scrolls to §3.4)
- Visual: one existing iPhone screenshot from `public/store-screenshots/final/` showing the calculator result, in a phone frame.

### 3.2 Your $20, your choice
**H2:** Your $20. Your choice.

| Option A | Option B |
|---|---|
| **Keep it.** Coffee, lunch, gas, a treat for your family. It's yours either way. | **Put it toward GasCap Lifetime.** Lifetime is currently **$19.99**, a one-time purchase with no subscription. |

Footnote line: *No purchase is expected. The $20 is a gift, not a coupon, rebate, or credit.*

### 3.3 What is GasCap?
**H2:** Know before you pump.
Lead: GasCap answers two everyday questions: **"How much gas do I actually need?"** and **"What will my budget actually put in the tank?"**

Feature tiles (all verified live):
1. **Know how much you need.** Tell GasCap your current fuel level and it estimates how many gallons, and roughly what it'll cost, to fill up.
2. **Set a gas budget.** Have $10, $20 or $40? See approximately how many gallons that buys at today's price.
3. **Check nearby prices.** See current gas prices at stations near you before you pull in.*
4. **Return rentals without overpaying.** Track a rental car's fuel level and estimate what you'll need before you return it, instead of paying the rental company's refuel rate.*
5. **Save your vehicles.** Store your car's tank size once, by VIN or year/make/model, for faster calculations.

\* *Included with Pro. Every new account starts with 30 days of Pro.*
Small print under tiles: *GasCap gives estimates based on your vehicle and the fuel level you enter. Your pump and gauge may vary.*

### 3.4 Why I built GasCap (founder)
Photo placeholder: **Don Parker — Founder, GasCap™** (real photo from Don, ⚠ needed). The founder section stays short on the page, with a "Read more" expander for the full letter.

**H2:** Why did I give you $20?

> My name is Don Parker. I'm a Florida businessman, mechanical engineer, and entrepreneur, and I built GasCap to fix a small problem almost everyone runs into at the pump.
>
> Most of us pull up and guess: how much gas we need, what it'll cost to get to the level we want, or how far a $20 budget will really go.
>
> GasCap takes the guessing out of it. Tell it your vehicle and your current fuel level, and it estimates how much you need, or what your budget will put in the tank, before you start pumping. That's handy whether you're filling up your own car, sticking to a set budget, or returning a rental without buying more gas than you have to.
>
> *[Read more ↓]*
>
> The $20 on your card is my gift to you, and it's really yours. Spend it on gas, lunch, coffee, your family, whatever you like. There's no requirement to spend any of it on GasCap.
>
> If you try GasCap and find it useful, Lifetime is currently $19.99, so the gift happens to cover it if you choose to go that way. Your call either way.
>
> Giving back matters to me, and this is one small way I'm doing it. I hope the $20 makes your day a little better, and I hope GasCap makes your next stop at the pump a little easier.
>
> — Don

*(Optional, only if Don approves it as his words, D6)*: pull quote: "Good technology doesn't have to make life complicated. It just needs to answer a useful question at the moment you need it."

**Vacation transition** (one mention only, D3-corrected):
> One more thing: right now, GasCap Lifetime comes with a vacation certificate as an extra thank-you. It's only included with a Lifetime purchase, and it has real terms and costs, so I've laid out all the details below. Take a look and decide if it's something you'd use.

### 3.5 Lifetime offer
**H2:** One purchase. GasCap Lifetime.
- Price: **$19.99** · one-time · no subscription
- Copy: If you'd like to put today's gift toward GasCap, Lifetime is currently $19.99. That's every Pro feature, unlocked on your account for good, on web, iPhone, and Android.
- **CTA (web):** `Get GasCap Lifetime — $19.99` → `/signup?next=/upgrade?auto=lifetime` (signed-out) or `/upgrade?auto=lifetime` (signed-in)
- **Secondary:** `Prefer to buy in the app? Download GasCap, then upgrade inside.` (store link)
- Disclosure directly under the CTA (required): *One-time purchase. All Lifetime sales are final ([Terms](/terms)). Bought on the web? Sign in to the app with the same account and Pro is already on.*
- **Do not** add a countdown, scarcity, or "only X left."

### 3.6 Vacation certificate (visually distinct: light sand/neutral card, not green)
**H2:** A bonus with Lifetime: vacation certificate
Lead: When you purchase GasCap Lifetime, we include a resort hotel-stay certificate as a thank-you. **This is not a free vacation.** The room rate is covered, but you pay taxes, fees, and your own travel. Here's exactly how it works:

**Who gets one:** Anyone who makes a GasCap Lifetime purchase (web, iPhone, or Android) while this offer is running, and doesn't already have Lifetime. One per household every 12 months.

**How to claim:**
1. Buy Lifetime. Your app access turns on immediately.
2. Pick a destination at **gascap.app/getaway** (U.S. and international options).
3. After a short purchase-verification period (currently 72 hours), your certificate is emailed to you by our travel partner, Marketing Boost / RedeemVacations.

**What it covers / what you pay:**
- Covered: the hotel **room rate** (no timeshare presentation).
- You pay: nightly hotel taxes & fees (vary by destination; shown before you activate), your airfare/travel, food, and any resort fees the hotel charges at check-in. Weekends may carry a small surcharge.

**Key terms:**
- Activate within 7 days of receiving it; travel within 18 months.
- Book at least 30 days ahead; major holidays excluded.
- Up to 2 adults (at least one 21+) and up to 2 children 12 or under. No group travel.
- You must live at least 100 miles from the destination; a major credit/debit card and government ID are required at check-in.
- Activation fees are non-refundable. The certificate has no cash value and is non-transferable.
- If the Lifetime purchase is refunded, reversed, or disputed before fulfillment, the certificate may be cancelled.

Link: `See full vacation certificate terms` → `/terms#getaway` (§4b; anchor needed, task T6) + RedeemVacations.com
Rule: never headline the "$350/night" value.

**⚠ CLARIFY before publishing:** (a) the actual taxes/fee range for the most likely destinations (Orlando, Las Vegas), so the "you pay" line isn't vague; (b) whether non-U.S. residents are eligible; (c) passport requirements for international destinations; (d) D4.1.

### 3.7 Optional updates (lead capture, below everything, never gating)
**H3:** Want GasCap tips and updates?
Fields: First name · Email · Phone (optional)
- ☐ Email me GasCap tips, updates and offers. (required to submit; unsubscribe anytime)
- ☐ *(only shown if phone entered)* Text me GasCap updates. Msg & data rates may apply; msg frequency varies; reply STOP to opt out, HELP for help. Consent not required to purchase. **⚠ VERIFY** this matches the registered A2P campaign language for (321) 513-1321.
- Link: Privacy Policy.
- Button: `Keep me posted`. Success: "Thanks! You're on the list."

**Recommendation:** keep it optional and at the bottom. Putting a form before the download would add friction at the trust-critical moment and undercut "no strings attached."

### 3.8 Footer
GasCap™ is a product of Gas Capacity LLC, Orlando, FL · [Terms](/terms) · [Privacy](/privacy) · admin@gascap.app.
**Do not** mention the monthly giveaway/sweepstakes. It's compliance-sensitive, `GIVEAWAY_PAUSED` is set, and it would make the page feel like a promotion.

### 3.9 Thank-you (post-purchase)
Show on `/upgrade/success` **only when** `gc_src` starts with `GIFT` and the purchase was Lifetime. The default success page is unchanged for everyone else.
- **H1:** Welcome to GasCap Lifetime.
- Sub: And thank you for giving the app I built a chance. — Don
- Actions: (1) `Open / download GasCap` (store by device; reminder: "sign in with this same account"). (2) `Choose your vacation destination` → `/getaway` (existing). (3) `Know someone who could use GasCap? Share it` → native share sheet with `https://www.gascap.app` (or their referral link if `/api/referral` provides one, ⚠ VERIFY).
- No upsell. No Lifetime Perks pitch on this screen.

---

## 4. CTA map

| CTA | Section | Destination | Event |
|---|---|---|---|
| Download GasCap — free (iOS) | Hero, §3.5 secondary, footer | `apps.apple.com/app/id6761315915` | `cta_click {cta:'app_store'}` |
| Download GasCap — free (Android) | same | `play.google.com/...id=app.gascap.mobile` | `cta_click {cta:'google_play'}` |
| Desktop: both badges + "Use it on the web" | Hero | both stores + `/` | `cta_click {cta:'web_app'}` |
| Why did I give you $20? | Hero | `#why` (in-page) | `cta_click {cta:'see_why'}` |
| Read more | §3.4 | expands in place | `cta_click {cta:'read_more'}` |
| Get GasCap Lifetime — $19.99 | §3.5 | `/signup?next=%2Fupgrade%3Fauto%3Dlifetime` (or `/upgrade?auto=lifetime` if signed in) | `cta_click {cta:'web_lifetime'}` |
| See full certificate terms | §3.6 | `/terms#getaway` | `cta_click {cta:'getaway_terms'}` |
| Choose your destination | §3.9 | `/getaway` | `cta_click {cta:'getaway_claim'}` |
| Keep me posted | §3.7 | `POST /api/campaign/lead` | `lead_capture` (server) |
| Share | §3.9 | `navigator.share` → `www.gascap.app` | `cta_click {cta:'share'}` |

**Native shell guard:** if `/gift/20` ever loads inside the iOS/Android app (`useIsNative()`), hide the Stripe Lifetime CTA and show only "Upgrade in the app." This follows the existing `/gift` page pattern and CLAUDE.md's no-Stripe-in-iOS rule.

---

## 5. Mobile UX
- **No automatic store redirect.** They land on the page first, as specified in the brief.
- **Device detection** reuses `/download`'s UA logic. iPhone shows a large App Store badge first; Android shows Play first; desktop shows both side by side plus "use it on the web."
- **Sticky bottom bar** appears after scrolling past the hero, with one button: `Download GasCap — free`. It hides once the §3.5 Lifetime CTA is on screen, so two CTAs never compete.
- **Fast load:** server-render the copy; one optimized screenshot (`next/image`, priority) above the fold; no video. Target LCP under 2.5 s on 4G.
- Tap targets ≥ 44 px; body ≥ 16 px; respect `env(safe-area-inset-*)` like `BrandBar` does.
- **No popups, no chat widget, no exit-intent.**
- Language toggle stays in `BrandBar`; `?lang=es` is honored.
- Visual tone: current GasCap green + charcoal + white, restrained gradient in the hero only, a fuel-gauge motif as a subtle divider. **Never 🔥.** No confetti, no "WINNER" styling.

---

## 6. Analytics plan

### 6.1 Identifiers
- **Per-card codes:** `GIFT01`–`GIFT10`, created as `CampaignPlacement` rows in `/admin/campaigns`. No code needed for this step. Suggested values: `campaign: "20dollar-gift"`, `station: "Don Parker — personal handout"`, `placement: "card"`, `headlineVariant: "GIFT20-v1"`, `landingPath: "/gift/20"`.
- **QR URL:** `https://www.gascap.app/q/GIFT01`. `/q` appends `utm_campaign=20dollar-gift` (from placement), `utm_content=GIFT01`, and `utm_source=gascap_qr`. Task T2 sets `utm_medium=physical-card` when `placement==='card'`; placards are unchanged.
- **Typed URL** (`gascap.app/gift/20` with no code): the page sets `utm_source=typed` and has no card attribution.
- **Per-card is worth it:** with 10 cards, knowing *which* card converted is most of what the test can tell you. It costs nothing because `/q` already does it. Each code is effectively one person, unless they share the card with someone else.

### 6.2 Events

| # | Metric | Source | Exists? |
|---|---|---|---|
| 1 | QR scans / sessions | `scan` from `/q` | ✅ |
| 2 | Unique visitors | distinct `gc_ssn` per code (≈ distinct people per card) | ✅ |
| 3–5 | App Store / Play / web-Lifetime clicks | `cta_click` + `meta.cta` | **T3: add `cta_click`** |
| 6 | Lifetime purchases | read-only query (§6.3) | ✅ data exists |
| 7 | Certificate terms clicks / claims | `cta_click getaway_terms`; claims from `/getaway` choose records | partial |
| 8 | Lead submissions | `lead_capture` | ✅ |
| 9 | Abandonment | last `section_view` per session (hero / choice / features / founder / lifetime / getaway / lead) | **T3: add `section_view`** |
| 10 | Device | `userAgent` on every event | ✅ |
| 11 | Source | `gc_src` code + UTMs | ✅ |

`page_view` is already supported. Mount `CampaignTracker` (or a slim `useCampaignEvent` hook) on `/gift/20`.

### 6.3 Purchase attribution
- **Web path (fully attributable):** the visitor signs up in the same browser that scanned, so `register` logs a `signup` event with `userId` under `GIFTxx`. A **read-only** report joins `signup` events for `GIFT*` codes to `User` (Lifetime via `stripeInterval='lifetime'` or RevenueCat lifetime) and prints per card: scanned → signed up → Lifetime → revenue. This is a script or admin-panel query; no payment-code change.
- **App path (attribution gap, stated honestly):** a store install starts the app with a fresh WebView. The `gc_src` cookie doesn't carry over, so app-only signups and IAP purchases **cannot be tied to a card automatically**. With only 10 people, the practical fix is a **manual reconciliation:** all Lifetime purchases between card handout and +14 days, matched to Don's own handout log (card # → first name/place, nothing more). I'd keep that log in a private note, not in the app.
- Deliberately **not** proposed for this test: adding campaign metadata to Stripe checkout. That's a payment-route change that needs tests and review, and it's unnecessary at n=10.

### 6.4 Metrics to report

| Metric | Definition |
|---|---|
| Cards distributed | 10 (manual) |
| Scan rate | cards with ≥1 `scan` ÷ 10 |
| Engagement | scanned sessions reaching `section_view: founder` |
| Download intent | sessions with a store `cta_click` |
| Signups (attributed) | `signup` events under GIFT* |
| Lifetime conversions | attributed + manually reconciled, **labelled separately** |
| Gross Lifetime revenue | conversions × $19.99, minus Apple/Google fees for IAP |
| Net campaign cost | $200 cash + printing − net revenue |
| Leads | `lead_capture` count |

### 6.5 Data hygiene
- Export `data/campaign-events.json` rows for `GIFT*` within 7 days of the test; the file store isn't backed up.
- Don's own test scans will pollute the data. Test with a separate code (`GIFT00`, inactive after launch) and never scan GIFT01–10 yourself.

### 6.6 What to say at TRNDY
Report raw numbers ("7 of 10 scanned, 4 downloaded, 2 bought Lifetime") plus per-card stories. Don't present percentages from n=10 as conversion rates, and don't extrapolate. If results are weak, the honest framing is "we learned X about the message."

---

## 7. Technical implementation

**Principle:** additive only. No changes to Stripe checkout, webhooks, entitlements, the getaway pipeline, or the existing `/gift` purchase flow.

| Touch | Change | Risk |
|---|---|---|
| `app/gift/20/page.tsx` (new) | The landing page. Server component for copy; small client islands for device-aware badges, sticky bar, section-view observer, lead form. | Low (new route) |
| `lib/campaigns.ts` + `app/api/campaign/track/route.ts` | Add `cta_click`, `section_view` to `CampaignEventType` and `VALID_TYPES`; allowlist `meta.cta` and `meta.section` values. | Low |
| `app/q/[code]/route.ts` | `utm_medium = placement?.placement === 'card' ? 'physical-card' : 'placard'`. Placards unchanged. | Low, but `/q` is live for placards, so add a regression test |
| `app/api/campaign/lead/route.ts` | Accept `emailConsent: boolean`, `smsConsent: boolean`, `consentTextVersion`; reject when `emailConsent` is false; only send phone to GHL when `smsConsent`; tag `gift20`. | Medium (touches GHL + SMS consent) |
| `app/gift/page.tsx` | One-line "Got a card from Don?" banner → `/gift/20`. | Low |
| `app/upgrade/success/page.tsx` | Conditional gift-campaign thank-you block (cookie `gc_src` starts with `GIFT` + Lifetime). Display only. | Low–medium (payment success page, display-only) |
| `app/terms/page.tsx` | `id="getaway"` anchor on §4b. | Low |
| `lib/translations.ts` | EN + ES strings for all page copy. | Low |
| `app/help/page.tsx` + `APP FEATURES` | Only if the page becomes a lasting surface. For a private 10-card test, a one-line note in APP FEATURES is enough so the assistant can answer "I got a card with $20". | Low |
| Read-only report script | `scripts/gift20-report.ts`: header says **READS ONLY**. Joins GIFT* signup events to User plan state. | Low |

**Middleware/auth:** confirm `/gift/20` is public (not behind any auth matcher) and not cached long (HTML is `no-store` per the June cache fix).

**Branch:** `feat/gift20-campaign` (the current branch is `main` with an unrelated uncommitted `public/sw.js`, which must not be swept in). Stage explicit paths only.

**Required checks:** `npm test`, `npx tsc --noEmit`, `npm run build`. Tests: `/q` utm_medium for card vs placard; track route accepts `cta_click`/`section_view` and rejects unknown values; lead route consent behavior.

**Review:** lead/SMS consent and the success-page change touch compliance and payment surfaces, so per CLAUDE.md, recommend a ChatGPT review packet before merge. Given the timeline, the packet can be short.

---

## 8. Vacation certificate — verified terms and gaps

**Verified in the repo** (`lib/getawayPromo.ts` `GETAWAY_DISCLOSURE`, `/terms` §4b, `/privacy` §6c, `APP FEATURES`):
- Requires a non-refunded Pro Lifetime purchase on any platform while the promo is active; not available to people who already have Lifetime.
- The certificate is issued after a 72-hour purchase verification, by Marketing Boost / RedeemVacations, via API.
- Room rate covered; traveler pays nightly taxes & fees (vary, shown at activation), airfare, food, resort fees; weekend surcharge possible.
- Activate within 7 days; travel within 18 months; book 30+ days ahead; major holidays excluded.
- 2 adults (one 21+) + 2 children ≤12; no group travel; live 100+ miles away; credit/debit card + ID at check-in.
- Activation non-refundable; non-transferable; no cash value; one per household per 12 months.
- Refund/dispute before fulfillment → may be cancelled. Refund after issuance → Lifetime access may be revoked.
- Privacy: name + email shared with the partner only after the buyer selects a destination.
- The promo is **standing** (`GETAWAY_END_DATE = null`), kill-switch `GETAWAY_ACTIVE=false`.

**Not verifiable from the repo, so clarify before publishing:** typical fee amounts per destination; residency/citizenship eligibility; passport needs for international destinations; blackout list beyond "major holidays"; Florida Sellers of Travel applicability (D4.1).

---

## 9. Compliance and trust review

**Must-haves**
1. Correct price everywhere: **$19.99** (D1).
2. The gift is unconditional. Never "rebate / credit / coupon / redeem / claim your $20." The $20 must never appear as a step in the purchase flow.
3. The certificate is clearly tied to the Lifetime purchase (D3). Use "vacation certificate," never "free vacation." Costs are disclosed in the same section, not behind a link only.
4. "All Lifetime sales are final" appears next to the purchase CTA.
5. Use estimate language for all fuel math ("estimate," "approximately").
6. Only claim verified features. Pro features are marked as Pro, with the 30-day trial noted.
7. No fabricated social proof, user counts, savings figures, or testimonials.
8. Founder quote only with Don's approval (D6).
9. SMS consent copy matches the registered A2P campaign; email consent is explicit; Privacy is linked.
10. No sweepstakes/giveaway mention.
11. No Stripe purchase path rendered inside the native app.

**In person (Don's script, so it matches the page)**
- Say "it's yours, no catch." **Don't** ask them to buy or download on the spot, and don't follow up about whether they bought. Pressure would contradict the page.
- Don't promise the vacation. If asked, say "it comes with Lifetime and the details are on the page."

**Wording to avoid:** "free vacation," "win," "lucky," "claim your reward," "limited time," "only today," "guaranteed savings," "exact gallons," "you'll save $X."

---

## 10. Launch checklist (before printing / handing out)

- [ ] **D1** Card price changed to **$19.99** (or reprint/sticker)
- [ ] **D2** QR codes generated for `https://www.gascap.app/q/GIFT01`…`GIFT10`; printed fallback text `gascap.app/gift/20`
- [ ] **D3** Founder vacation sentence uses the corrected wording
- [ ] **D6** Don approves the founder letter and pull quote (or drops the quote)
- [ ] Don's photo supplied (square, ≥800 px)
- [ ] Placements GIFT00 (test) + GIFT01–10 created in `/admin/campaigns`
- [ ] `/gift/20` live on production; tested on a real iPhone (Safari) and Android (Chrome), plus desktop
- [ ] Each of the 10 QR codes scanned once on a **test device**, confirmed to redirect correctly, then those test events noted/excluded (or test with GIFT00 only and spot-check 2 real codes)
- [ ] Web Lifetime path tested end-to-end in Stripe **test mode** from `/gift/20` → signup → checkout → success page (gift variant) → `/getaway`
- [ ] Store prices for Lifetime confirmed in App Store Connect + Play Console (D5)
- [ ] Getaway kill-switch confirmed on (`GETAWAY_ACTIVE` not `false` in Railway)
- [ ] SMS consent language verified against the A2P registration
- [ ] `/terms#getaway` anchor works
- [ ] ES copy reviewed
- [ ] Handout log ready (card # → place/first name only)
- [ ] Not deployed during the 9:45–10:15 AM ET cron window
- [ ] (Recommended before scaling, not before 10 cards) attorney question on D4

---

## 11. Implementation tasks

| ID | Priority | Task | Est. |
|---|---|---|---|
| T0 | **P0** | Don: decide D1 (price on card), D2 (URL), approve founder copy (D3/D6), supply photo | — |
| T1 | **P0** | Build `/gift/20` page (sections 3.1–3.8), official `BrandBar`, device-aware badges, sticky bar, native-shell guard | 4–5 h |
| T2 | **P0** | `/q` `utm_medium` for `placement==='card'` + regression test | 30 m |
| T3 | **P0** | Add `cta_click` + `section_view` event types (allowlisted meta) + tests; wire on page | 1 h |
| T4 | **P0** | Create GIFT00–10 placements in admin; generate QR PNGs for print | 30 m |
| T5 | P1 | Lead form + consent fields on `/api/campaign/lead` + tests | 1.5 h |
| T6 | P1 | `/terms#getaway` anchor; `/gift` "Got a card from Don?" banner | 20 m |
| T7 | P1 | ES translations for all strings | 1 h |
| T8 | P1 | Gift-variant thank-you block on `/upgrade/success` | 1 h |
| T9 | P1 | Read-only `scripts/gift20-report.ts` (per-card funnel + Lifetime join) | 1 h |
| T10 | P2 | APP FEATURES one-liner so the assistant can answer card questions | 10 m |
| T11 | P2 | Short ChatGPT review packet (lead consent + success page) | 30 m |
| T12 | P2 | Post-test: export GIFT* events; write results doc (labelled HISTORICAL) | 1 h |

**Fastest safe path to the weekend:** T0 → T1–T4 (about one working day) is enough to hand out cards with per-card tracking. T5–T9 can ship before the cards are scanned at scale, but the lead form shouldn't go live without its consent fields. If T5 slips, launch without the lead section.

---

## 12. Scaling (after the test; do not change the $20 test)

| Model | Fit | Notes |
|---|---|---|
| **Smaller amounts ($5–$10)** | Medium | Loses the "covers Lifetime" symmetry, which is the hook. Better as a pure goodwill/brand play. |
| **Sponsor-funded gas cards** | **High** | A gas brand or local station funds a $10–$20 gas card; GasCap's message ("know before you pump") is native to the gift. Sweepstakes/gift-card rules then apply, so get legal review. |
| **Gas-station partners** | High | Extends the existing `/q` placard program; per-station codes already supported. |
| **Rental-car partners** | High | "Return it right" card at the counter, aligned with the Rental Return Assistant. Ties into the rental-partner pitch docs. No integrations without approved specs (CLAUDE.md). |
| **Employer / fleet programs** | Medium | A company buys Lifetime codes in bulk for drivers; the existing `/gift` + `/redeem` flow already supports gifted Lifetime. |
| **Community giveaways / churches / nonprofits** | Medium | Fits the giving story; keep religion out of the consumer page unless Don approves. |
| **Influencers** | Low–medium for now | The founder-handout authenticity doesn't transfer well. FTC endorsement disclosures are required. |
| **Corporate sponsors** | Medium | Branded "gift from X" cards. Needs sponsor terms. |

The single biggest scaling question this test can answer: **does the page earn a download from someone who had no intent to look for a gas app?** If scan → download is strong but download → Lifetime is weak, the scalable version is a cheaper gift + a longer trial nurture, not a bigger gift.

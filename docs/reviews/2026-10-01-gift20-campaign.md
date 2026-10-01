# ChatGPT Review Packet — $20 Gift Campaign (`/gift/20`)

**Date:** 2026-10-01 · **Prepared by:** Claude Code · **For:** Don Parker → ChatGPT
**Timeline:** cards go out this weekend (Oct 3–4, 2026). This is a 10-person field test, so please weight findings toward "would mislead a recipient, leak or mishandle data, or break a live flow" over polish.

---

## 1. Objective

Don will personally hand out 10 business cards, each paperclipped to a **real $20 bill**. The card says the $20 is theirs to use however they like, or they can put it toward **GasCap Lifetime ($19.99)**. A QR code leads to a campaign page. Don asked for a funnel that:

- confirms the gift is unconditional (no coupon/rebate/credit/purchase requirement),
- tells his founder story in his voice,
- explains GasCap honestly (estimates, verified features only),
- offers Lifetime calmly, with correct platform routing,
- discloses the existing vacation-certificate bonus with full terms (never "free vacation"),
- has optional, consented lead capture that never gates the download,
- measures everything per card (scan → page depth → store/Lifetime clicks → signup → Lifetime),
- uses the **current official GasCap logo** only. No new branding.

Goal: real-world data before a TRNDY / Howie Mandel business-development meeting. No conversion claims.

## 2. Repository State

- **Branch:** `feat/gift20-campaign`
- **Review Target SHA:** `5ab4cd2` (last code-changing commit)
- **Packet Commit SHA:** the commit that adds this file. It's later than the target by design.
- **Base branch:** `main` @ `8f0e86f`
- **PR:** none yet. Don asked for this review before a PR.
- **Review this diff:** `git diff --name-status main...5ab4cd2` (output in §10)

## 3. What I Found (before changes)

- **`/gift` was already a live route:** "Gift GasCap Pro Lifetime", a checkout where someone *buys* Lifetime for another person. Pointing the card at `/gift` would have shown recipients a purchase page for a gift to someone else. Don approved **`/gift/20`** instead.
- **Price mismatch in the brief:** the card draft said **$19.95**. Every live source says **$19.99**: Stripe price, `PRICING.pro.lifetime`, `/terms` §4, and the native button label. Don confirmed $19.99. No price changed.
- **The founder draft implied the vacation certificate was a thank-you "for checking out GasCap."** In code it requires a non-refunded Lifetime purchase (72-hour verification, one per household per 12 months, not available to existing Lifetime holders: `lib/getawayPromo.ts` `getawayOfferStatus`, `GETAWAY_DISCLOSURE`). The copy was corrected and Don approved it.
- **The QR placement system already existed and was reused:** `/q/[code]` (scan log + 90-day `gc_src` cookie + redirect), `CampaignPlacement` in Postgres, `/api/campaign/track`, `/api/campaign/lead`, signup attribution in `/api/auth/register`.
- **Campaign events are stored in `data/campaign-events.json`**, one of the 7 known file-backed stores (CLAUDE.md). It was reused, not newly introduced. It isn't covered by DB backups.
- **`/api/campaign/lead` had no in-repo caller** and no consent handling. It forwarded any phone number to GHL.
- **Google sign-ups are not campaign-attributed.** Only `/api/auth/register` logs the `signup` event; the NextAuth Google `signIn` callback (`lib/auth.ts`) doesn't. This is pre-existing. I left it alone (auth-flow change, days before launch) and documented it.
- **The web Lifetime path needed no payment change.** `/signup?next=/upgrade?auto=lifetime` already auto-starts Stripe checkout after signup. Stripe `automatic_tax` is not used, so the web charge is exactly $19.99.
- **Purchases are honored across platforms.** Entitlement is resolved from the DB across Stripe/RevenueCat/gift sources (`lib/entitlements.ts`). A web Lifetime unlocks the native app when the user signs in with the same account. The getaway fires on both the Stripe webhook and the RevenueCat path.

## 4. What I Changed

| File | Before → After |
|---|---|
| `app/gift/20/page.tsx`, `Gift20Landing.tsx` (new) | Landing page: hero, "your $20, your choice", verified features, founder letter, Lifetime offer, vacation-certificate terms, optional updates form. Device-aware store buttons; sticky download bar on phones; `noindex`. A native-shell guard (`useIsNative`) hides the Stripe Lifetime CTA. |
| `lib/gift20.ts` (new) | Campaign constants: `isGift20Code` (`/^GIFT\d{2}$/i`), CTA and section allowlists, store URLs, `GIFT20_CONSENT_VERSION`. |
| `lib/campaigns.ts` | `CampaignEventType` adds `cta_click`, `section_view`. |
| `app/api/campaign/track/route.ts` | Accepts the two new types **only** with an allowlisted `meta.cta` / `meta.section`; stores only that single key (other meta discarded). 400 otherwise. Existing types unchanged. |
| `app/q/[code]/route.ts` | `utm_medium` = `physical-card` when `placement === 'card'`, else `placard` (unchanged for placards). |
| `app/api/campaign/lead/route.ts` | **Behavior change:** now requires `emailConsent === true` (strict boolean) → else 400 and nothing stored or sent. Phone is forwarded to GHL **only** if `smsConsent === true`. Consent flags + server-side `consentVersion` are recorded on the event. GHL tags added: `gascap-email-consent`, `gascap-consent-<version>`, `gascap-sms-consent` (if SMS), `gascap-campaign-<campaign>`. |
| `components/Gift20ThankYou.tsx` (new) + `app/upgrade/success/page.tsx` | Display-only thank-you note + store links + share. Rendered only when `billing === 'lifetime' && !isNativeIap` **and** the `gc_src` cookie is a GIFT code. Reads no entitlement and gates nothing. |
| `lib/gift20Funnel.ts` (new) | Pure per-card funnel builder (sessions, section reach de-duped by session, CTA counts, leads, signups, Lifetime buyers among attributed signups, de-duped by user). |
| `app/api/admin/campaigns/route.ts` | New read-only branch `GET ?gift20=1` behind the **existing** admin auth: filters GIFT events, `SELECT`s plan columns for attributed userIds, applies `hasLifetimeEntitlement`, and returns the funnel. |
| `components/admin/Gift20FunnelPanel.tsx` (new) + `app/admin/campaigns/page.tsx` | Admin panel rendering the funnel. Adds `card` to `PLACEMENT_TYPES`; without it, editing a GIFT placement would silently reset it to `counter`. |
| `scripts/gift20-placements.mjs` (new) | Creates GIFT00 (test) + GIFT01–10. **Dry-run by default**; `--apply` inserts missing rows with `ON CONFLICT (code) DO NOTHING`, prints before/after, `featured=false`. Prints QR targets + `/api/qr` print links. **Not yet run.** |
| `app/gift/page.tsx` | Adds a "Got a card from Don with $20 attached? Start here →" link to `/gift/20`. |
| `components/GHLChatWidget.tsx` | `/gift/20` added to `EXCLUDED_PATHS` (page is deliberately popup-free and has its own SMS opt-in). |
| `app/terms/page.tsx` | `id="getaway"` anchor on §4b. Text unchanged. |
| `lib/translations.ts` | `gift20` block, EN + ES (`es: typeof en` enforces key parity). |
| `app/help/page.tsx`, `app/api/ai/chat/route.ts` | Help FAQ entry + APP FEATURES line: the $20 is unconditional; the certificate requires a Lifetime purchase; never "free vacation." |
| `public/marketing/gift20/result-card.jpg` (new) | Crop of the existing store screenshot showing only the "Est. gallons / Est. cost" cards. The full screenshot says "exact fill-up cost" and shows giveaway entries. |
| `docs/GIFT20_CAMPAIGN_SPEC.md` (new) | Full spec: strategy, copy, CTA map, analytics, compliance review, launch checklist. |

## 5. Architectural Decisions

1. **Reuse `/q` + `CampaignPlacement` instead of new tracking.** Per-card attribution came for free. The alternative was a `?gift=01` param on the landing page with its own scan logging, which would have duplicated proven code.
2. **No payment-route changes.** I considered adding campaign metadata to Stripe checkout for purchase attribution and rejected it. It touches a security-hardened route, and at n=10 a read-only join of attributed **signups** → current Lifetime status is enough. App-store purchases can't be attributed at all (fresh WebView, no cookie), so I stated that honestly and added a manual handout log.
3. **The funnel lives in the admin route, not a local script.** Events are on the Railway volume, so a local script can't read them. The new branch is read-only and uses the existing admin auth.
4. **The consent version is server-side, never client-supplied.** The stored record reflects what the server was serving.
5. **Copy lives in `translations.ts`**, following the repo convention. The compile-time type forces ES parity.
6. **Section-view tracking uses a viewport-middle band** (`rootMargin: '-45% 0px -45% 0px'`), not a fractional threshold. A threshold of 0.35 can never fire on a section taller than ~2.8 viewports. I found and fixed this in `5ab4cd2`.

## 6. Security Impact

- **Fixed:** the lead endpoint no longer pushes unconsented contacts or phone numbers to GHL/SMS.
- **New surface:**
  - `GET /api/admin/campaigns?gift20=1` is behind the existing `auth()` (legacy admin header **or** admin session). It returns aggregate counts only: no emails, no user IDs.
  - `/api/campaign/track` gained two event types with strict allowlists.
- **Unchanged pre-existing weaknesses (not introduced here):**
  - `/api/campaign/track` and `/api/campaign/lead` are unauthenticated and **not rate-limited**. Anyone can inflate campaign counts or submit leads. At n=10, a handful of junk events would distort the funnel.
  - The admin dashboard still uses the legacy localStorage/`x-admin-password` pattern (migration planned in `docs/ADMIN_AUTH_MIGRATION.md`).
- **Auth behavior:** unchanged. No webhook, entitlement, or checkout code was modified.

## 7. Data / Database Impact

- **No schema changes, no migrations, no backfills.**
- **Pending production write (not yet run):** `scripts/gift20-placements.mjs --apply` inserts up to 11 `CampaignPlacement` rows. It's additive and idempotent (`ON CONFLICT (code) DO NOTHING`), and never updates or deletes.
- The admin funnel performs a read-only `SELECT id, stripeInterval, revenueCatActive, revenueCatInterval` for attributed userIds.
- New events are appended to the existing `data/campaign-events.json` file store, which is **not** in DB backups. The plan is to export GIFT events within 7 days of the test.
- One local test event (`GIFT00`, `cta_click`) was written to the **local** dev `data/campaign-events.json` during browser QA. Production is unaffected.

## 8. User / Business Impact

- **Recipients:** new page only. No change to any existing user's plan, price, or entitlement.
- **Pricing:** none changed. Lifetime stays $19.99 everywhere.
- **Getaway:** no logic change. The page only discloses existing terms.
- **Existing `/gift` buyers:** see one extra link at the top. The checkout is unchanged.
- **Lead endpoint:** any **external** caller (e.g. a GHL form posting to `/api/campaign/lead`) that doesn't send `emailConsent: true` will now get a 400. There is no in-repo caller; external usage is unknown.
- **Lifetime success page:** unchanged for everyone without a GIFT cookie.
- **Giveaway/sweepstakes:** deliberately not mentioned on the page (`GIVEAWAY_PAUSED` is set; compliance-sensitive).

## 9. Testing Performed

```
npm test          → Test Files 112 passed (112) · Tests 1878 passed (1878)
npx tsc --noEmit  → clean
npm run build     → ✓ Compiled successfully; /gift/20 prerendered static (○)
```
(The stderr stack traces in `npm test` output come from pre-existing tests that log on purpose, e.g. `syncRevenueCatRoute.test.ts` "G. FAIL CLOSED" and `revenuecatWebhook.test.ts` "11c4". None are in the new test file.)

**New: `__tests__/gift20Campaign.test.ts` (15 tests)**
- `/q`: card → `physical-card` + `/gift/20` + `utm_campaign=20dollar-gift`; placard → `placard`.
- track: valid `cta_click` stores **only** `{cta}` (an extra `email` key is dropped); unknown cta → 400; valid/invalid/missing `section_view`; existing `calc_complete` meta passes through unchanged.
- lead: no consent → 400, nothing logged, nothing sent; consent without SMS → phone dropped; SMS consent → phone + tags; no cookie → still tagged; `emailConsent: 'yes'` → 400.
- funnel: per-card counts, session-de-duped section reach, user-de-duped Lifetime buyers, placards ignored.
- copy: EN/ES shape parity; no 🔥, no "free vacation" except the required "not a free vacation" disclaimer, no `$19.95`, no win/winner wording.

**Fail-before evidence:** with the three `main` versions of `/q`, `track`, and `lead` swapped back in, 7 of the then-13 tests failed (the ones asserting the new behavior). The 6 that passed were invariants such as "placards unchanged" and "existing types pass through." Files were restored afterward. Tests added in `5ab4cd2` (no-cookie consent tags) cover new behavior only.

**Browser QA (local dev, `next dev`):** mobile 375px (Android UA → single Play button), desktop (both store buttons + web link, no sticky bar), no horizontal overflow (`scrollWidth === innerWidth`), ES render, `/gift` banner, chat widget absent, form blocks submit without email consent (no network call made), track attributed with `gc_src=GIFT00`, invalid cta → 400, no console errors. Signed-out Lifetime href is `/signup?next=%2Fupgrade%3Fauto%3Dlifetime`. **Not tested:** a real or Stripe-test-mode purchase end-to-end through `/gift/20`; iOS Safari on a device; a real QR scan against production.

## 10. Files Changed

`git diff --name-status main...5ab4cd2`:
```
A	__tests__/gift20Campaign.test.ts
M	app/admin/campaigns/page.tsx
M	app/api/admin/campaigns/route.ts
M	app/api/ai/chat/route.ts
M	app/api/campaign/lead/route.ts
M	app/api/campaign/track/route.ts
A	app/gift/20/Gift20Landing.tsx
A	app/gift/20/page.tsx
M	app/gift/page.tsx
M	app/help/page.tsx
M	app/q/[code]/route.ts
M	app/terms/page.tsx
M	app/upgrade/success/page.tsx
M	components/GHLChatWidget.tsx
A	components/Gift20ThankYou.tsx
A	components/admin/Gift20FunnelPanel.tsx
A	docs/GIFT20_CAMPAIGN_SPEC.md
M	lib/campaigns.ts
A	lib/gift20.ts
A	lib/gift20Funnel.ts
M	lib/translations.ts
A	public/marketing/gift20/result-card.jpg
A	scripts/gift20-placements.mjs
```

## 11. Known Risks / Remaining Questions

1. **Attribution is partial by construction.** App-store installs and **Google sign-ups** aren't attributed (§3). The dashboard says so; manual reconciliation against Don's handout log is required.
2. **The event store fails silently.** `readEvents()` returns `[]` on any read/parse error, so the admin funnel would show "no data" rather than an error. That's acceptable for analytics, not for entry data. Pre-existing.
3. **No rate limiting on track/lead** (pre-existing). There's junk-inflation risk at n=10.
4. **External lead-endpoint callers** may now 400 (§8).
5. **SMS consent wording** was written by Claude to standard CTIA/TCPA form. It **has not been checked** against the registered A2P campaign for (321) 513-1321.
6. **Native-shell guard is client-side** (`useIsNative`), so the first SSR paint inside the iOS shell would render the Stripe link before hydration. The page isn't linked from inside the app and the QR opens in the system browser, so I judged this low risk. Flagging it because CLAUDE.md is strict about Stripe in iOS.
7. **"Lifetime" isn't defined in `/terms`** (life of the service vs. the buyer's life). Open question for an attorney.
8. **Florida Sellers of Travel Act** (Fla. Stat. ch. 559 Pt. XI) may regulate offering "vacation certificates." Whether GasCap is covered or exempt is an **open legal question, not a conclusion.** Flagged for an attorney before scaling.
9. **Vacation fee amounts are not stated.** The page says fees "vary by destination; shown before you activate" because the repo has no per-destination amounts. Residency and passport eligibility are also unverified.
10. **Founder photo is pending.** The page checks for it at build time (`fs.existsSync` in a static page), so adding the photo requires a redeploy.
11. **Process note:** I caught two of my own bugs only while writing this packet (the section-view threshold, and consent not reaching GHL when there's no cookie). Both are fixed in `5ab4cd2`, which suggests other gaps of the same kind are worth hunting for.

## 12. Claude's Assessment

**READY WITH KNOWN CONCERNS.** The code is additive, tested, and leaves payment/entitlement/webhook paths untouched. The open items before handout are operational or legal: running the placement script, checking the A2P consent wording, confirming store prices, the photo, and the attorney questions. None of them is a code defect I know of.

## 13. Questions for ChatGPT

1. Does any copy in `lib/translations.ts` → `gift20` (EN or ES) imply the $20 is conditional, a coupon/rebate/credit, or that the vacation certificate is available without a Lifetime purchase? Quote the line if so.
2. Is requiring `emailConsent === true` on `/api/campaign/lead` the right fail-closed behavior, or should an unconsented submission be accepted but not forwarded to GHL? (The current choice rejects outright.)
3. Is the SMS consent sentence in `updatesSmsConsent` sufficient as written, given that the phone field is optional and the SMS checkbox only appears once a number is typed?
4. In `Gift20ThankYou`, is gating a **display-only** block on the client-readable `gc_src` cookie acceptable on the payment success page, given it never asserts or influences entitlement?
5. Does the `?gift20=1` admin branch leak anything beyond aggregates (check `buildGift20Funnel`'s output shape), and is a full read of the events file on each request acceptable at this scale?
6. Does `isGift20Code` + `/q` handling allow an attacker-chosen `gc_src` (e.g. a hand-set cookie `GIFT05`) to cause anything worse than inflated analytics?
7. Is the SSR-before-hydration native guard (§11.6) an acceptable risk, or should `/gift/20` hard-hide the Stripe link until `useIsNative` has resolved?
8. Any copy that overstates precision ("estimates," "approximately") or presents a Pro-only feature as free without the 30-day-trial qualifier?

## 14. Requested Review Scope

Highest scrutiny, in order:
1. **Consumer-trust copy:** `lib/translations.ts` `gift20` block (EN + ES), especially `choiceFootnote`, `founderParas`, `getawayTransition`, `lifetime*`, `getaway*`.
2. **`app/api/campaign/lead/route.ts`:** consent gating and what reaches GHL.
3. **`app/upgrade/success/page.tsx` + `components/Gift20ThankYou.tsx`:** confirm the change cannot alter success/entitlement behavior for anyone.
4. **`app/api/campaign/track/route.ts` + `app/q/[code]/route.ts`:** allowlist and backward compatibility for the live placard campaign.
5. **`scripts/gift20-placements.mjs`:** production-write safety (dry-run default, idempotency, `featured=false`).

Lower priority: page layout/styling, admin panel UI.

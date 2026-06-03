# GasCap™ — Travel "Grand Prize Getaway" as a Pro-Conversion Engine
> Goal: turn Don's travel-agent access (trips where winners pay only taxes) into the single
> biggest trial→paid lever — **without breaking brand coherence** (GasCap saves you at the pump).
> Status: PLAN. Gated on legal + offer vetting (Phase 0) before any code ships.

---

## 1. The framing that makes it coherent (non-negotiable)
A gas app giving away a cruise only works with the right narrative. We use **one** idea, everywhere:

> **"Save at the pump. Win the getaway."**
> *The money GasCap™ saves you on gas adds up. This month, we're sending one member on the trip
> those savings could buy — and the smarter you pump, the better your odds.*

This ties travel → pump savings directly. Reinforcements:
- **Earn entries through savings behavior** — entries come from *using the app to save* (running calcs, logging fill-ups, tracking your spend, keeping a streak). The path to "win a cruise" literally runs through using the gas app.
- **Optional drive-themed prize** — pair the resort/cruise with a **gas card for the drive** ("we'll even fuel the road trip there"). Maximum coherence.
- Tagline options: *"Your pump savings could send you on vacation." · "Pump smart. Travel free."*

## 2. The conversion lever (why it moves paid signups)
Keep the free entry path, but make **Pro dramatically improve your odds**:

| Tier | Grand-prize entry multiplier |
|---|---|
| Free / not signed in (AMOE) | 1× |
| Pro Trial | 2× |
| **Pro Monthly** | **5×** |
| **Pro Lifetime** | **10×** |

*"Pro members get 10× the entries into the Cruise Giveaway"* is a **far** stronger upgrade reason than "2× on a $25 gas card." For $9.99 lifetime, 10× better odds at a real vacation is an easy emotional yes. This is the engine. (Note: the current monthly prize is a **$25 Visa card** — a modest hook, which is exactly why a travel incentive is a meaningful step up.)

**Legal guardrail:** purchase can **never be required** to enter (must keep the free AMOE path at /amoe). Pro just earns *more* entries — that's allowed. Odds disclosure must reflect this.

## 3. Prize & cadence
- **Keep** the monthly **$25 Visa card** (on-brand, low-compliance, recurring).
- **Add** a **quarterly "Grand Prize Getaway"** (the travel prize) layered on top — a longer window builds anticipation and sustained engagement (people return to stack entries).
- Pick a prize with a **clean, real** fulfillment (see Phase 0). Drive-themed if possible (resort + gas card).

## 4. Phase 0 — PREREQUISITES (non-code, do first; these gate everything)
- [ ] **Vet the actual travel offer.** Exactly what does the winner receive? Real flights/hotel vs. a certificate with blackout dates / resort fees / timeshare-presentation strings? **If it's a strings-attached certificate, do NOT attach the GasCap brand.** Reputational risk > upside.
- [ ] **Determine ARV** (approximate retail value) — drives both taxes and registration.
- [ ] **Sweepstakes registration/bonding** for high ARV: **Florida & New York (>$5,000), Rhode Island (>$500).** Register + post surety bond *before* launch where required, or structure ARV/eligibility to stay under thresholds. (Not legal advice — get a quick sweepstakes-attorney review; it's cheap insurance.)
- [ ] **Official rules** drafted: sponsor (Gas Capacity LLC), eligibility, start/end, ARV, odds, **AMOE free-entry**, drawing date/method, **winner pays taxes + 1099 for >$600**, publicity release. Extend the existing /sweepstakes-rules page.
- [ ] **Winner tax disclosure** front-and-center in all copy ("winner responsible for taxes") so nobody feels misled.

## 5. Technical implementation (reuses the existing giveaway system)
GasCap already has: entries engine (activeDays + bonuses + multipliers), eligibility, **AMOE form (/amoe)**, sweepstakes-rules page, `GiveawayDraw` model, winner webhook, `GiveawayNudge`/`HeroEngagementPanel`, draw mechanics. The grand prize is a **special, longer draw with a bigger Pro multiplier** — mostly config + UI.

**Phase 1 — MVP (the lever, fastest path to test conversion):**
- `lib/grandPrize.ts` (new) — campaign config (`title`, `prizeName`, `arv`, `startDate`, `endDate`, `imageUrl`), tier-multiplier table, and `grandPrizeEntries(user)` = (entries earned in window) × tierMultiplier.
- `app/api/user/grand-prize/route.ts` (new) — returns `{ active, entries, tierMultiplier, daysLeft, prizeName }` for the banner/landing.
- **`GrandPrizeBanner`** (new) — hero strip: *"🏝️ Win a 5-day cruise · You have N entries · Pro = 10× → upgrade"*; for free/trial users the CTA points to /upgrade; self-hides when campaign inactive.
- **Upgrade page hook** — add a line/badge on the Pro cards: *"10× entries into the {Cruise} Giveaway"* (the conversion CTA, where it matters most).
- **Landing section** — a "Save at the pump, win the getaway" block on the marketing home for logged-out acquisition.
- Translations EN + ES.

**Phase 2 — Draw & fulfillment:**
- Extend `GiveawayDraw` (or a `GrandPrizeDraw`) for the campaign; admin "draw winner" action weighted by grand-prize entries.
- Winner flow: notify, collect info, hand off the travel cert, mark fulfilled; 1099 tracking.
- Admin dashboard: entries by tier, **conversion lift** (upgrades attributed to the campaign).

## 6. Marketing / launch
- **In-app:** GrandPrizeBanner (hero) + a one-time announcement; surface in the giveaway page.
- **Email:** launch + mid-campaign "X days left, here's your odds, Pro = 10×" + last-call.
- **Social:** the high-value prize is inherently shareable — lead the June/quarter calendar with it.
- **Referral tie-in:** referring a friend = bonus grand-prize entries (viral loop).
- Every surface routes free/trial users to **/upgrade** with the 10× hook.

## 7. Metrics (prove it converts)
- Primary: **trial→paid conversion rate during the campaign vs. baseline (~1%).**
- Upgrades with `source=grand_prize` (tag the checkout CTA).
- Secondary: signup lift, activation lift (entries are earned via calc/fill-up usage), DAU during the window.
- Decision gate: if the campaign lifts paid conversion materially, make it a **standing quarterly engine**.

## 8. Honest read
This is a **strong** lever *if and only if* Phase 0 checks out — the gate is **legal registration for the ARV** and the **quality of the travel offer**, not the code or the brand fit (the framing solves that). It's a **conversion/acquisition** play; it complements but does not replace the **activation** work (people still need to use the app). Run them in parallel.

## 9. Recommended sequence
1. **Phase 0** (you + a sweepstakes attorney): vet the offer, set ARV, register/bond, draft rules. ← do this first
2. **Phase 1 build** (me): config + banner + the 10× upgrade hook + landing + translations. Ship and start measuring conversion.
3. **Phase 2** (me): draw + fulfillment + admin/metrics, once a campaign is live and a winner is due.

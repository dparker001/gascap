# Card-Linked Fuel Cashback — Vendor Review: Upside vs. Kard

**Date:** June 16, 2026 · **Owner:** Don Parker · **Status:** Pre-outreach (decision pending)

Goal: add **"link your card → automatic cashback at the pump"** to GasCap as a revenue
stream + user-savings feature. Launch **web-first** (iOS just had an App Store rejection
over paid-content confusion; add to native only after approval + stability).

---

## Bottom line
Neither charges a license fee — both are **merchant-funded performance models**, and with
both you **never store a card** (they handle linking + PCI). This is a **control-vs-network**
decision, not a cost decision.

- **Kard** = white-label (native GasCap feel), **you control the rev-share/margin**, no
  coopetition, lowest App Store profile. *Unknown:* gas-station coverage density.
- **Upside** = **deepest gas network (their core)**, instant credibility — but their brand
  in your app, they control economics, and they run a competing consumer app.

**Recommendation:** Kard primary; Upside fallback **if** Kard's gas coverage in your users'
markets is thin. **Run both calls in parallel.** Optionally pilot the *concept* via Upside's
low-lift affiliate program first.

**Deciding question (ask on every call):** *How dense is your gas-station cashback coverage
in our users' metros?* For a gas app, network depth is make-or-break.

---

## Comparison matrix
| Dimension | Upside | Kard |
|---|---|---|
| Gas-merchant network | Nationwide — their core business | Broad CLO net (45M cardholders); gas density TBD — verify |
| Economic control | Upside sets economics; you get referral/affiliate share | **You control rev-share + your margin** |
| Branding in-app | Upside-powered (their brand present) | White-label — feels native to GasCap |
| App Store re-review risk | 3rd-party cashback brand in-app = more surface | Native, no 3rd-party brand → lower profile |
| Integration paths | Affiliate (fast pilot) → co-brand → full API | API-first (GET Offers / GET Eligible Offers) |
| Coopetition | Yes — large competing consumer app | No — pure infrastructure |
| Card handling / PCI | Upside handles linking | SOC 2 + PCI; requires no PII (email, user ID, zip) |
| Proof points | Uber, Lyft, GasBuddy, Current; partners see ~60% session lift, 40% retention | Powers 45M cardholders across fintechs |
| Contact | partnerships@upside.com · upside.com/partnerships | getkard.com/demo · getkard.com/contact · docs.getkard.com |

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Kard gas coverage too thin | Med | High | First question on the demo; get gas-brand list + coverage by metro before signing |
| Upside upsells your users to its own app | Med | Med | Tech-integration/affiliate terms; no-cross-promotion clause |
| Economic control ceded (Upside) | High (by design) | Med | Favors Kard if margin matters |
| App Store flags card-link on native | Med | High | Launch web-first; add to native only post-approval |
| Privacy/consent on transaction monitoring | High | Med | Use partner's CLO consent language; explicit opt-in + privacy-policy update |

## Negotiation points
- **Kard:** favorable issuer rev-share split; written gas coverage by metro; avoid minimum-volume
  floors (early-stage); payout mechanics + timing.
- **Upside:** push for tech-integration (not just affiliate); **no cross-promotion to the Upside
  consumer app**; clarify referral/licensing share + whether you can add a margin.
- **Both:** standard CLO consent + privacy language up front; sandbox/test env to build on web first.

## Next steps
1. Email both in parallel (drafts below).
2. On each call ask in order: (1) gas coverage, (2) economics/rev-share, (3) integration + sandbox, (4) consent/privacy package.
3. Decide → scope the **web-first** build (card-link consent flow + offers surface), App-Store-safe to add to native later.

---

## Outreach email — Kard
**To:** via getkard.com/demo (or /contact) · **From:** Don Parker, GasCap (admin@gascap.app)
**Subject:** GasCap × Kard — adding fuel cashback for our drivers

> Hi Kard team,
>
> I'm Don Parker, founder of GasCap (gascap.app) — a fuel-cost app that tells drivers exactly
> how much to pump and what it'll cost before they reach the station. We're on web plus new iOS
> and Android apps, with a growing base of engaged U.S. drivers (commuters, rideshare/delivery,
> road-trippers).
>
> We want to add automatic fuel cashback — "link your card, get cash back at the pump" — as a
> natively-branded feature, and Kard's API-first, white-label model looks like a strong fit.
>
> Two things would help me move fast:
> 1. **Gas coverage** — how dense is your gas-station cashback network across U.S. metros? Which
>    fuel brands are typically in-network? (This is the make-or-break for us as a gas app.)
> 2. **Economics** — how does the rev-share work for a partner like us, and how much control do we
>    have over the split between user cashback and our margin?
>
> If there's a sandbox and your standard CLO consent/privacy language, I'd love those too so we can
> prototype on web. Could we set up a 30-minute call this week or next?
>
> Thanks,
> Don Parker · GasCap · gascap.app · admin@gascap.app

## Outreach email — Upside
**To:** partnerships@upside.com · **From:** Don Parker, GasCap (admin@gascap.app)
**Subject:** GasCap × Upside — embedding gas cashback for our drivers

> Hi Upside Partnerships team,
>
> I'm Don Parker, founder of GasCap (gascap.app) — a fuel-cost app that tells drivers exactly how
> much to pump and what it'll cost before they reach the station. We're on web plus new iOS and
> Android apps, with a growing base of engaged U.S. drivers.
>
> Gas cashback is core to what Upside does, and I'd like to explore embedding Upside-powered fuel
> offers into GasCap so our drivers earn cash back automatically at the pump.
>
> A few questions to get going:
> 1. **Integration model** — for an app like ours, would you recommend the affiliate program to
>    start, or a tech/API integration? What does each path involve?
> 2. **Economics** — how does the partner/referral share work, and can we layer our own value on top?
> 3. **User experience** — can the experience stay inside GasCap (we'd want to keep drivers in our
>    app rather than route them to the Upside app)?
>
> Your gas network is the strongest out there, so coverage isn't my worry — I mostly want to
> understand the partnership model and economics. Could we grab 30 minutes this week or next?
>
> Thanks,
> Don Parker · GasCap · gascap.app · admin@gascap.app

---

**Sources:** Upside Partnerships (upside.com/partnerships), Upside Tech Integration
(upside.com/partnerships/tech-integration), Upside business model
(businessmodelanalyst.com/upside-business-model), Kard for Fintechs & Issuers
(getkard.com/issuers), Kard CLOs explained (getkard.com/blog/clos-the-what-and-why),
Cardlytics vs. Kard (getkard.com/blog/cardlytics-vs-kard-comparing-card-linked-offer-platforms-in-2026).

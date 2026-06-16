# vNetCard™ × GasCap™ — Insider Cross-Promo Campaign

**Goal:** turn paying vNetCard™ customers into GasCap advocates (self-funding referral loop).
**Audience:** active monthly-paying vNetCard subscribers in GHL location `8oiEKtKPU1gvhSH5JF9p`.
**Send via:** GHL (their warm CRM) — NOT GasCap's Resend.

## The offer
- Get **GasCap Pro for LIFE** — one-time **$19.99** (normally a recurring plan).
- **+ a complimentary resort getaway certificate** (standing Lifetime perk).
- **Refer friends who download GasCap** (verified free sign-ups):
  - **5 sign-ups → 1 free month of vNetCard** (~$19–24 value)
  - **10 sign-ups → 2 free months**
- Must use their **vNetCard email** for GasCap so we can match + credit.

---

## EMAIL (paste into GHL; merge tag = {{contact.first_name}})

**Subject line options:**
1. `A vNetCard member perk: GasCap Pro for life + a free getaway 🎁`
2. `vNetCard × GasCap — free fuel app for life, and earn free vNetCard months`
3. `Exclusive partner offer for vNetCard members only`

**Preheader:** `We partnered with GasCap.app. Pro for life + a resort getaway — and refer friends to earn free months of vNetCard.`

**Body:**

Hi {{contact.first_name}},

Quick bit of good news for you as a vNetCard™ member: **vNetCard™ has officially partnered with [GasCap.app](https://www.gascap.app)** — and we lined up an exclusive offer just for our paying members.

**First, what is GasCap?**
GasCap is a free app that tells drivers exactly **how much gas they need and what it'll cost — before they pull up to the pump.** You enter your tank size and current fuel level, and GasCap instantly shows the gallons you'll add and the total cost using real local gas prices. It also includes:
- **Live local gas prices** so your estimate matches the pump
- **Rental Car mode** — return it at the right level and skip the pricey refuel fee
- **MPG & fill-up tracking** to see your real fuel costs over time
- **A monthly gas-card giveaway** for members
- Works on any phone or browser — no signal needed to calculate

**Your exclusive vNetCard member offer:**
🚀 **Get GasCap Pro for LIFE — a one-time $19.99** (no subscription, ever). Pro unlocks fill-up history, MPG tracking, unlimited vehicles, the AI Fuel Advisor, and more.
🏝️ **Plus a complimentary resort getaway certificate** — a free hotel stay, on us, just for going Lifetime.
🎁 **Then earn free months of vNetCard:** share GasCap with friends, and when **5 of them sign up, you get a free month of vNetCard.** Get **10 sign-ups and that's 2 free months.**

**How to claim it — 3 steps:**
1. **Get GasCap Pro Lifetime + your getaway** → [**Get Lifetime + Getaway — $19.99**](https://www.gascap.app/upgrade?utm_source=vnetcard&utm_medium=email&utm_campaign=insider). **Use this same email address** so we can credit your free vNetCard months.
2. Inside GasCap, open **Refer & Earn** and grab your personal referral link.
3. **Share it.** When 5 friends sign up for GasCap, we credit **1 free month of vNetCard**; at 10, that's **2 free months.**

[**Get GasCap Pro Lifetime + Getaway →**](https://www.gascap.app/upgrade?utm_source=vnetcard&utm_medium=email&utm_campaign=insider)

Thanks for being a vNetCard™ member — we think you'll love what GasCap does for your wallet at the pump.

— The vNetCard™ + GasCap™ Team

---
*Getaway details: your certificate is a complimentary hotel stay (flights not included; you prepay the destination's nightly taxes & fees, which vary). Must be 21+, live 100+ miles from your destination, book 30+ days ahead. Certificate arrives by email within 24 hours of purchase. Full terms at RedeemVacations.com.*

*Free-month details: referrals must be verified GasCap sign-ups (a confirmed email). Use the same email on GasCap as your vNetCard account so we can match you. Free vNetCard month(s) are credited to your subscription within a few days of reaching 5 (and 10). One reward set per member.*

---

## SMS TEASER (to vNetCard contacts who opted into marketing SMS)

> vNetCard™ here 👋 Exclusive partner offer just for our members — check your email for GasCap Pro **for life** + a free resort getaway, and a way to earn free months of vNetCard. 📩 Reply STOP to opt out.

(No GasCap links/content in the SMS — keeps it clean for carrier filtering; the offer lives in the email.)

---

## Tracking + fulfillment SOP

1. **Build the audience** in GHL location `8oiEKtKPU1gvhSH5JF9p`: a smart list of *active, paying monthly* vNetCard subscribers. Send the email campaign; send the SMS teaser only to those opted into marketing SMS.
2. **Attribution:** link carries `utm_source=vnetcard&utm_campaign=insider`. Ask them to sign up for GasCap with their vNetCard email (the matching key).
3. **Count referrals:** in the GasCap admin panel, look up the member by email → `referredUsers` shows everyone who signed up with their code (with join dates). Count **verified** sign-ups (confirmed email) toward the 5 / 10 thresholds.
   - *Optional improvement:* add a "verified referrals" count to the admin row so this is one glance instead of manual. (Easy to add — ask Claude.)
4. **Fulfill the free month(s) via Stripe** (Stripe runs vNetCard subscriptions):
   - Create two coupons once: `VNET-1MO-FREE` (100% off, duration: once) and `VNET-2MO-FREE` (100% off, duration: repeating, 2 months).
   - When a member hits **5** verified sign-ups → apply `VNET-1MO-FREE` to their vNetCard subscription. At **10** → apply `VNET-2MO-FREE` (or the 1-mo coupon a second time).
5. **Getaway fulfillment** is already automated-ish ("Option B"): each Lifetime purchase fires an admin notification to issue the Marketing Boost certificate to the buyer's email.
6. **Cadence:** review qualifiers weekly; credit and notify the member ("🎉 Your free vNetCard month is applied").

## Notes / decisions
- Email is the primary channel (deliverability + richer); SMS is a teaser only (A2P-safe).
- Net cost per redeemer ≈ $0 (the $19.99 Lifetime offsets the free vNetCard month) → near-zero CAC for 5–10 new GasCap users + a converted Lifetime customer + an advocate.
- Launch now (warm owned audience, web-based). When the apps are approved, swap the share CTA to "download GasCap on the App Store / Google Play" for an even easier referral ask.

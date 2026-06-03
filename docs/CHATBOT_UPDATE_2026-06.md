# GasCap™ Chatbot — Content Update (June 2026)
> Purpose: ready-to-paste Q&A blocks for the GHL Conversation AI knowledge base.
> The main file `CHATBOT_TRAINING.md` was already updated for the $2.99/$19.99
> pricing, Pro Lifetime, and unlimited vehicles. This file adds: (1) Refund Policy,
> (2) Early-Upgrade Bonus, (3) Spanish/Language, (4) GIFTING (NEW — Section D),
> (5) GETAWAY PROMO (NEW — Section E, GATED — add only when the promo is live).
> Source of truth: app/help, app/terms, app/upgrade, app/gift, app/getaway, lib/getawayPromo.ts.

---

## 🆕 NEW SECTION D — GIFTING (paste into SECTION 8 — Plans & Billing)
> Gifting Pro Lifetime is LIVE as of June 2026.

**Q: Can I give GasCap™ Pro as a gift?**
A: Yes! Go to **gascap.app/gift** to give **Pro Lifetime** ($19.99, one-time) as a gift — great for Father's Day, birthdays, or the holidays. You don't need an account to buy a gift. You can either email the gift code directly to the recipient, or get the code yourself to hand over or print, and you can add a personal note. The recipient redeems it on their own account and gets Pro forever — no subscription.

**Q: How does the recipient claim their gift?**
A: They open the claim link in the gift email (or go to **gascap.app/redeem** and enter the code). They sign in — or create a free account if new (name and email are pre-filled from the gift) — then tap "Claim My Pro Lifetime." Lifetime activates instantly.

**Q: Is the gift a subscription?**
A: No — a gifted Pro Lifetime is a one-time purchase. The recipient owns Pro forever with no recurring charges.

**Q: What if the recipient already has Pro Lifetime?**
A: The gift code stays unused so they can pass it along to someone else. It's only consumed when claimed by an account that isn't already Lifetime.

**Q: Can I buy gifts for several people?**
A: Each gift purchase is one Pro Lifetime. To gift multiple people, complete a separate gift purchase for each, or email support@gascap.app and we'll help arrange it.

**Q: Are gifts refundable?**
A: Like the regular Pro Lifetime plan, gift purchases are one-time and non-refundable. If something went wrong with a purchase, email support@gascap.app within a reasonable time and we'll help.

---

## 🆕 NEW SECTION E — GETAWAY PROMO (paste into SECTION 8 — Plans & Billing)
> ⚠️ GATED: add this to the live bot ONLY when the Lifetime + getaway promo is turned
> ON (GETAWAY_ACTIVE in lib/getawayPromo.ts). Until then, the bot must NOT mention it.
> ⚠️ CRITICAL FRAMING: the getaway is a FREE BONUS for buying Pro Lifetime. NEVER say a
> customer is "buying a vacation" or present the vacation's $ value as the offer — Pro
> Lifetime is the product; the getaway is an extra thank-you on top.

**Q: Do I get a free vacation with Pro Lifetime?**
A: During our limited-time promotion, yes — anyone who buys **Pro Lifetime** ($19.99, one-time) gets a complimentary resort getaway as a free thank-you bonus. Pro Lifetime is what you're purchasing; the getaway is an extra on top. Right after you upgrade you'll choose your destination (Las Vegas, Denver, Miami, San Antonio, Orlando, or Nashville), and your certificate is emailed within 24 hours. You can also choose later at **gascap.app/getaway**.

**Q: How do I pick or claim my getaway destination?**
A: After your Lifetime purchase, go to the success page or **gascap.app/getaway**, pick one of the six destinations, and confirm. We'll email your certificate within 24 hours — it comes from our travel partner, Marketing Boost / RedeemVacations, so check your spam folder too.

**Q: What does the getaway cost me?**
A: The hotel room rate (valued up to $350/night) is free. You cover only the destination's nightly taxes and fees — they vary by destination and are shown before you choose — plus your own airfare, food, and any resort fees the hotel charges. There's no timeshare presentation. Activation fees are non-refundable.

**Q: What are the getaway rules / eligibility?**
A: Activate the certificate within 7 days, travel any time within 18 months, and book at least 30 days ahead (major holidays excluded). It's for up to 2 adults (at least one age 21+), with up to 2 children under 12 allowed at some hotels. No group travel — one stay per household. You must live at least 100 miles from your chosen destination and present a government-issued ID and a major credit/debit card at check-in. Full terms come with the certificate at RedeemVacations.com.

**Q: Am I paying $19.99 for the vacation?**
A: No — you're purchasing the GasCap™ Pro Lifetime license (all Pro features, forever). The getaway is a free promotional bonus we add as a thank-you during the promo; it isn't the product, and it has no separate cost or cash value.

**Q: Is the getaway refundable, or does it change the Lifetime refund policy?**
A: Pro Lifetime remains a one-time, non-refundable purchase whether or not you claim the getaway. The certificate has no cash value, and once you pay the activation taxes/fees to the travel partner those are non-refundable (per their terms).

---

## ✅ HOW TO USE THIS FILE (for the VA)

1. **Add the 3 NEW Q&A sections below** to the GHL Conversation AI knowledge base
   (or paste them into `CHATBOT_TRAINING.md` at the indicated insertion points).
2. **Apply the 2 EDITS** to existing answers (cancellation + giveaway) so they
   reference the refund window and early-upgrade bonus.
3. Bump the "Last updated" date at the top of `CHATBOT_TRAINING.md` to today.
4. Re-train / re-sync the GHL Conversation AI bot after pasting.

---

## 🆕 NEW SECTION A — REFUND POLICY
> Insert into `CHATBOT_TRAINING.md` inside **SECTION 8 — PLANS & BILLING**,
> right after the "How do I cancel?" Q&A.

**Q: What is your refund policy?**
A: It depends on your plan:
• **Pro Monthly ($2.99/mo)** — 30-day money-back guarantee. If GasCap™ Pro doesn't help you save more than $2.99 in your first 30 days, email support@gascap.app within 30 days of your first charge and we'll refund your first payment in full — no questions asked.
• **Pro Lifetime ($19.99 one-time)** — This is a one-time, non-refundable purchase. All Lifetime sales are final, except where required by law. Because it's a permanent license at a one-time price, we're not able to refund it after purchase.

**Q: Can I get a refund on my monthly Pro subscription?**
A: Yes. We offer a 30-day money-back guarantee on Pro Monthly. If Pro doesn't save you more than the $2.99 you paid in your first month, email support@gascap.app within 30 days of your first charge and we'll refund your first payment — no questions asked. After the first 30 days, you can still cancel anytime to stop future billing, and your access continues until the end of the current billing period.

**Q: Is the Pro Lifetime plan refundable?**
A: No — Pro Lifetime ($19.99) is a one-time, non-refundable purchase. You're buying a permanent license to GasCap™ Pro at a one-time price, so all Lifetime sales are final (except where required by applicable law). If you're not sure whether Lifetime is right for you, the best path is to use your 30-day free Pro trial first, or start with Pro Monthly — then upgrade to Lifetime once you know you love it.

**Q: I was charged by mistake — what do I do?**
A: No problem — email support@gascap.app with the email address on your account and we'll look into it right away. We'll get back to you within 1 business day.

---

## 🆕 NEW SECTION B — EARLY-UPGRADE BONUS
> Insert into `CHATBOT_TRAINING.md` inside **SECTION 9 — MONTHLY GAS CARD
> GIVEAWAY**, after the "How do Pro and Fleet members earn entries?" Q&A.

**Q: Is there a reward for upgrading while I'm still on my free trial?**
A: Yes! If you upgrade to a paid Pro plan (monthly or Lifetime) during your 30-day free trial, you lock in a permanent bonus of **+10 extra gas card giveaway entries every month, forever** — on top of your normal daily entries. It's our way of thanking early upgraders. The bonus stays on your account for as long as you're a Pro member.

**Q: What is the early-upgrade bonus?**
A: The early-upgrade bonus is +10 bonus monthly giveaway draw entries, added to your account permanently when you upgrade to paid Pro during your free trial window. These 10 entries are added on top of the entries you earn from daily logins/usage and any streak bonuses. Upgrade before your trial ends at gascap.app/upgrade to claim it.

---

## 🆕 NEW SECTION C — LANGUAGE & SPANISH SUPPORT
> Insert into `CHATBOT_TRAINING.md` inside **SECTION 2 — GETTING STARTED**
> (or SECTION 12 — ACCOUNT & PRIVACY), wherever language fits best.

**Q: Is GasCap™ available in Spanish?**
A: Yes — GasCap™ is fully available in Spanish (Español). The home/landing page, the calculators, the header and garage, the streak counter, sign-in and sign-up, the referral flow, the fill-up logger, and the entire pricing and upgrade flow are all translated. Use the language switcher to change between English and Spanish — your choice is saved automatically.

**Q: How do I switch GasCap™ to Spanish?**
A: Tap the language switcher (EN / ES) in the app and select Español. The interface updates instantly and remembers your preference for next time. ¡Así de fácil!

**Q: ¿GasCap™ está disponible en español?**
A: ¡Sí! GasCap™ está completamente disponible en español. La página principal, las calculadoras, el registro e inicio de sesión, el programa de referidos y todo el flujo de precios y mejora de plan están traducidos. Usa el selector de idioma (EN / ES) para cambiar — tu preferencia se guarda automáticamente. Para soporte, escríbenos a support@gascap.app.

**Q: What languages does GasCap™ support?**
A: GasCap™ currently supports English and Spanish. A few legal/reference pages (Terms, Privacy, Help, and the sweepstakes rules) are available in English only. More languages may be added in the future based on demand.

---

## ✏️ EDIT 1 — Cancellation answer (SECTION 8)
> Find the existing "How do I cancel my Pro subscription?" answer and APPEND the
> refund line so cancellation and refunds are connected.

**REPLACE the cancellation answer with:**
A: Go to Settings → Plan → "Manage Billing & Subscription." This opens the Stripe self-serve portal where you can cancel or update your payment method. You can also email support@gascap.app and we'll handle it for you. Access continues until the end of your current billing period. **If you're within 30 days of your first Pro Monthly charge, you may also qualify for a full refund of that first payment — just email support@gascap.app.** Lifetime members are not affected by cancellation — there is no subscription to cancel (and Lifetime is non-refundable).

---

## ✏️ EDIT 2 — Giveaway entries answer (SECTION 9)
> Find "How do Pro and Fleet members earn entries?" and add the bonus line at the end
> of the entry-sources list.

**APPEND this line to the entries explanation:**
"Plus: if you upgraded to paid Pro during your free trial, you also get a permanent +10 bonus entries every month on top of everything above."

---

## 📌 REFERENCE — Current pricing & plan facts (for accuracy)
Use these exact facts when answering. Do NOT quote old pricing.

| Item | Current value |
|---|---|
| Free plan | $0 — core calculators, 1 saved vehicle |
| Pro Monthly | **$2.99/mo** (was $4.99 — never quote $4.99) |
| Pro Lifetime | **$19.99 one-time** (replaces the old $49 annual plan) |
| Annual plan | ❌ Removed — does not exist anymore |
| Fleet plan | ⏸️ Shelved / "coming soon" — Pro now has unlimited vehicles |
| Free trial | 30 days of Pro, automatic on signup, no credit card |
| Pro vehicles | **Unlimited** (was "up to 3" — never quote 3) |
| Lifetime exclusives | 2× monthly giveaway entries · Streak Shield (1 grace day/mo) · Lifetime Member badge |
| Monthly refund | 30-day money-back guarantee |
| Lifetime refund | Non-refundable / final sale |
| Early-upgrade bonus | +10 monthly giveaway entries forever (upgrade during trial) |
| Languages | English + Spanish |
| Upgrade URL | gascap.app/upgrade |
| Support | support@gascap.app (1 business day) |

# GasCap™ — Referral Program Rules

> Last updated: 2026-05-02  
> This document is the source of truth for referral business logic.  
> Update it any time the rules change, alongside the code change.

---

## How It Works (User-Facing Summary)

Every GasCap™ user gets a unique referral link: `gascap.app/signup?ref=YOURCODE`

Share your link. When a friend signs up **and makes their first payment**, you earn **1 free month of GasCap™ Pro** credited to your account.

---

## Credit Rules

| Rule | Value |
|---|---|
| Credits earned per paying referral | 1 |
| Dollar value per credit | $4.99 (1 month of Pro) |
| Maximum credits earned lifetime | 10 |
| Maximum credits redeemable at once | 3 |
| Credit expiry | 6 months from earned date |
| Eligible plans for redemption | Pro and Fleet only |

---

## When a Credit Is Awarded

Credits are awarded **only when the referred user makes their first real Stripe payment** (`invoice.payment_succeeded` with `amount_paid > 0`).

This means:
- ✅ Referred user signs up → trial ends → first invoice paid → **credit awarded**
- ✅ Referred user skips trial → pays immediately → **credit awarded**
- ❌ Referred user signs up free → never upgrades → **no credit**
- ❌ Referred user starts trial → cancels before first payment → **no credit**
- ❌ Same user self-refers (same account ID) → **blocked**
- ❌ Referred user already credited → subscribes again → **no second credit** (one credit per referred user, ever)

---

## Ambassador Tier Sustainability Rule

Reaching the **Ambassador tier (15+ cumulative paying referrals)** or **Elite Ambassador tier (30+)** grants a complimentary GasCap™ Pro subscription. This perk has an **active retention condition**:

| Condition | Effect |
|---|---|
| Active paying referrals ≥ 5 | Complimentary Pro subscription remains active |
| Active paying referrals < 5 | Complimentary Pro subscription is **paused** |
| Active paying referrals recovers to ≥ 5 | Complimentary Pro subscription is **reinstated** |

**Key distinctions:**

- **Tier status is permanent and cumulative.** Once a user crosses the 15 (or 30) paying-referral threshold, they remain an Ambassador (or Elite) forever. Cancellations by referred users do not demote the tier.
- **Drawing entry multipliers follow tier status**, not active referral count. An Ambassador sitting below 5 active referrals still gets 3 daily drawing entries.
- **Only the free Pro perk has the active condition.** The 5+ active paying referral floor must be maintained to keep the complimentary subscription live.

**Rationale:** This rule aligns Ambassador incentives with retention. Without it, someone could convert 15 users in a single month, let them all churn, and hold free Pro indefinitely — rewarding acquisition without retention. The 5-active floor ensures Ambassadors remain engaged advocates.

**Enforcement (future implementation):** A periodic job (recommended: daily cron or triggered on Stripe `customer.subscription.deleted` events) should:
1. Count each Ambassador/Elite user's currently active paying referrals (Stripe subscriptions with status `active` or `trialing`, tied to users who set `referredBy = this ambassador's code`).
2. If count < 5 and Pro subscription is active → pause the complimentary Pro.
3. If count ≥ 5 and Pro subscription is paused → reinstate the complimentary Pro.
4. Notify the Ambassador by email on pause and reinstatement.

This enforcement logic is **not yet implemented in code** as of 2026-05-02 — this section documents it as binding policy for future development.

---

## Where the Credit Logic Lives

| Step | File | Function |
|---|---|---|
| Store referral code on new user | `app/api/auth/register/route.ts` | Calls `setReferredBy()` if code is valid |
| Award credit on first payment | `app/api/stripe/webhook/route.ts` | `invoice.payment_succeeded` handler |
| Credit the referrer | `lib/users.ts` | `creditVerifiedReferral(userId)` |
| Record the credit | `lib/users.ts` | `recordReferral(referrerId)` |
| Get active (unredeemed, unexpired) credits | `lib/users.ts` | `getActiveCredits(user)` |
| Get redeemable month count (capped at 3) | `lib/users.ts` | `getRedeemableMonths(user)` |
| Redeem credits | `lib/users.ts` | `redeemReferralCredits(userId)` |
| Notify referrer by email | `lib/emailCampaign.ts` | `sendReferralCreditEmail()` |

---

## Fraud Protections

| Attack | Defense |
|---|---|
| Self-referral (same account) | `creditVerifiedReferral` checks `referrer.id === userId` |
| Double-credit on same referred user | `referralRewardCredited` flag — set permanently after first credit |
| Race condition (duplicate webhook) | Atomic `updateMany WHERE referralRewardCredited=false` — only one writer wins |
| Trial cancellers earning credits | `amount_paid > 0` check — $0 trial invoices are skipped |
| Unlimited credit farming | `MAX_REFERRAL_REWARDS = 10` hard lifetime cap |
| Credits hoarded indefinitely | `CREDIT_EXPIRY_MONTHS = 6` — expire after 6 months |
| Changing referral code after signup | `setReferredBy` only callable from the register route; no user-facing API |
| Fake referral codes | Code must exist in DB — `findByReferralCode` validates |
| Two-email self-referral | Economically neutral — costs $4.99 to earn $4.99; not worth addressing |

### Ambassador Active-Referral Floor Enforcement
Ambassadors and Elite Ambassadors must maintain 5+ currently active paying referrals to keep the complimentary Pro subscription. When a referred user's subscription cancels or lapses, the system should re-evaluate the Ambassador's active count. If the count drops below 5, the complimentary Pro is paused; it is reinstated automatically when the count recovers. Admin can review borderline cases manually. See the "Ambassador Tier Sustainability Rule" section above for full policy details and the enforcement implementation spec.

### Chargeback Policy
When a `charge.dispute.created` event fires, admin is notified immediately with dispute amount, reason, and a flag if a referral credit was previously awarded. Credits are **not auto-revoked** — disputes can be won, and auto-revoking would penalize legitimate referrers. Admin reviews and manually revokes if the dispute is confirmed fraudulent.

---

## Constants (lib/users.ts)

```typescript
const MAX_REFERRAL_REWARDS = 10;   // lifetime cap on credits earned
const MAX_REDEEM_AT_ONCE   = 3;    // max credits redeemable per billing cycle
const CREDIT_EXPIRY_MONTHS = 6;    // credits expire this many months after earning
```

---

## Data Model (Prisma User)

```typescript
referralCode             String?   // unique code, auto-generated on first request
referredBy               String?   // the code used at signup (referrer's code)
referralCount            Int       // total paying referrals earned (capped at 10)
referralRewardCredited   Boolean   // true once this user has triggered a credit for their referrer
referralCredits          Json      // ReferralCredit[] — { id, earnedAt, expiresAt, redeemedAt? }
referralProMonthsEarned  Int       // lifetime count of months earned (for display)
```

```typescript
interface ReferralCredit {
  id:          string;   // UUID
  earnedAt:    string;   // ISO date
  expiresAt:   string;   // ISO date (earnedAt + 6 months)
  redeemedAt?: string;   // ISO date — set when redeemed; undefined = unredeemed
}
```

A credit is **active** if `!redeemedAt && new Date(expiresAt) > now`.

---

## GHL Integration

When a referred user's credit is awarded, the referrer receives an email from `sendReferralCreditEmail()`. There is currently no separate GHL workflow for referral credits — the transactional email handles notification directly.

If a GHL drip sequence for referral milestones is desired in future (e.g., "You're 2 referrals away from a free month!"), it should be triggered from `recordReferral()` in `lib/users.ts`.

---

## Changing These Rules

If you change any referral business logic:
1. Update the constants in `lib/users.ts`
2. Update this document
3. Update the user-facing copy in:
   - `app/settings/page.tsx` (referral section)
   - `lib/emailCampaign.ts` (`referralCreditEmailHtml`)
   - `components/ReferralCard.tsx`
   - `app/terms/page.tsx` (Section 5 — Ambassador Program & Referral Rewards)
4. Update `CHANGELOG.md`

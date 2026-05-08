# GasCap™ Business Due Diligence Checklist

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> Status as of May 2026.

**Status Legend:** ✅ Complete | ⚠️ Needs Work | ❌ Not Started | TODO Verified gap

---

## Legal Entity and Ownership

| Item | Status | Notes |
|---|---|---|
| Legal entity formed | ✅ | Gas Capacity LLC — Florida LLC, filed April 2026 |
| EIN obtained | ✅ | EIN: 42-2058323 |
| Registered agent in place | ✅ | Registered Agents Inc., 7901 4th St N STE 300, St. Petersburg FL 33702 |
| Principal place of business documented | ✅ | 16260 Bristol Lake Circle, Orlando, FL 32828 (Orange County) |
| Governing law | ✅ | State of Florida, Orange County |
| Operating agreement / articles of organization | ⚠️ | TODO: confirm operating agreement is signed and filed |
| Single-member LLC (no other owners) | ✅ | Don Parker, sole member |
| No outstanding capital table disputes | ✅ | Sole founder |
| No outside investors with board rights or pro-rata | ✅ | Bootstrapped |

---

## Intellectual Property

| Item | Status | Notes |
|---|---|---|
| "GasCap™" trademark — filed or in use | ⚠️ | ™ symbol is in use (unregistered mark). No USPTO filing confirmed. TODO: file intent-to-use application for "GasCap" in IC 009 (software) and IC 042 (SaaS). |
| Domain registration: gascap.app | ✅ | Live at www.gascap.app |
| Domain registration: gascap.com | ⚠️ | TODO: confirm ownership status of gascap.com |
| App name "GasCap" — not conflicting with prior marks | ⚠️ | TODO: USPTO trademark search to confirm no blocking registrations |
| Source code is original work | ✅ | Founder-built |
| No open-source license conflicts | ⚠️ | TODO: run license audit on dependencies |
| No patent encumbrances | ✅ | No patents filed; no known blocking patents |
| Social media handles secured | ⚠️ | TODO: document and verify all platform handles |

---

## Revenue and Financial Records

| Item | Status | Notes |
|---|---|---|
| Stripe account in good standing | ✅ | Active |
| Stripe revenue records accessible | ✅ | Stripe Dashboard |
| MRR documented (current) | TODO | Pull from Stripe Dashboard — never fabricate. Do not put current MRR in this document. |
| ARR documented (current) | TODO | Derived from Stripe Dashboard |
| Revenue by plan tier | TODO | Stripe provides plan-level breakdown |
| Payment failure rate | TODO | Stripe Dashboard metric |
| Refund rate | TODO | Stripe Dashboard metric |
| Deferred revenue (annual subscribers) | TODO | Annual subscribers represent prepaid revenue |
| Tax treatment documented | ✅ | Single-member LLC, disregarded entity (Schedule C) |

---

## Subscription and Customer Records

| Item | Status | Notes |
|---|---|---|
| Subscriber list is maintained | ✅ | PostgreSQL User model + Stripe |
| Subscriber count (current) | TODO | Pull from admin dashboard — do not fabricate |
| Trial user count (current) | TODO | Admin dashboard query |
| Churn rate (monthly) | TODO | Stripe metric + internal calculation |
| Net Revenue Retention | TODO | Calculated from Stripe data |
| Customer lifetime value (LTV) | TODO | Derived from churn rate and ARPU |
| Customer acquisition cost (CAC) | TODO | Needs marketing spend tracking |
| Pro trial → paid conversion rate | TODO | Being measured — decision gate May 26–31 |

---

## Marketing and Growth

| Item | Status | Notes |
|---|---|---|
| Primary marketing channel(s) identified | ✅ | QR partner placements, social media (Facebook/Instagram/LinkedIn), referral program |
| Social media presence: Facebook GasCap page | ✅ | Active |
| Social media presence: Instagram gascap.app | ✅ | Active |
| Social media presence: LinkedIn GasCap™ page | ✅ | Active |
| Social media content calendar | ✅ | Scheduled posts documented in MEMORY.md |
| Meta ad account linked | ✅ | act=10202685008751063 |
| Google Analytics configured | ✅ | GA4 with named events |
| Meta Pixel configured | ✅ | Pixel ID: 948950298128395 |
| Email marketing active | ✅ | Resend — drip + engagement sequences |
| Referral program documented | ✅ | `docs/REFERRAL_RULES.md` |
| Field Ambassador Program documented | ✅ | `docs/FIELD_AMBASSADOR_PROGRAM.md` |

---

## Partner Program

| Item | Status | Notes |
|---|---|---|
| Partner pilot is active | ✅ | QR placard system deployed |
| Active partner station count | TODO | Query `app/admin/campaigns` dashboard |
| Partner agreements / contracts | ❌ | No formal partner agreements in place — verbal/informal arrangements |
| Partner reporting capability | ✅ | Admin dashboard shows per-placement metrics |
| Case studies from partners | ❌ | None written yet |
| Partner milestone tier data | TODO | Query campaign analytics |

---

## Legal Compliance

| Item | Status | Notes |
|---|---|---|
| Terms of Service | ✅ | Live at gascap.app/terms |
| Privacy Policy | ✅ | Live at gascap.app/privacy |
| Cookie Policy | ❌ | Not separately documented; not implemented in-app |
| Sweepstakes Rules | ✅ | Live at gascap.app/sweepstakes-rules (for monthly giveaway) |
| Free Alternative Method of Entry (AMOE) | ✅ | gascap.app/amoe |
| Refund Policy | ⚠️ | Not explicitly documented on the website; Stripe portal allows cancellation. TODO: add clear refund policy language to ToS or help page. |
| Support process documented | ⚠️ | Email: support@gascap.app; GHL chat widget; contact form. No SLA documented. |
| A2P SMS compliance | ⚠️ | In progress — submission pending May 2026 |
| CAN-SPAM compliance | ✅ | Unsubscribe in every email |
| GDPR compliance (EU users) | ❌ | No cookie consent; no DPA template; no data export |
| CCPA compliance (California) | ⚠️ | Opt-out implemented; data export not implemented |

---

## Testimonials and Social Proof

| Item | Status | Notes |
|---|---|---|
| User reviews collected | ✅ | `lib/reviews.ts`, `components/ReviewWidget.tsx`, `app/admin/reviews/page.tsx` |
| Testimonials displayed on site | ✅ | ReviewsMarquee component on landing page |
| Formal case studies | ❌ | None written |
| Press coverage | ❌ | None confirmed |
| App store ratings | N/A | No app store listing (web-only PWA) |

---

## Operational Readiness

| Item | Status | Notes |
|---|---|---|
| Customer support process | ⚠️ | Email + GHL chat widget + contact form. Response time not SLA'd. |
| Admin dashboard for user management | ✅ | `app/admin/` — users, analytics, campaigns, sweepstakes, reviews |
| Email log for support reference | ✅ | Admin can view all sent emails |
| Founder dependency risk | ⚠️ | Sole founder. No team. All operations dependent on Don Parker. |
| Runbook for cron jobs | ⚠️ | MEMORY.md documents the crons; no formal runbook |
| Incident response process | ❌ | Not documented |
| Business continuity plan | ❌ | Not documented |

---

## Growth Metrics Documentation

| Item | Status | Notes |
|---|---|---|
| Monthly calculation count | TODO | Derived from User.calcCount aggregation |
| Monthly active users | TODO | Derived from User.activeDays |
| Monthly fill-ups logged | TODO | Count from fillups.json |
| QR scan rate over time | TODO | Campaign events time-series |
| Email open/click rates | TODO | Resend dashboard |
| Push notification opt-in rate | TODO | OneSignal dashboard |
| Giveaway entry volume | TODO | Giveaway history records |

---

*Internal strategic document. May 2026.*

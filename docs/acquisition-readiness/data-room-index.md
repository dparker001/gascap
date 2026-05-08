# GasCap™ Data Room Index

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> This is a placeholder index for a future data room to be assembled before any formal strategic or acquisition conversation. All entries marked [PLACEHOLDER] do not yet exist.

---

## What Is a Data Room

A data room is a secure, organized collection of documents provided to qualified potential acquirers or strategic partners under a Non-Disclosure Agreement (NDA). The index below defines what GasCap™'s data room should contain. Documents should be assembled only when needed and only shared after an NDA is executed.

---

## Section 1: Company Overview

| Document | Status | Notes |
|---|---|---|
| Company one-pager (product overview, team, mission) | [PLACEHOLDER] | 1-page summary |
| Founder bio: Don Parker | [PLACEHOLDER] | Background, relevant experience |
| Company formation docs: Gas Capacity LLC | [PLACEHOLDER] | Articles of organization, registered agent |
| EIN confirmation | [PLACEHOLDER] | From IRS |
| Operating agreement | [PLACEHOLDER] | Single-member LLC |
| Strategic positioning document | Available | `docs/acquisition-readiness/strategic-positioning.md` |

---

## Section 2: Product

| Document | Status | Notes |
|---|---|---|
| Product demo video (screen recording) | [PLACEHOLDER] | Walk-through of key user flows |
| Live product: www.gascap.app | Available | PWA, no install required |
| Feature audit | Available | `docs/acquisition-readiness/current-feature-audit.md` |
| Product roadmap | Available | `docs/acquisition-readiness/product-roadmap.md` |
| Plan feature map (Free/Pro/Fleet) | Available | `docs/acquisition-readiness/free-pro-fleet-feature-map.md` |
| Help documentation | Available | gascap.app/help |

---

## Section 3: Technical Architecture

| Document | Status | Notes |
|---|---|---|
| System architecture overview | Available | `docs/SYSTEM.md` |
| Feature catalog | Available | `docs/FEATURES.md` |
| Technical DD checklist | Available | `docs/acquisition-readiness/technical-due-diligence-checklist.md` |
| Tech stack summary | Available | README will contain this once created |
| Database schema (Prisma) | Available | `prisma/schema.prisma` |
| API route inventory | [PLACEHOLDER] | List all API endpoints with brief descriptions |
| Dependency inventory with licenses | [PLACEHOLDER] | `npm list --depth=0` + license audit |
| Security assessment | [PLACEHOLDER] | Third-party or self-conducted |
| Uptime history | [PLACEHOLDER] | Railway dashboard export or monitoring tool |
| Deployment architecture diagram | [PLACEHOLDER] | Railway service, PostgreSQL, GitHub Actions |

---

## Section 4: Metrics and Analytics

| Document | Status | Notes |
|---|---|---|
| Metrics plan | Available | `docs/acquisition-readiness/metrics-and-analytics-plan.md` |
| Monthly user growth (registered users) | [PLACEHOLDER] | Pull from admin analytics dashboard |
| Monthly active users over time | [PLACEHOLDER] | Pull from admin analytics or GA4 |
| Monthly calculation volume | [PLACEHOLDER] | Pull from User.calcCount aggregation |
| Navigation handoff volume (GA4) | [PLACEHOLDER] | GA4 event export: google_maps_open |
| Email campaign performance (open/click rates) | [PLACEHOLDER] | Resend dashboard export |
| Push notification performance | [PLACEHOLDER] | OneSignal dashboard export |
| QR campaign funnel data | [PLACEHOLDER] | Admin campaigns dashboard export |
| Partner station metrics | [PLACEHOLDER] | Per-station scan/signup/return data |

---

## Section 5: Revenue

| Document | Status | Notes |
|---|---|---|
| Stripe MRR at time of conversation | [PLACEHOLDER] | Pull from Stripe Dashboard at time needed |
| Stripe ARR | [PLACEHOLDER] | |
| Revenue by plan tier | [PLACEHOLDER] | Stripe plan breakdown |
| Subscriber count by plan | [PLACEHOLDER] | Admin dashboard |
| Churn rate (monthly) | [PLACEHOLDER] | Stripe or calculated |
| Trial → paid conversion rate | [PLACEHOLDER] | Key metric — decision gate May 2026 |
| Average Revenue Per User (ARPU) | [PLACEHOLDER] | Calculated |
| Customer Lifetime Value (LTV) | [PLACEHOLDER] | Calculated from ARPU and churn |

---

## Section 6: User Growth

| Document | Status | Notes |
|---|---|---|
| Total registered users (at time of conversation) | [PLACEHOLDER] | Admin dashboard |
| User growth chart (month-over-month) | [PLACEHOLDER] | Admin analytics or GA4 |
| Geographic distribution of users | [PLACEHOLDER] | GA4 user location report |
| User acquisition source breakdown | [PLACEHOLDER] | GA4 traffic source report |
| Language distribution (en/es) | [PLACEHOLDER] | Campaign events + GA4 |

---

## Section 7: Partner Program

| Document | Status | Notes |
|---|---|---|
| Partner pilot overview | Available | `docs/acquisition-readiness/partner-pilot-program.md` |
| Active placement list (count only, no PII) | [PLACEHOLDER] | Query admin campaigns dashboard |
| Top-performing placement case studies | [PLACEHOLDER] | Build from campaign data |
| Partner milestone tier distribution | [PLACEHOLDER] | Query campaign data |
| Partner station territories map | [PLACEHOLDER] | Map visualization of active placements |

---

## Section 8: Testimonials and Case Studies

| Document | Status | Notes |
|---|---|---|
| User testimonials (curated) | Available | Admin reviews dashboard has collected reviews |
| Partner station case study (×2) | [PLACEHOLDER] | Needs to be written from data |
| Rental return mode testimonial | [PLACEHOLDER] | Solicit from active Pro users |
| Fleet plan case study | [PLACEHOLDER] | Needs 1+ Fleet customer to tell their story |

---

## Section 9: Legal and IP

| Document | Status | Notes |
|---|---|---|
| Gas Capacity LLC formation | [PLACEHOLDER] | Articles of organization |
| EIN assignment letter | [PLACEHOLDER] | IRS notice |
| "GasCap" trademark status | [PLACEHOLDER] | USPTO search results + filing status |
| Domain registration: gascap.app | [PLACEHOLDER] | Registrar records |
| Terms of Service (current) | Available | gascap.app/terms |
| Privacy Policy (current) | Available | gascap.app/privacy |
| Sweepstakes Rules (current) | Available | gascap.app/sweepstakes-rules |
| No third-party IP claims (declaration) | [PLACEHOLDER] | Founder declaration |
| Open-source license compliance | [PLACEHOLDER] | License audit output |

---

## Section 10: Privacy and Compliance

| Document | Status | Notes |
|---|---|---|
| Privacy and compliance overview | Available | `docs/acquisition-readiness/data-privacy-and-compliance.md` |
| Cookie consent status | [PLACEHOLDER] | Current status + remediation plan |
| GDPR/CCPA compliance gap analysis | [PLACEHOLDER] | |
| DPA template | [PLACEHOLDER] | Not yet created |
| Data retention policy | [PLACEHOLDER] | Based on data-privacy-and-compliance.md |
| API key rotation log | [PLACEHOLDER] | Document last rotation dates |

---

## Section 11: Code and Deployment

| Document | Status | Notes |
|---|---|---|
| GitHub repository access | [PLACEHOLDER] | Invite buyer to private repo (under NDA only) |
| Railway project access | [PLACEHOLDER] | Read-only access for technical review |
| Build and deployment process | [PLACEHOLDER] | README + deployment section |
| Environment variable inventory | [PLACEHOLDER] | List all vars without values |
| Backup and recovery procedure | [PLACEHOLDER] | Railway PostgreSQL backup documentation |

---

## Section 12: Roadmap

| Document | Status | Notes |
|---|---|---|
| Product roadmap | Available | `docs/acquisition-readiness/product-roadmap.md` |
| Acquisition-readiness roadmap | Available | `docs/acquisition-readiness/acquisition-readiness-roadmap.md` |
| Deferred feature sprint plans | Available | MEMORY.md (internal) |
| High-value feature recommendations | Available | `docs/acquisition-readiness/high-value-feature-recommendations.md` |

---

## Section 13: Buyer Rationale

| Document | Status | Notes |
|---|---|---|
| Strategic buyer map | Available | `docs/acquisition-readiness/strategic-buyer-map.md` |
| Feature × buyer matrix | Available | `docs/acquisition-readiness/buyer-feature-fit-matrix.md` |
| Buy-vs-build analysis | Available | `docs/acquisition-readiness/buy-vs-build-analysis.md` |

---

## Data Room Preparation Checklist

Before making data room available to any counterparty:
- [ ] NDA executed and dated
- [ ] All [PLACEHOLDER] items either completed or explicitly excluded with explanation
- [ ] All financial figures pulled fresh from Stripe (no projections)
- [ ] All user metrics pulled fresh from admin dashboard (no estimates)
- [ ] Privacy Policy reviewed by legal counsel
- [ ] API keys and environment variable values are NOT included in the data room
- [ ] GitHub repository is private (not public)
- [ ] Data room hosted in a secure, access-logged location (Google Drive with link expiry, DocSend, etc.)

---

*Internal strategic document. May 2026.*

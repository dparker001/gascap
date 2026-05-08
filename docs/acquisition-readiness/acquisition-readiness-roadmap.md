# GasCap™ Acquisition-Readiness Roadmap

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> All numbers are GOALS and TARGET MILESTONES — not current results. Current actuals must be pulled from the Stripe Dashboard, admin analytics, and database queries. Never use projected numbers in external conversations.

---

## Why This Roadmap Exists

Being acquisition-ready does not mean being for sale. It means:
- The product is clean, well-documented, and understandable by someone new
- Revenue and growth are tracked and provable
- The technology is deployable and maintainable without the founder
- Legal/IP is clear
- A strategic conversation can happen on short notice without scrambling

This roadmap provides a series of milestones that — when reached — put GasCap™ in that position. Each milestone also happens to be a business milestone that is valuable regardless of exit.

---

## Phase 0 — Current State (May 2026)

**What is confirmed true today:**
- GasCap™ is live at www.gascap.app
- Stripe billing is live with Pro and Fleet plans
- 30-day Pro trial runs for all new signups
- Email drip sequence (10 emails), engagement track, comp ambassador sequence all running
- QR campaign system live with partner placements active
- GA4, Meta Pixel, GHL CRM sync all running
- 106+ Pro trial members as of May 4, 2026 snapshot
- Gas Capacity LLC formed; EIN obtained

**Immediate gaps that must be closed before any external conversation:**
- No automated tests on the calculation engine
- Rate limiting not implemented on auth routes
- Campaign events stored in JSON file (scale concern)
- Fill-up and trip logs stored in JSON files (scale concern)
- No root README.md
- No trademark registration
- No formal partner agreements
- Cookie consent banner missing (GDPR gap)
- Route-based trip planner not confirmed active in production

---

## Phase 1 — Foundation (0–90 Days)

**Goal: Close the critical technical and legal gaps. Prove the core metric — trial → paid conversion.**

### Target Milestones

| Milestone | Type | Status |
|---|---|---|
| Trial → paid conversion rate ≥5% | Revenue (decision gate) | Goal |
| Paying Pro/Fleet subscribers: [TODO: current + 60-day goal] | Revenue | Goal |
| Monthly calculation count documented | Analytics | Goal |
| All critical tech DD checklist items resolved | Technical | Goal |
| Calculate engine unit tests added | Technical | Goal |
| Rate limiting on auth routes | Security | Goal |
| Root README.md created | Documentation | Goal |
| Trademark application filed (or decision made) | Legal/IP | Goal |
| Route-based trip planner confirmed active in production | Feature | Goal |
| Monthly partner report (at least informal) to top 3 partners | Partner | Goal |

### Development Priorities (0–90 Days)
1. Activate route-based trip planner in production (set env vars on Railway)
2. Add unit tests for `lib/calculations.ts`
3. Implement rate limiting on `/api/auth/register` and `/api/auth/[...nextauth]`
4. Add `locked_feature_shown` GA4 event to all Pro feature gates
5. Add `rental_return_mode_toggled` GA4 event
6. Add `fillup_optimizer_run` GA4 event
7. Verify vehicle limit consistency (Pro: 3 or 5?)
8. Fix campaign events to write to PostgreSQL (replace JSON file)
9. Create root README.md

### Business Priorities (0–90 Days)
1. Pull actual conversion rate data (trial → paid) by May 31 per decision gate
2. File trademark application for "GasCap" (or get legal opinion on defensibility)
3. Document at least 3 partner stations with metrics for case study building
4. Identify one rental car brand contact for a co-branding exploration

---

## Phase 2 — Growth (3–6 Months)

**Goal: Demonstrate recurring engagement, build the partner network, and prove the data asset.**

### Target Milestones (GOALS — not current results)

| Milestone | Target | Why It Matters |
|---|---|---|
| Registered users | Goal: [TODO] | Broad top-of-funnel |
| Monthly Active Users (MAU) | Goal: [TODO] | Engagement quality |
| Paying Pro subscribers | Goal: [TODO] | Revenue proof |
| Fleet accounts | Goal: [TODO] | B2B proof |
| Active partner placements | Goal: [TODO] | Partner network scale |
| Monthly calculations | Goal: [TODO] | Usage intensity |
| Google Maps/Waze handoffs per month | Goal: [TODO] | Navigation intent signal |
| Monthly MRR | Goal: [TODO] (pull from Stripe) | Revenue proof |
| Churn rate | Goal: <5%/month | Retention quality |

### Development Priorities (3–6 Months)
1. Fuel Intent Score (from Smart Fill-Up Optimizer + calculation pattern)
2. Cost-per-mile tracking
3. Partner Dashboard (self-serve station reporting)
4. Fill-up logs migrated to PostgreSQL
5. Trip data migrated to PostgreSQL
6. Data export route for GDPR/CCPA compliance
7. Language support: pt-BR (pending conversion decision gate)
8. Weekly fuel report email (pending conversion decision gate)
9. Multi-driver sub-accounts (Fleet)
10. Cookie consent banner (GDPR)

### Business Priorities (3–6 Months)
1. First formal partner agreement with a gas station brand
2. At least one rental car company exploratory conversation
3. Case studies published for top-performing partner stations
4. PR/press outreach in local Orlando media
5. Meta ad campaign testing (Pixel is installed — start with small budget)
6. Fleet plan direct outreach to local small businesses

---

## Phase 3 — Traction (6–12 Months)

**Goal: Demonstrate market traction sufficient for strategic conversations. All metrics are provable and growing.**

### Target Milestones (GOALS — not current results)

| Milestone | Target | Why It Matters |
|---|---|---|
| Registered users | Goal: [TODO] | Scale |
| MAU / Registered ratio | Goal: ≥25% | Engagement quality |
| Paying Pro + Fleet subscribers | Goal: [TODO] | Revenue proof |
| Fleet accounts | Goal: [TODO] | B2B proof |
| Active partner placements | Goal: 50+ | Network scale |
| Partner stations at Gold+ tier | Goal: 5+ | Partnership depth |
| Monthly calculations | Goal: 100k+ | Usage intensity |
| Navigation handoffs per month | Goal: [TODO] | Fuel-intent signal value |
| MRR | Goal: [TODO] | Revenue proof |
| Churn | Goal: <3%/month | Retention proof |
| Trial → paid conversion | Goal: ≥10% | Business model proof |

### Development Priorities (6–12 Months)
1. API/integration layer for B2B partners (fleet platforms, fuel cards)
2. Anonymized fuel-behavior dataset (aggregate, privacy-safe)
3. Station selection behavior tracking (calculation → station → navigation)
4. Fleet fuel cost forecasting
5. GasCap™ Savings Report (branded monthly PDF, Pro/Fleet)
6. Smart upgrade timing (ML-informed prompts)
7. Rental company integration (API or webview)

### Business Priorities (6–12 Months)
1. First formal partnership agreement with a fuel brand (not just a pilot)
2. Fleet plan: 10+ active accounts
3. Partner network: 50+ active QR placements
4. Press/media: at least one feature in a business or startup publication
5. Investor readiness materials (if pursuing growth capital)

---

## Phase 4 — Strategic Conversations (12 Months+)

**Goal: Be ready to engage in any strategic conversation — partnership, licensing, or acquisition — from a position of strength.**

### Readiness Requirements

| Area | Requirement |
|---|---|
| Revenue | MRR documented, growing, churn ≤3%, LTV/CAC ratio ≥3x |
| Users | MAU growing month-over-month for 6+ consecutive months |
| Data | Fuel-intent dataset demonstrated (aggregate, anonymized) |
| Partners | 50+ active station placements; 3+ case studies; at least 1 formal agreement |
| Technology | Tests, rate limiting, PostgreSQL-only data stores, documented APIs |
| Legal | Trademark registered or strong common-law case; clean DD |
| Privacy | Cookie consent, GDPR/CCPA compliance, DPA template ready |
| Operations | Admin dashboard, runbooks, support process documented |
| Documentation | README, architecture doc, API reference, DD materials |

### Metrics That Matter to Strategic Buyers

For **mapping/navigation buyers:** monthly handoffs (Google Maps + Waze), navigation conversion rate, fuel-intent signal richness (state distribution, time-of-day patterns, vehicle type mix)

For **fuel/c-store buyers:** partner station network size, QR attribution accuracy, signups per station, return visit rate, cost per attributed customer

For **rental car buyers:** rental return mode usage, average savings per calculation, geographic concentration near airports

For **fleet buyers:** Fleet account count, vehicles per account, fill-ups logged per vehicle per month, tax report download rate, churn on Fleet plan

For **fuel card/expense buyers:** fill-up log volume, receipt scan accuracy, CSV export usage, API integration readiness

---

## Legal/IP Readiness Timeline

| Action | Timeline | Priority |
|---|---|---|
| USPTO trademark search: "GasCap" | Immediately | Critical |
| File intent-to-use trademark application (if clear) | 30 days | Critical |
| Operating agreement signed and filed | 30 days | High |
| Cookie consent banner (GDPR) | 60 days | High |
| Data export route (GDPR/CCPA) | 90 days | High |
| DPA template for B2B partners | 90 days | High |
| Partner agreement template | 90 days | High |
| Formal privacy policy update (AI features, GHL) | 60 days | Medium |
| Refund policy on website | 30 days | Medium |

---

*Internal strategic document. May 2026.*

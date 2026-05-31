# GasCap™ Acquisition Readiness — Master Index

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> This is an internal strategic planning package for growth, product planning, metrics, and acquisition-readiness. It is not a public sales listing. GasCap™ is not currently for sale.

---

## What This Package Is

This documentation package exists to ensure that GasCap™ is operationally and strategically prepared for any growth scenario — including partnerships, licensing, investment, or potential acquisition. A well-documented, clean, and strategically positioned product creates better outcomes in every scenario: it attracts better partners, closes better deals, commands better terms, and simply operates better day to day.

---

## Acquisition-Readiness Pillars

| Pillar | Status | Priority | Primary Doc |
|---|---|---|---|
| **Product** | Active development | High | current-feature-audit.md |
| **Traction** | Early stage | High | acquisition-readiness-roadmap.md |
| **Revenue** | Live (Stripe) | Critical | business-due-diligence-checklist.md |
| **Data** | Collecting | High | metrics-and-analytics-plan.md |
| **Partnerships** | Pilot stage | High | partner-pilot-program.md |
| **Technology** | Solid foundation | Medium | technical-due-diligence-checklist.md |
| **Legal / IP** | Early stage | High | business-due-diligence-checklist.md |
| **Privacy** | Partially addressed | High | data-privacy-and-compliance.md |
| **Operations** | Lean/founder-led | Medium | acquisition-readiness-roadmap.md |

---

## Document Index

### Strategy & Positioning
- [strategic-positioning.md](./strategic-positioning.md) — Core positioning as a fuel-intelligence platform, not just a calculator
- [strategic-buyer-map.md](./strategic-buyer-map.md) — Buyer and partner category map with rationale, metrics, and risks

### Product
- [current-feature-audit.md](./current-feature-audit.md) — Full feature audit with implementation status and value scoring tables
- [free-pro-fleet-feature-map.md](./free-pro-fleet-feature-map.md) — Plan feature strategy, locked-feature behavior, analytics events
- [product-roadmap.md](./product-roadmap.md) — Three-phase product roadmap (Adoption → Pro Intelligence → Fleet/Partner Network)
- [high-value-feature-recommendations.md](./high-value-feature-recommendations.md) — Recommended features to increase acquisition value and defensibility
- [buyer-feature-fit-matrix.md](./buyer-feature-fit-matrix.md) — Feature × buyer matrix with buy-vs-build rationale

### Business Analysis
- [buy-vs-build-analysis.md](./buy-vs-build-analysis.md) — Why a buyer would buy vs. build, moat strategy, key conclusion
- [metrics-and-analytics-plan.md](./metrics-and-analytics-plan.md) — Full metrics plan with event names, properties, and privacy notes

### Due Diligence
- [technical-due-diligence-checklist.md](./technical-due-diligence-checklist.md) — Technical DD checklist with current status
- [business-due-diligence-checklist.md](./business-due-diligence-checklist.md) — Business DD checklist with current status
- [data-privacy-and-compliance.md](./data-privacy-and-compliance.md) — Privacy architecture, compliance readiness, data minimization

### Partnerships & Growth
- [partner-pilot-program.md](./partner-pilot-program.md) — Pilot partner strategy, QR tracking, offer structure
- [acquisition-readiness-roadmap.md](./acquisition-readiness-roadmap.md) — 0-90d, 3-6mo, 6-12mo, 12mo+ milestone goals

### Data Room (Placeholder)
- [data-room-index.md](./data-room-index.md) — Future data room index structure with placeholders

---

## Key Facts (Verified from Codebase, May 2026)

- **Product:** Live at www.gascap.app — Next.js 14 App Router + TypeScript + PostgreSQL + Prisma
- **Plans:** Free / Pro ($2.99/mo or $19.99 Lifetime) / Fleet (coming soon — shelved)
- **Trial:** All new signups receive 30-day Pro trial automatically
- **Analytics:** GA4 + Meta Pixel + custom GA4 named events (gtag)
- **Email:** Resend — 10-email drip sequence (D1-D5 trial, P1-P5 paid) + engagement + comp ambassador
- **CRM:** GoHighLevel integration (contacts synced on register/upgrade/cancel)
- **Push:** OneSignal web push (price alerts, fill-up reminders, digests)
- **Navigation:** Google Maps + Waze deep-link handoffs (implemented)
- **AI:** Claude (Anthropic) — AI Fuel Advisor (Pro/Fleet)
- **Maps API:** Google Places/Routes API (configured via env flag — requires GOOGLE_MAPS_API_KEY + GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true)
- **QR/Partner:** Campaign placement tracking system live (CampaignPlacement model in PostgreSQL)
- **Giveaway:** Monthly drawing system ($25 Visa prepaid — scales to $50 at 500 subscribers)
- **Entity:** Gas Capacity LLC (Florida LLC, EIN: 42-2058323)
- **Deployment:** Railway (project: caring-integrity)

---

## How to Review This Documentation

All files are standard Markdown. Open with any Markdown viewer:

```bash
# From repo root — view in VS Code
code docs/acquisition-readiness/

# From repo root — list all docs
ls docs/acquisition-readiness/
```

These documents should be reviewed quarterly and updated when:
- A significant feature ships or changes status
- Pricing or plan structure changes
- New partnerships begin
- Legal/IP status changes
- Analytics events are added or renamed

---

*Last updated: May 2026. Internal use only.*

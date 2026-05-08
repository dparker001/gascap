# GasCap™ Strategic Buyer Map

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> No company listed here has expressed interest in GasCap™. This is a strategic planning framework to identify where GasCap™ might provide value, what would need to be proven, and how to approach each category.

---

## Overview

GasCap™'s value varies significantly by buyer type. This document maps the six most relevant buyer categories, explains the thesis for each, identifies what needs to be proven before approaching them, and notes realistic risks and objections.

---

## Category 1: Mapping / Navigation Platforms

**Examples:** Google Maps, Waze (Google-owned), Apple Maps, Mapbox, HERE Technologies, TomTom

### Why GasCap™ May Be Valuable
- GasCap™ generates qualified fuel navigation handoffs — users who have completed a calculation and then tap to open Maps or Waze. This is a structured, high-intent navigation signal with vehicle context (fuel level, budget, price sensitivity, tank size).
- At scale, this is a feed of pre-navigation fuel-intent events that no current mapping data source provides.
- The QR/campaign tracking system generates station-attributed user behavior: which physical locations drive signups, calculations, and navigation handoffs.
- GasCap™ could serve as a fuel-intent layer — a bolt-on that enriches the "find gas near me" experience with personalized context (your specific tank, your actual budget, your route).

### What Needs to Be Proven
- Monthly active users at meaningful scale (TODO: set target milestone in acquisition-readiness-roadmap.md)
- Volume of Google Maps / Waze handoffs per month (currently tracked via GA4 event `google_maps_open`)
- Conversion rate from calculation to navigation handoff
- User retention — do users return for multiple calculations over time?
- Station selection behavior data — does the user open Maps and navigate to a specific station after calculating?

### Metrics That Matter to This Buyer
- Monthly unique users running calculations
- Handoffs per user per month
- Retention rate at 30, 60, 90 days
- Navigation intent completion rate (handoff → station arrival is untracked; handoff rate is tracked)
- Geographic distribution of users

### Partnership Approach (Before Acquisition)
- Explore a data-sharing agreement to provide anonymized, aggregated fuel-intent signals
- Build a deeper integration (e.g., GasCap™ calculation results surfaced natively within a Maps fuel-stop search)
- Never include PII in any URL or data feed (see data-privacy-and-compliance.md)

### Acquisition Rationale
- Acqui-hire of fuel-intent expertise + user base
- Technology integration: GasCap™ calculation engine embedded in the navigation experience
- Data moat: the longer GasCap™ runs, the richer the behavioral dataset

### Risks and Objections
- Google / Apple can build a basic fill-up calculator in weeks. The moat is not the calculator itself — it is the user base, behavioral dataset, station-attribution network, and the multi-layer product (AI advisor, MPG tracking, fleet, partner placements).
- Small user base at early stage is a legitimate objection. This is addressable only with time and growth.
- Privacy regulators may scrutinize any fuel-behavior data-sharing arrangement. GasCap™ must have zero-PII guarantees in place before approaching.

---

## Category 2: Fuel / Convenience Store Chains

**Examples:** Circle K (Alimentation Couche-Tard), Pilot Flying J, Casey's, Wawa, Sheetz, Kwik Trip, Murphy USA, ARCO, Speedway (7-Eleven)

### Why GasCap™ May Be Valuable
- The partner pilot program (QR placard system) creates a measurable acquisition channel: drivers scan a QR code at a physical location, use GasCap™, and register as named users attributed to that station.
- A network of partner stations with per-station scan/signup/calculation data is a defensible commercial asset.
- GasCap™ could power a co-branded "Know Before You Fill" tool embedded in a fuel chain's own app or loyalty program.
- The featured station concept (in `lib/campaigns.ts`: `featured: boolean`) would surface partner stations to GasCap™ users near their location.

### What Needs to Be Proven
- At least 10–20 active partner stations with measurable QR scan data
- Demonstrated lift: stations with GasCap™ placements generate named customer relationships they would not otherwise have
- Clear attribution methodology: scan → app visit → account creation → returning user
- Milestone tier system (Partner / Gold / Premium) documented and earned

### Metrics That Matter to This Buyer
- QR scans per placement per day/week
- Scan → signup conversion rate
- Scan → returning user rate (attribution cookie)
- Number of active placements
- Cost per acquired customer via GasCap™ channel vs. other channels

### Partnership Approach
- Propose a pilot at 3–5 locations with a single fuel brand
- Provide monthly reporting: scans, signups, return visits attributed to each station
- Offer a featured station placement within the GasCap™ app (visible to users in that geographic area)
- Milestone incentives: brand reaches Gold Partner at 100 attributed signups, Premium at 250

### Acquisition Rationale
- A fuel chain acquires GasCap™ to embed it in their loyalty app / mobile experience
- The calculation engine + MPG tracking + receipt scan creates a fuel intelligence layer that drives daily engagement (not just pump visit engagement)
- The user data (aggregate, anonymized) reveals fill-up timing patterns, sensitivity to price thresholds, vehicle mix by location

### Risks and Objections
- Fuel chains are slow-moving, compliance-heavy organizations. Partnership procurement cycles are long.
- A branded fuel chain may not want to show competitor station data within the app. GasCap™'s neutral positioning is both an asset and a friction point.
- Margins at the pump are thin; customer data investment ROI must be clearly demonstrable.

---

## Category 3: Rental Car Companies

**Examples:** Enterprise, Hertz, Avis, Budget, National, Alamo, Sixt, Dollar, Thrifty

### Why GasCap™ May Be Valuable
- The Rental Car Return Mode is purpose-built for the rental return scenario. It calculates exact gallons needed before drop-off, explicitly accounting for the rental company's refueling rate ($10–$12/gallon).
- From the rental company's perspective: a customer who knows exactly how many gallons to buy before return has fewer disputes, fewer refueling charges, and a higher-quality drop-off experience.
- GasCap™ could be integrated into the rental company's own app or kiosk experience as a co-branded "Don't overpay at the pump" tool.
- Rental return is a high-commercial-intent moment geographically concentrated near airports, hotels, and downtown centers.

### What Needs to Be Proven
- Rental Car Return Mode usage data: how many calculations occur with rental mode toggled on
- Rental company refuel rate accuracy (user-entered; no integration with rental company systems today)
- Customer satisfaction signal: do rental return mode users report savings?
- Geographic concentration of rental return calculations (near airports, etc.)

### Metrics That Matter to This Buyer
- Number of rental return mode calculations per month
- Average calculated savings per rental return calculation
- Geographic distribution of rental return mode usage
- Repeat usage: same user uses rental return mode on multiple trips

### Partnership Approach
- Propose a white-label or co-branded "GasCap™ Rental Return" tool
- Integrate with a specific rental brand's app (API or iframe/webview)
- Negotiate based on: reduced refueling disputes (measurable), improved customer satisfaction scores at return

### Acquisition Rationale
- Rental company acquires GasCap™ for the rental return feature + the broader fuel intelligence capability
- Could be embedded in the rental app to increase daily active engagement between rentals (trip planning, personal vehicle tracking)
- The consumer-facing brand creates awareness during non-rental periods

### Risks and Objections
- Rental companies want features embedded in their app, not standalone apps. Requires API/SDK or white-label arrangement.
- Rental car companies have limited engineering resources for third-party integrations.
- The ROI case is clear only if dispute reduction is measurable — this requires integration with the rental company's return system, which GasCap™ does not currently have.

---

## Category 4: Fleet / Logistics Platforms

**Examples:** Samsara, Motive (KeepTruckin), Fleetio, Geotab, Verizon Connect, Teletrac Navman, Azuga

### Why GasCap™ May Be Valuable
- GasCap™ Fleet is a low-cost alternative for SMB fleet operators who cannot afford enterprise fleet management
- Per-vehicle spending, driver attribution, annual tax PDF, CSV export, and bulk import cover the primary financial use case for fleets of 5–50 vehicles
- GasCap™ Fleet users are an underserved segment: too small for enterprise solutions, too complex for a basic spreadsheet
- Multi-driver sub-accounts (planned) + fleet branding (company name/logo on PDF reports) create a clear B2B product line

### What Needs to Be Proven
- Fleet plan subscriber count
- Average fleet size per Fleet subscriber
- Tax report PDF downloads (measures high-intent, data-driven usage)
- Churn rate on Fleet plan

### Metrics That Matter to This Buyer
- Fleet subscriber count and growth
- Vehicles per Fleet account
- Usage intensity: fill-ups logged per vehicle per month
- Annual tax report download rate
- Customer acquisition cost for Fleet tier

### Partnership Approach
- API integration: offer GasCap™ fill-up data as a feed into existing fleet management dashboards
- White-label GasCap™ Fleet for telematics companies serving SMB fleets
- Referral partnership: telematics company refers SMB customers to GasCap™ Fleet for expense tracking

### Acquisition Rationale
- A fleet platform acquires GasCap™ to add a consumer-grade UX layer for SMB fleet operators
- The fill-up log + MPG tracking + driver attribution + tax PDF is a complete expense-reporting module
- The AI Fuel Advisor adds a differentiator for fleet cost optimization

### Risks and Objections
- Enterprise fleet platforms are not interested in consumer-focused apps; they need telematics integration.
- GasCap™ Fleet has no GPS tracking, no vehicle assignment enforcement, no manager approval workflows — it is expense-reporting, not fleet management.
- SMB fleet operators have high churn and are price-sensitive.

---

## Category 5: Fuel Card / Expense Management Platforms

**Examples:** WEX, FleetCor, Comdata, Brex, Ramp, Concur (SAP), Expensify

### Why GasCap™ May Be Valuable
- Fuel card companies capture transaction data but have no behavioral context before the purchase
- GasCap™'s fill-up log + receipt scan + MPG tracking creates a post-purchase intelligence layer that enriches transaction records
- The receipt scan feature (AI-powered extraction of gallons, price, date from a photo) is directly applicable to expense management workflows
- An integration between GasCap™ and a fuel card platform would allow automatic matching of logged fill-ups to card transactions — reducing manual expense reporting

### What Needs to Be Proven
- Fill-up log volume (fill-ups per month across all users)
- Receipt scan usage rate (Pro feature)
- Accuracy of AI receipt extraction (TODO: measure extraction accuracy)
- API readiness for third-party data integration

### Metrics That Matter to This Buyer
- Monthly fill-ups logged
- Receipt scan success rate
- Average MPG data points per user
- User engagement with the budget tracking feature (signals price sensitivity)

### Partnership Approach
- Propose an API integration: GasCap™ fill-up log feeds into the expense management platform automatically
- Offer receipt scan as a white-labeled expense capture tool
- Co-marketing to fuel card customers: "Pair your WEX card with GasCap™ for complete fuel intelligence"

### Acquisition Rationale
- Expense platform acquires GasCap™ for the receipt scan feature + the fuel-specific behavioral data layer
- The consumer brand creates awareness that drives card usage

### Risks and Objections
- Expense platforms have their own receipt capture features (Expensify, Concur)
- The integration requires GasCap™ to build an API layer (currently no public API)
- Data matching (GasCap™ log entry ↔ card transaction) requires precision that is difficult without telematics

---

## Category 6: Auto / Insurance / Telematics

**Examples:** Carmax, AutoNation, Geico, Progressive (Snapshot), Allstate (DriveWise), Arity, Otonomo

### Why GasCap™ May Be Valuable
- MPG tracking data (from fill-ups + odometer readings) is a proxy for driving behavior and vehicle health
- A sudden drop in MPG detected by GasCap™ is an early maintenance signal — useful to auto dealers (service upsell), insurers (vehicle condition), and telematics platforms (fleet health)
- Vehicle specs data (year/make/model/trim + EPA MPG + actual MPG from fill-ups) creates a rich vehicle profile linked to driving behavior
- VIN scan feature provides a verified vehicle identification link

### What Needs to Be Proven
- MPG tracking data volume and accuracy
- Correlation between GasCap™ MPG drops and actual maintenance events (currently not tracked)
- Vehicle mix of GasCap™ users (age, type, usage patterns)

### Metrics That Matter to This Buyer
- Vehicles with MPG trend data (3+ fill-up records)
- Average fill-ups per vehicle per month
- VIN scan usage rate (verified vehicle data)
- User engagement with maintenance reminder feature

### Partnership Approach
- Propose an anonymized aggregate dataset: "average MPG by vehicle make/model/year, by state, by season"
- Maintenance reminder cross-sell: partner with a service chain (Jiffy Lube, Firestone) to surface maintenance offers within GasCap™
- Insurance data partnership (requires explicit user consent and opt-in — never automatic)

### Acquisition Rationale
- Telematics platform acquires GasCap™ for the consumer-facing layer and the fill-up behavioral dataset
- The gap between expensive OBD-II telematics and free gas apps is exactly where GasCap™ sits

### Risks and Objections
- Insurance data use is heavily regulated; any data-sharing requires explicit informed consent
- Telematics companies want real-time data (GasCap™ fill-up log is manual, not automatic)
- Auto dealer use case requires geographic concentration of users near specific dealer locations

---

## Priority Ordering

For GasCap™'s current stage, the most tractable paths — ordered by approachability and near-term ROI — are:

1. **Fuel / C-store chains** — Partner pilot (not acquisition) is already in progress. This is the most immediate opportunity.
2. **Rental car companies** — Rental return mode is a unique, differentiated feature. A co-branding pilot is achievable with existing product.
3. **Fleet platforms** — Direct sales to SMB fleet operators; reseller agreements with accounting tools.
4. **Mapping / navigation** — Long-term strategic play; requires meaningful user scale first.
5. **Fuel card / expense** — Requires API development; medium-term opportunity.
6. **Auto / insurance / telematics** — Requires MPG dataset at scale and data governance framework; long-term.

---

*Internal strategic document. May 2026.*

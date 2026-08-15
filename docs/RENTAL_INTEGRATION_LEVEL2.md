# GasCap™ Rental Return Assistant — Level 2 Integration Architecture

This document describes how GasCap's Level 1 pilot (renter-entered data) is
architected to accept Level 2 data (rental-company APIs, connected-car
platforms, vehicle telematics) without rewriting the UI or calculation
engine. It is a companion to the code, not a substitute for reading it —
the source of truth for the shapes below is `lib/rentalProvider.ts`,
`lib/rentalCalculations.ts`, and `lib/rentalSessions.ts`.

## Current Level 1 Architecture

A renter creates a `RentalSession` (Postgres, via Prisma) by filling out
`RentalSetupFlow` (`components/rental-return/RentalSetupFlow.tsx`). Every
fuel-level input — a gauge fraction, a percentage, or an exact gallon
figure — is converted to gallons client-side (`gallonsFromGaugeFraction`,
`gallonsFromPercent` in `lib/rentalProvider.ts`) and tagged with a
`FuelDataSource` describing how confident that number is. The session is
created via `ManualRentalDataProvider.normalize()` — even though Level 1
has only one real data source (the renter), every session is created
through the same `RentalDataProvider` interface a real Level 2 provider
would implement, so nothing about session creation is manual-input-specific
at the type level.

All the numbers shown to the user — gallons needed, estimated cost,
estimated rental-company charge, savings, return-ready status — are
computed by pure functions in `lib/rentalCalculations.ts`. No component
computes these inline. This is the layer a Level 2 rollout does **not**
touch.

## Normalized Rental Model

```typescript
// lib/rentalProvider.ts
interface NormalizedRentalData {
  provider: string;                // 'manual' | 'avis' | 'hertz' | ...
  externalRentalId?: string;
  rentalCompany: string;
  vehicle?: {
    vin?: string; year?: string; make?: string; model?: string;
    trim?: string; tankCapacityGallons?: number;
  };
  pickup?: {
    timestamp?: string; location?: LocationData;
    fuelGallons?: number; fuelSource?: FuelDataSource;
  };
  returnRequirement?: { fuelGallons?: number; policyType?: 'same_as_pickup' | 'full' | 'exact' };
  currentVehicleState?: {
    timestamp?: string; fuelGallons?: number; fuelSource?: FuelDataSource; odometer?: number;
  };
  returnDetails?: { timestamp?: string; location?: LocationData };
  pricing?: { rentalFuelPricePerGallon?: number };
}
```

The UI and calculation engine consume `RentalSession` (the persisted,
already-normalized row), never a provider's raw API response.

## Provider Interface

```typescript
interface RentalDataProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: {
    vehicleSpecs: boolean; pickupFuelLevel: boolean; returnRequirement: boolean;
    currentFuelLevel: boolean; returnLocation: boolean; rentalFuelRate: boolean; odometer: boolean;
  };
  normalize(input: unknown): NormalizedRentalData;
}
```

`capabilities` exists because Level 2 providers won't all support
everything — a connected-car feed may have no concept of "rental agreement
number"; a rental company's API may not expose live telematics fuel level.
Callers should check capabilities before assuming a field will be present,
not assume every provider is a superset of `ManualRentalDataProvider`.

`RENTAL_PROVIDER_REGISTRY` in `lib/rentalProvider.ts` is where a new
provider gets registered — adding `AvisRentalProvider` means implementing
this interface and adding one line to the registry; no route, no
component, and no calculation function needs to change.

```text
RentalDataProvider
    |
    +-- ManualRentalDataProvider   (Level 1 — shipped)
    |
    +-- AvisRentalProvider          (Level 2 — not implemented, needs Avis API credentials)
    +-- HertzRentalProvider         (Level 2 — not implemented, needs Hertz API credentials)
    +-- EnterpriseRentalProvider    (Level 2 — not implemented)
    +-- SixtRentalProvider          (Level 2 — not implemented)
    +-- ConnectedVehicleProvider    (Level 2 — not implemented, e.g. Smartcar/OEM telematics)
```

## Authentication (Level 2, not yet built)

Each rental-company API will almost certainly require its own OAuth 2.0
client credentials or partner API key — GasCap has none of these today.
When a real integration is pursued:
- Store provider credentials as encrypted env vars (Railway), never in the
  repo, matching how `GOOGLE_PLACES_API_KEY` / `GASCAP_ANTHROPIC_KEY` are
  handled today.
- A connected-vehicle platform (Smartcar-style aggregator) is more likely
  than direct per-rental-company integrations for the first Level 2 win —
  one integration covers many vehicles instead of negotiating with each
  rental company individually.

## Webhooks (Level 2, not yet built)

A rental-company or connected-car webhook would call a new endpoint (e.g.
`POST /api/webhooks/rental/:provider`), authenticate the payload, call that
provider's `normalize()`, and `PATCH` the matching `RentalSession` via the
existing `updateRentalSession()` in `lib/rentalSessions.ts` — the same
function the manual "update current fuel" UI already calls. No new update
path needed; webhooks just become another caller of the same function.

## Telematics

A `VEHICLE_TELEMATICS`-sourced fuel reading is already a first-class
`FuelDataSource` value (see `FUEL_DATA_SOURCES` in `lib/rentalProvider.ts`).
`formatGallons()` already renders authoritative sources without the `~`
estimate prefix a manual gauge reading gets — the display layer is
Level-2-ready today, it just has nothing but manual sources feeding it yet.

## Data Precedence

Recommended precedence when more than one source might be available for
the same field (not currently enforced in code — Level 1 only ever has one
source per field, so this is a Level 2 concern):

1. Rental-company authoritative data (their system of record)
2. Vehicle telematics (closest to real-time, but not the rental company's
   own billing source of truth)
3. A verified rental document (e.g. OCR'd agreement — not built)
4. Manual exact-gallon entry
5. Manual percentage
6. Manual gauge estimate

This ordering is a starting recommendation, not a hard rule — if a real
integration reveals a better reason to reorder (e.g. telematics is
consistently more current than a rental company's own batch-updated
system), change it.

## Proposed Level 2 Flow

```text
Rental Company API / Telematics
        ↓
Rental Provider Adapter (implements RentalDataProvider)
        ↓
Normalized Rental Data
        ↓
GasCap RentalSession (lib/rentalSessions.ts)
        ↓
Fuel Intelligence Engine (lib/rentalCalculations.ts — UNCHANGED)
        ↓
Rental Return Assistant UI (components/rental-return/* — UNCHANGED)
```

## Migration Strategy

An existing Level 1 (manual) `RentalSession` migrates to Level 2 in place:
`provider` changes from `'manual'` to the real provider id, and any field
the provider can now supply authoritatively gets updated via the same
`updateRentalSession()` path, with its `*Source` field flipping from a
`MANUAL_*` value to `RENTAL_COMPANY_API` or `VEHICLE_TELEMATICS`. No schema
migration, no UI change, no session re-creation — the row is the same row,
just with better data in it.

## Future Partner API (not built — do not build without a clear reason)

If GasCap ever exposes a B2B API for rental companies to push data in
directly (rather than GasCap polling their API), the natural shape:

```text
POST  /api/partners/rentals
GET   /api/partners/rentals/:id
PATCH /api/partners/rentals/:id
POST  /api/partners/rentals/:id/fuel-state
POST  /api/partners/rentals/:id/returned
```

These would be thin wrappers around the same `lib/rentalSessions.ts`
functions the internal routes already use — the domain model already
supports this without redesign, it's only the (currently absent) partner
auth layer that would be new.

## White-Label

Not implemented, and nothing in Level 1 blocks it — `components/BrandBar`
is the only hardcoded "GasCap™" chrome around the feature; a white-label
skin would swap that component per-partner rather than requiring changes
inside `components/rental-return/*`.

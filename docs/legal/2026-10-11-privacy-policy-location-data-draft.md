# Privacy Policy — Proposed Additions for Trip Planner Location Data

**Status: DRAFT — not applied to `app/privacy/page.tsx`.** Per the engineering
contract, legal-document changes are never made automatically; this is
proposed wording for Don's (and ideally legal's) review before anyone
edits the live page.

**Why now:** Trip Planner Phase 2 (PR #81, merged 2026-10-11) added Current
Location and saved Favorite Addresses (Home/Work/custom labels). The
current privacy policy (last updated June 18, 2026, rev. 6) doesn't mention
either, or Google Maps Platform as a third-party service at all — the
second gap predates Phase 2 (the route-based Trip Planner already called
Google before this feature), but it's directly relevant now that the app
also *stores* address data, not just transiently sends it to Google.

Four additions, placed to match the existing document's sub-numbering
convention (e.g. 5a for SMS, 6a–6c for Wrapped/Streak/Getaway):

---

## Review pass (2026-10-11) — one correction made, verified against the merged code

I am not a licensed attorney and this is not legal advice — Don and,
ideally, real counsel should still review this before it goes live. What
I can do is check the draft for internal consistency and factual accuracy
against what the shipped code (PR #81, `origin/main`) actually does.

**Found and fixed one real problem:** the original "Current Location"
bullet below said coordinates are "never... shared with anyone." That's
false — they're sent to Google (via `/api/maps/route`) to calculate the
route, which the Section 4 addition two paragraphs later correctly
discloses. A policy that says "never shared" in one place and "sent to
Google" in another is an internal contradiction, not just an omission —
exactly the kind of inconsistency a real review should never let ship.
Corrected below to accurately say the coordinates are sent to Google for
that one calculation and never stored, rather than claiming no sharing at
all.

**Verified as accurate (checked against `origin/main`, not just written
from assumption):**
- No `latitude`/`longitude` column exists on `FavoriteAddress` — confirmed
  in `prisma/schema.prisma` and `lib/favoriteAddresses.ts`.
- Coordinates for a `google_place` favorite are resolved fresh via
  `resolvePlaceCoordinates(placeId)` on each use, never read from a cached
  value — confirmed in `lib/favoriteAddresses.ts`.
- No favorite-address field (label, displayAddress, placeId) is ever
  written to a log line — grepped `lib/favoriteAddresses.ts`,
  `app/api/favorite-addresses/route.ts`, and `.../[id]/resolve/route.ts`
  for `console.*`/`log(` calls; none exist.

**Not something I can verify myself — flagged for real legal review:**
- Whether "Powered by Google," as plain text (no logo), actually satisfies
  Google Maps Platform's attribution *branding* requirements, versus just
  the general "attribution must appear" requirement — these are sometimes
  separate obligations in Google's terms, and I can't authoritatively
  resolve the difference.
- Whether these additions, as worded, satisfy CCPA/GDPR-style
  purpose-limitation and data-minimization disclosure requirements if
  GasCap has or expects to have California or EU users — I have no way to
  confirm GasCap's actual regulatory exposure from inside the codebase.

---

## 1. New subsection — "1a. Trip Planner Location Data"

Insert after Section 1 ("Information We Collect"), before Section 2.

**Plain-English summary:** explains Current Location is never stored,
and exactly what a saved favorite address does and doesn't retain
(no raw coordinates for Google-sourced addresses — those are looked up
fresh each time, per Google's own retention terms).

**Proposed JSX:**

```tsx
{/* 1a */}
<section>
  <h2 className="text-lg font-black text-navy-700 mb-2">1a. Trip Planner Location Data</h2>
  <p>The Trip Planner's route-based mode can use your location in two ways:</p>
  <ul className="list-disc pl-5 space-y-1 mt-2">
    <li><strong>Current Location:</strong> When you tap &quot;Current Location,&quot; we request your device&apos;s location only at that moment — never before. Your coordinates are sent to Google Maps Platform to calculate that one route (see Section 4) and are never stored on our servers or saved to your account. Selecting Current Location never automatically saves it as a favorite address.</li>
    <li><strong>Favorite Addresses (Home, Work, or a custom label):</strong> If you choose to save an address, we store the label you choose, the address text, and — if you selected it from an address suggestion — a Google Place ID (a reference identifier Google uses to look up a location; it is not your precise coordinates). We do not store map coordinates for a Google-sourced favorite; we look them up fresh from Google each time you use the favorite to plan a trip, consistent with Google&apos;s data-retention terms.</li>
  </ul>
  <p className="mt-2">You may view, edit, or delete any saved favorite address at any time from the Trip Planner&apos;s &quot;Manage saved locations&quot; screen. Deleting a favorite removes it immediately. Your saved addresses are never visible to any other GasCap user.</p>
</section>
```

## 2. Addition to Section 2 ("How We Use Your Information")

Add a bullet to the existing list:

```tsx
<li>To calculate routes and fuel needs for trips you plan, including resolving a saved favorite address or your current location into a route via Google Maps Platform</li>
```

## 3. Addition to Section 4 ("Third-Party Services")

Add a new bullet — **this also closes the pre-existing gap that Google
Maps Platform isn't disclosed at all today**, not just the new storage:

```tsx
<li><strong>Google Maps Platform</strong> — address autocomplete, place lookup, and route/distance calculation for the Trip Planner&apos;s route-based mode. Addresses you type or select, and your device location if you choose &quot;Current Location,&quot; are sent to Google to calculate routes. See Section 1a for what we store from this process.</li>
```

## 4. Addition to Section 7 ("Your Rights")

Add a bullet alongside the existing Access/Correction/Deletion rights:

```tsx
<li><strong>Manage saved locations:</strong> You may view, edit, or delete any saved Home/Work/custom favorite address at any time from the Trip Planner&apos;s &quot;Manage saved locations&quot; screen, independent of deleting your whole account.</li>
```

---

## Not proposed here, flagged for a separate decision

- **"Last updated" date/rev bump** (currently "June 18, 2026 (rev. 6)") —
  whoever applies this should bump it and decide if existing users need a
  change notice per Section 10's own stated practice ("We will notify you
  of material changes via email or a prominent notice").
- **Google Maps Platform's own required end-user disclosures** (e.g. a
  link to Google's Privacy Policy) — Google's terms may expect this
  alongside the attribution already added in-product (PR #81's
  `GoogleAttribution` component); worth a legal check on whether the
  Section 4 bullet above is sufficient on its own or should link out.
- I did not touch Terms of Use — nothing in Phase 2 changes the fuel
  estimate/liability language already there; only Privacy is affected by
  this specific feature.

# Rental Mode — Quick-Save Upcoming Rentals + Email Booking Import

**Status: PLANNED** (2026-10-02). Nothing here is implemented. Written against
`main` @ `eb7ef00` (after PR #58, Rental Event Timezones).
**Owner decisions:** recorded in §6 (2026-10-02).
**Design review:** ChatGPT, 2026-10-02 — **PASS WITH CONDITIONS**; conditions incorporated below (rev 2). Part A approved to implement; Part B approved in principle, B1 gated on the proof-of-concept in §4.9.

## 1. Problem

A renter who books weeks ahead wants to save the rental now and finish it at
the counter. Today the setup wizard (`components/rental-return/RentalSetupFlow.tsx`)
blocks that:

| Wizard requirement | Where | Why it hurts an advance booking |
|---|---|---|
| Vehicle make + model + tank size > 0 | `canNext2` | Reservations say "Camry **or similar**" — the real car is unknown until the counter |
| Return date/time | `canSubmit` | Usually known — fine |
| All 7 steps clicked through | wizard | Most are optional, but you still walk them |

The server (`POST /api/rental-sessions`) only requires `rentalCompany`, and every
vehicle/fuel column on `RentalSession` is already nullable — the constraint is
UI-only.

Separately, the renter already has the booking in their inbox. Typing it in
at all is friction we can remove.

## 2. Goals / non-goals

**Goals**
- A ~1-minute "save as upcoming" path with only what a booking knows.
- A clear "finish at the counter" flow that never invents a number.
- Forward a reservation email → a pre-filled upcoming rental to review.
- Works identically on web, iOS and Android (native shells load the live web app — no Codemagic rebuild).

**Non-goals**
- Rental-company API sync (Hertz/Avis/Enterprise). Out of scope by project
  rule: needs approved credentials and a written spec
  (`docs/RENTAL_INTEGRATION_LEVEL2.md`).
- Reading the user's mailbox (Gmail/Outlook OAuth). Forwarding only.
- Auto-creating active rentals from email without the user confirming.

## 3. Part A — Quick-save upcoming rental

**Part A status: IMPLEMENTED on `feat/rental-quick-save`, pending review (not merged).** §3.3's `value → null` row is as built: refused (422) while a gauge/percent reading exists, because the model stores no raw fraction independently of its gallons (Don, 2026-10-02). Part B below remains PLANNED.

### 3.1 Flow
1. **New Rental → "Booked ahead? Save it as upcoming"** (second entry point
   beside the full wizard; the full wizard stays as-is).
2. One screen: rental company · confirmation number (optional) · pickup
   location + date/time · return location + date/time. Uses the existing
   `RentalEventScheduleField` (per-event zones, DST prompts, Places zones).
3. **Save.** Vehicle, tank size, pickup fuel, fuel rate, photos all stay null.
   Return policy defaults to `same_as_pickup` (target null until pickup fuel
   exists — current behaviour of `resolveRequiredReturnFuel`).

Pickup date/time becomes **required** on this path (it is what makes the
rental "upcoming" and drives the pickup reminders); it stays optional in the
full wizard.

### 3.2 "Finish setup" at the counter
The dashboard shows a checklist card while any of these are missing, in this
**enforced** order (each step depends on the previous):

1. **Vehicle** — VIN scan or Year/Make/Model lookup (existing Edit controls) → usually sets tank size.
2. **Tank size** — only if step 1 didn't provide one.
3. **Pickup fuel level** — existing "Set your pickup fuel level" card.
4. Optional: scan the agreement, fuel rate, photos.

Rules (per CLAUDE.md "Never invent a reading"):
- Unknown vehicle, tank, pickup fuel, current fuel or gauge reading renders as
  **unknown / not entered** — never `0 gal`, `0%`, an empty gauge ("E") or a
  status chip. No `?? 0` in any displayed number, status or calculation input.
  Add Fuel / Prepare for Return stay disabled with "finish setup first".
- **No gauge/percent pickup reading before a tank size exists.** The gauge and
  percent inputs are not offered until tank capacity is known; only an exact
  gallons entry would be possible earlier, and the checklist order hides it
  too. A fraction is never stored to be converted later.

### 3.3 Tank-capacity reconciliation (defect fix, in Part A)
Today `updateRentalSession` reconciles only when an existing capacity changes
(`capChanged` requires `oldCap != null`). Part A makes all three transitions
explicit, in the server domain layer, with regression tests:

| Transition | Behaviour |
|---|---|
| `null → value` | Recompute every value derived from capacity: a `full`-policy return target becomes the new capacity. Absolute gallon readings (typed gallons, receipts) are clamped to capacity. No stored fraction exists to convert (see §3.2). |
| `value → different value` | Existing behaviour: gauge/percent-sourced gallons rescale to preserve the observed fraction; absolute ones clamp; the target follows its policy. |
| `value → null` | Every gallon value that **depends** on capacity becomes **null/unknown**: a `full` target, and gauge/percent-sourced pickup/current/target gallons. Absolute gallon readings are kept (they never depended on capacity). |

An explicit value set in the same request always wins over reconciliation
(current rule). `value → null` is reachable via the API; the Edit modal today
cannot clear a tank (empty field sends `undefined`) — see §8 item 1.

### 3.3a Other Part A fixes
- Null-handling audit of the rental UI (found 2026-10-02): `RentalDashboard.tsx`
  (`tankCapacity = … ?? 0`, `currentFuelGallons ?? 0` in the tank bar,
  `requiredReturnFuelGallons ?? 0` in Prepare for Return), `FuelLevelInput.tsx`
  (`gaugePercent ?? 0` draws an empty gauge), and `lib/rentalSessions.ts` refuel
  (`currentFuelGallons ?? 0` + added gallons). Each must keep unknown as unknown
  or be provably unreachable with an unknown input; every change gets a test.
- Upcoming-rental Rental Details labels: "Picked Up / Returned" →
  "Pickup / Return" (EN + ES), completed rentals keep the past tense.

### 3.4 Reminders
The ~2h pickup reminder (email + push, `app/api/cron/rental-return-reminder`)
already deep-links to the rental. When setup is incomplete, its copy should
say "finish setting up your rental at the counter" instead of only "record
pickup fuel". **Cron copy change — requires Don's approval; no window or
logic change.**

### 3.5 Part A data impact
None. No schema change, no migration, no backfill.

## 4. Part B — Email booking import

### 4.1 User experience
1. My Rentals shows **"Import a booking by email"** with the user's private
   forwarding address and a Copy button: `import+<token>@rentals.gascap.app`.
2. The user forwards the rental company's confirmation email there (from any
   of their mailboxes — sender is not checked, see §4.3).
3. Within ~1 minute: email + push **"We found your Hertz rental — review it"**
   → opens a pre-filled quick-save screen (Part A) showing what was read.
4. The user corrects anything, then **Save** → a normal upcoming rental.
   Nothing becomes a rental until the user confirms.
5. If nothing could be read: a short email back ("We couldn't read that
   booking — you can add it manually in a minute").

### 4.2 Architecture (rev 2)

```
rental company email
  → user forwards to  import+<token>@rentals.gascap.app
  → Cloudflare Email Routing: ONE rule for import@rentals.gascap.app
     (subaddressing enabled; "+<token>" preserved in message.to)
  → thin Email Worker: read recipient token, basic size check (≤ 5 MiB),
     POST raw MIME + recipient to GasCap with a shared secret; no parsing, no AI
  → /api/rental-import/inbound
       verify secret (constant-time; 503 if unset — fail closed; 401 on mismatch)
       enforce GasCap's own 5 MiB cap
       hash token → user (unknown/revoked → 202 + drop, no oracle)
       idempotency key (§4.7) → duplicate delivery returns 200, no new work
       Pro check from DB (lib/serverPlan.ts)  ← before any AI spend
       rate limit per user/token
       parse MIME in GasCap: text/plain, HTML→text (no remote fetch), and at
         most one PDF attachment of the allowed type; everything else ignored
       Claude extraction (shared lib with scan-agreement) → allowlisted fields
       RentalImport row: status pending_confirmation; raw MIME discarded
       notify user (email + push)
  → user reviews in app → confirm endpoint (signed in) → Pro check again
       → shared rental creation service (same as POST /api/rental-sessions)
       → RentalSession; import marked confirmed (idempotent, §4.6)
```

Why one routed address: Cloudflare Email Routing supports subdomains, but
**catch-all rules are apex-only** (Cloudflare docs), so a unique local part per
user would need one routing rule per user. Plus-addressing (RFC 5233) matches
`import+<token>@…` against the single `import@…` rule and keeps `+<token>` in
`message.to`. **Both behaviours on `rentals.gascap.app` are B1 proof gates
(§4.9)** — not assumed.

- **Why a subdomain:** MX on `rentals.gascap.app` cannot affect `admin@gascap.app`.
- **Worker is deliberately thin:** recipient/token read, size check, secure
  hand-off. No MIME processing, no AI, no persistence in the Worker.
- **Provider abstraction:** an `EmailImportProvider` normalizes into the
  `RentalDataProvider` model (`lib/rentalProvider.ts`).
- **Extraction:** the scan-agreement prompt moves to a shared lib, adds
  `pickupLocation` and a "vehicle class / or similar" hint (never stored as
  the vehicle). Model returns null rather than guessing. Email text is
  untrusted input: fixed JSON schema, no tools, every field type-checked and
  user-reviewed.
- **Time zones:** the email gives local wall times with no zone. On review,
  each event's zone comes from its location via the existing Places path,
  otherwise device zone labelled "assumed". The import **cannot** write UTC
  instants: confirmation goes through the normal creation service, which
  validates IANA zones and DST and derives UTC.

### 4.3 Security (rev 2)
- **The private forwarding address is a bearer credential** authorizing
  exactly one thing: creating a *pending import suggestion* for that user.
  It never authorizes reading user data, creating a rental, triggering
  reminders, creating charges, bypassing Pro, or bypassing DST/zone validation.
- **Sender matching is not used** (decided in review): users forward from
  work/personal/family accounts, and `From` is not an authentication boundary.
- **Token:** ≥ 128 bits random (base32), rotatable ("Get a new address"),
  revocable, rate-limited per token/user. Never logged; redacted from errors,
  logs and observability (log a 6-char hash prefix only).
- **Storage without a reusable plaintext token (proposed):**
  - Lookup: store `SHA-256(token)` with a unique index; inbound hashes the
    received token and looks it up.
  - Redisplay: the UI must show the address again, so the token is
    **derived**, not stored: `token = base32(HMAC-SHA256(RENTAL_IMPORT_TOKEN_KEY, userId ‖ tokenVersion))`.
    The server recomputes it to display; rotation increments `tokenVersion`;
    revocation clears the stored hash. The DB holds no plaintext or
    ciphertext; a DB leak alone yields no usable address.
  - Key missing → import UI and inbound endpoint fail closed (503).
  - Trade-off: a leak of `RENTAL_IMPORT_TOKEN_KEY` exposes every user's
    address; mitigation is key rotation = global address rotation (users
    re-copy). Alternative considered: AES-GCM-encrypted token column (same
    key-leak profile, more moving parts).
- **Key rotation procedure (to be finalized and reviewed at B1).** Because
  addresses are HMAC-derived, rotating `RENTAL_IMPORT_TOKEN_KEY` changes
  every user's address. Rotation must therefore either:
  (a) **regenerate consistently** — in one controlled job, recompute each
      user's token under the new key and replace `rentalImportTokenHash`, so
      lookup hashes and displayed addresses never disagree; old addresses
      stop working and users are told to re-copy; or
  (b) **controlled transition** — keep `RENTAL_IMPORT_TOKEN_KEY_PREVIOUS`
      for a fixed window, store a second lookup hash (or key id) so inbound
      mail to the old address still resolves, show only the new address,
      then drop the previous key and hashes at the end of the window.
  The procedure, its schema implications (a key-id / second hash column for
  option b) and the user notice belong in the B1 review packet; no rotation
  is possible until it is approved.
- **Inbound endpoint:** shared secret required, constant-time compare, 503
  when unconfigured, 401 on mismatch; never logs the secret or body.
- **Pro is checked twice:** before AI extraction, and at confirmation. A user
  who lost Pro while an import is pending cannot confirm it (normal upgrade
  prompt; no grandfathering).

### 4.4 Privacy / retention (rev 2)
- **Raw email is never stored.** Processed in memory, discarded after extraction.
- **Allowlisted fields only:** company, confirmation/agreement number,
  pickup/return location text, pickup/return local date-time, vehicle-class
  hint, per-gallon fuel rate, fuel policy. The extraction schema has no
  field for — and the first version does not retain — loyalty numbers,
  payment-card fragments, names, unrelated addresses, prices other than the
  fuel rate, or other reservation content.
- **Attachments:** at most one PDF of the allowed type is read; all other
  attachments are ignored unread. **No remote resources** (images, links,
  tracking pixels) in HTML email are ever fetched.
- **On confirmation:** the staged extracted fields are purged; only minimal
  audit/dedup metadata remains (import id, user id, idempotency key hash,
  status, timestamps, resulting `rentalSessionId`).
- Pending/rejected imports expire after 30 days (cleanup in an existing
  daily cron — no new cron fire-time).
- Privacy Policy + Help get one paragraph on email import before launch.

### 4.5 Data model (requires B1 authorization; additive, nullable, direct SQL, no backfill)
- `User.rentalImportTokenHash` TEXT NULL, unique index;
  `User.rentalImportTokenVersion` INTEGER NULL.
- New table `RentalImport`:
  `id`, `userId`, `status` (`received | extracted | pending_confirmation |
  confirmed | rejected | expired | failed`), `deliveryKey` TEXT **unique**
  (§4.7), `extracted` JSON NULL (allowlisted fields; nulled on confirm),
  `confirmedRentalSessionId` TEXT NULL **unique**, `createdAt`, `expiresAt`,
  `updatedAt`.
- `RentalImport` stays **separate** from `RentalSession` (no
  `importPending` flag): reminders, lifecycle and cron only ever see
  confirmed rentals.

### 4.6 Confirmation idempotency
Confirm is a conditional transition `pending_confirmation → confirmed` done in
one transaction with the rental creation; `confirmedRentalSessionId` is
unique. A double-click or retry finds the import already confirmed and
returns the existing rental — never a second `RentalSession`.

### 4.7 Duplicate delivery
Assume Cloudflare → Worker → GasCap can deliver twice.
- `deliveryKey = SHA-256(userId ‖ normalized Message-ID)`; if `Message-ID` is
  absent, `SHA-256(userId ‖ SHA-256(raw MIME))` computed before discarding
  the body. Unique in the DB; a duplicate returns 200 without re-extracting.
- Forwarding a booking twice produces a new `Message-ID`, so it is a new
  import. A secondary semantic check (same company + confirmation number,
  pending or confirmed) shows "You may already have this rental" on review —
  **never** an automatic merge.

### 4.8 Cost
- One Claude call per *new* delivery (duplicates are free), only for Pro
  users, rate-limited and size-capped. Model choice to be measured: smaller
  model for text-only emails, current model for PDFs.
- Cloudflare Email Routing/Workers: expected free tier at our volume (verify).

### 4.9 B1 proof-of-concept gate (before schema authorization)
On a non-production path (flag off, Don's account only):
1. Cloudflare on `rentals.gascap.app`: subdomain routing works, subaddressing
   enabled, `import+<token>@` matches the single `import@` rule, and
   `message.to` contains the `+<token>`.
2. Real forwarded samples from **Avis, Hertz, Enterprise**, forwarded from
   **Gmail and Outlook** where available.
3. Failure/security cases: duplicate delivery; missing `Message-ID`;
   malformed MIME; oversized email (> 5 MiB); unknown token; revoked token;
   expired / non-Pro user; Worker → GasCap timeout and 503; prompt-injection
   text in the email; incomplete dates/times; DST-sensitive pickup/return times.
4. Results written up in a review packet before asking for schema +
   production Cloudflare authorization.

## 5. Rollout

| Phase | Ships | Schema | External setup |
|---|---|---|---|
| **A** Quick-save + Finish setup + tank-recompute fix | web (all platforms) | none | none |
| **B1** PoC (§4.9), then inbound plumbing behind a flag, Don's account only | endpoint + worker | additive (§4.5), after PoC | subdomain MX + routing rule + subaddressing + Email Worker |
| **B2** Review screen + notifications, Pro users | web | none | none |

Each phase: own branch + PR + ChatGPT review (Rental Mode, schema, new
infrastructure, AI cost all trigger review per CLAUDE.md). B1 needs a
read-only live smoke test with real forwarded emails from at least Hertz,
Avis, Enterprise before B2.

## 6. Decisions

Decided by Don, 2026-10-02:
1. **Part A approved as specified**, with pickup date/time **required** on the quick-save path.
2. **Pickup-reminder copy change approved** for incomplete setups (§3.4): copy only, no window/logic change.
3. **Inbound provider: Cloudflare** Email Routing + Email Worker.
4. **Email import is Pro-only.**

Still open:
5. Address domain: `rentals.gascap.app` assumed unless Don says otherwise.
6. Schema additions in §4.5: separate production authorization at B1, as with PR #58.
7. Cloudflare setup (subdomain MX + Worker + secret): Don performs or authorizes it at B1. No Cloudflare change is made before then.

## 7. Testing (per CLAUDE.md)
- Part A: regression tests for all three tank transitions (null→value fails on
  current code), unknown-not-zero rendering for every audited path, no
  gauge/percent entry without a tank, quick-save create payload (no vehicle,
  no fuel), Finish-setup ordering, upcoming vs completed detail labels (EN/ES).
- Part B: inbound auth fail-closed (missing secret → 503, bad secret → 401),
  unknown/revoked token dropped, token never logged, rate limit, 5 MiB cap,
  no raw body persisted, non-allowlisted fields never stored, no remote
  fetches, delivery-key dedup (with and without Message-ID), confirm
  idempotency (double confirm → one rental), Pro checked before extraction
  and at confirm, extraction returns nulls rather than guesses, imported
  values cannot set UTC; provider
  payload mocks built from the chosen provider's **official** sample
  payloads, with at least one positive real-shape path.

## 8. Claude's refinements to the review (for Don / ChatGPT)
1. **`value → null` tank clearing (PARTIALLY AGREE).** The server will null
   capacity-dependent gallons as required. But a gauge/percent reading is the
   renter's real observation; nulling it on a tank-clear silently discards
   it. Recommendation: the server implements the rule; the **Edit modal does
   not offer clearing** the tank when gauge/percent readings exist (change it
   instead, which rescales and keeps the observation). Today the modal can't
   clear a tank at all, so this is no behaviour change.
2. **Token storage (AGREE, with a concrete design).** Hash-for-lookup plus an
   HMAC-derived address (§4.3) satisfies "no reusable plaintext" while still
   letting the UI re-show the address. Needs one new secret,
   `RENTAL_IMPORT_TOKEN_KEY`, set in Railway by Don at B1.
3. **Message-ID dedup scope (AGREE, clarifying).** It catches duplicate
   *delivery* only; a user forwarding the same booking twice gets a new
   Message-ID, which the semantic check (§4.7) handles as a review warning.


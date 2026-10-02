# ChatGPT Review Packet — Quick-Save Upcoming Rentals + Email Booking Import (DESIGN)

**Design review only. No application code, schema or infrastructure has changed.**

## 1. Objective
Don: "What if I want to save an upcoming rental but I don't have all the info (gas level and other required data)? Can I save it with just a few steps and enter the rest when I pick up the rental? This is where I'd like the upcoming rental to sync automatically with the app." After options were presented: "Let's do both of the rental imports":
- (A) quick-save of an upcoming rental, finished at the counter;
- (B) forwarding the reservation email to create a pre-filled upcoming rental.

## 2. Repository State
- **Branch:** `docs/rental-import-spec` (local, not pushed)
- **Review Target SHA:** `790d9f3` (spec + recorded decisions)
- **Base branch:** `main` @ `eb7ef00` (PR #58 merge, deployed and smoke-tested 2026-10-02)
- **Relevant PR:** none yet
- **Review this diff:** `git diff --name-status origin/main...790d9f3`
  ```
  A	docs/RENTAL_UPCOMING_IMPORT_SPEC.md
  ```

## 3. What I Found
Verified in `main` @ `eb7ef00`, and by driving the production wizard in the 2026-10-02 signed-in smoke test:

- **The wizard demands more than the server does.**
  - The UI requires vehicle make + model + tank > 0 (`canNext2` in `RentalSetupFlow.tsx`) and a return date/time (`canSubmit`).
  - `POST /api/rental-sessions` requires only `rentalCompany`.
  - Every vehicle/fuel column on `RentalSession` is nullable.
  - So Part A needs no schema change.
- **Pickup fuel is already optional at setup and settable from the dashboard.** This was a deliberate earlier design, so the "finish at the counter" pieces partly exist.
- **Defect found while reading (not yet fixed):** `updateRentalSession` only reconciles fuel when the tank size *changes* (`capChanged` requires `oldCap != null`).
  - Setting a tank size for the first time (null → value) never recomputes a `full`-policy return target, which stays null.
  - This is latent today, because the wizard forces a tank size. Part A would expose it.
- **Dashboard null handling:** it uses `tankCapacity = session.fuelTankCapacityGallons ?? 0` with `> 0` guards. That needs an audit so a null tank always renders unknown (CLAUDE.md "Never invent a reading").
- **Existing pieces Part B can reuse:**
  - Agreement scanning (`app/api/rental-sessions/scan-agreement`, Pro-gated via DB plan) already extracts the fields Part B needs, except pickup location.
  - Outbound email goes through Resend/SMTP (`lib/email.ts`).
  - There is no inbound email handling anywhere.
- **Smoke-test copy issue:** Rental Details on an upcoming rental says "Picked Up / Returned".

## 4. What I Changed
Only `docs/RENTAL_UPCOMING_IMPORT_SPEC.md` (labelled PLANNED). No code.

## 5. Architectural Decisions
- **Quick-save is a second entry point, not a rewrite of the wizard.** The full 7-step wizard is unchanged. The quick path reuses `RentalEventScheduleField`, so per-event zones, DST prompts and Places zones behave identically.
- **Pickup time is required on the quick path** (Don decided). It is what makes the rental "Upcoming" and drives the pickup reminders.
- **"Finish setup" checklist order:** vehicle → tank → pickup fuel, because gauge/percent readings can't be converted to gallons without a tank size.
- **Email import authentication is a per-user private forwarding address** (`<token>@rentals.gascap.app`).
  - The alternative was a shared address matched by sender, which was rejected: From headers are spoofable, and users forward from other addresses.
- **Imports are suggestions.** A `RentalImport` row is created and the user confirms in-app. The confirmation goes through the normal `POST /api/rental-sessions` create path via a new `EmailImportProvider` (`RentalDataProvider` abstraction preserved). So DST validation, UTC derivation and the Pro gate are never bypassed.
- **Inbound provider: Cloudflare** Email Routing + Email Worker on a subdomain (Don decided).
  - The worker POSTs raw MIME to `/api/rental-import/inbound` with a shared secret; the endpoint fails closed with 503 if the secret is unset.
  - Using a subdomain means MX changes cannot affect `admin@gascap.app`.
  - Resend inbound was considered, as we already send through Resend; Cloudflare chosen.
- **Raw email is never stored.** Only extracted fields are persisted, and pending imports expire after 30 days.
- **An "or similar" vehicle class is a hint only,** never stored as the vehicle.

## 6. Security Impact
No change yet (design). The proposed design introduces:
- **A new unauthenticated-from-the-internet endpoint** guarded by a worker shared secret.
  - Constant-time compare; 503 when unconfigured; 401 on mismatch.
  - Never logs the secret or the email body.
- **Bearer-token-style email addresses.** A leaked address can only create a pending suggestion (no rental, reminder, charge or data read).
  - The address is rotatable and revocable.
  - Unknown tokens are dropped silently, so the endpoint can't be used to probe for valid addresses.
- **Prompt injection via email content** into the extraction model. The output is a fixed JSON schema, validated and type-checked, with no tools, and the user reviews every field.

## 7. Data / Database Impact
- **Part A:** none.
- **Part B** (B1, separate production authorization required): additive nullable `User.rentalImportToken` (unique) and a new `RentalImport` table. Direct SQL, no backfill.

## 8. User / Business Impact
- **Users:** faster advance booking for rental users, and fewer abandoned setups.
- **Pickup reminder copy** changes for incomplete setups (approved; copy only).
- **Cost:** email import is Pro-only (one AI call per forwarded email, rate-limited and size-capped).
- **Platforms:** works on web/iOS/Android with no native rebuild.
- **Before Part B launch:** Privacy Policy and Help need a paragraph.

## 9. Testing Performed
None. Design document only.

## 10. Files Changed
```
A	docs/RENTAL_UPCOMING_IMPORT_SPEC.md
```

## 11. Known Risks / Remaining Questions
- **Rental confirmation email formats vary widely by company.** The B1 gate requires real forwarded samples from at least Hertz, Avis and Enterprise.
- **Forwarded emails carry the original message's sender security records (SPF/DKIM)** inconsistently, so they are deliberately not used for authorization.
- **The user's current entitlement must be checked at confirm time, not only at import.**
- **Cloudflare Email Routing details are unverified:** subdomain support, the Worker's raw-message limits, and the free tier. These must be checked against current Cloudflare docs before B1.

## 12. Claude's Assessment
**READY FOR REVIEW** (design). Part A can start after review. Part B needs schema and Cloudflare authorization at B1.

## 13. Questions for ChatGPT
1. Is the private-token address sufficient authorization given imports are confirm-only? Or should B2 also require the forwarding sender to match a verified email on the account?
2. Should the first-time tank-size recompute (null → value) also rescale an earlier *gauge/percent* pickup reading, or should such readings simply be blocked until a tank exists (the spec blocks them)?
3. Is a `RentalImport` table the right boundary? The alternative is a `RentalSession` with an `importPending` flag, which risks reminders firing on unconfirmed data.
4. Any provider-contract risk in Cloudflare Email Worker → HTTPS POST (size limits, retries, duplicate delivery) that needs an idempotency key?

## 14. Requested Review Scope
Most scrutiny on:
1. Part B authentication, privacy and retention (§4.3–4.4 of the spec).
2. The "never invent a reading" rules for null vehicle/tank in Part A (§3.2–3.3).
3. Keeping imported data on the normal create path (DST/UTC/Pro gate).

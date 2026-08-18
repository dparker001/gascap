# GasCap™ Engineering Contract

Rules for anyone — human or AI — changing this codebase. Established in
hardening sprint 1 (2026-08-18).

GasCap is a live product with paying customers, a public sweepstakes run by a
registered Florida LLC, and shipped iOS/Android apps. Several rules below exist
because the corresponding mistake already happened here. Those are marked
**(happened)** so nobody re-litigates them as hypothetical.

---

## Git and deployment

- **Production follows `main`. A merge to `main` is a production deploy.**
- Never make substantial production changes directly on `main`. Use
  `feat/…`, `fix/…`, or `hardening/…` branches and open a PR.
- Run the required checks (see **Testing**) before requesting a merge.
- Do not bypass a failing test. If a failure is pre-existing, say so and show
  the evidence that it predates the branch.
- Never `git add -A` / `git add .` — stage explicit paths. **(happened:** a
  wildcard add staged a Firebase service-account private key; GitHub push
  protection caught it.**)**
- Never force-push `main`.

## Security

- Never commit secrets: tokens, API credentials, passwords, signing keys,
  Stripe or RevenueCat keys, database URLs, service-account JSON.
- **Privileged endpoints must fail closed.** A missing secret is a
  misconfiguration, never a reason to trust the caller. `if (secret && …)` is
  the bug shape — a missing env var deletes the check entirely.
  **(happened:** the RevenueCat webhook could grant Pro to anyone if its env
  var were absent.**)**
- Prefer constant-time comparison for secrets. Never log or echo a secret
  value, including in error responses.
- For a missing-config refusal on a machine-to-machine endpoint, return **503**
  rather than 401 where the caller retries 5xx — it preserves the delivery
  instead of dropping a real customer's entitlement.
- Never store administrator credentials in `localStorage` / `sessionStorage`.
  (Current admin auth does; migration designed in `docs/ADMIN_AUTH_MIGRATION.md`.)
- Never weaken auth to make development easier.
- **Client-side gating is never sufficient** for paid or security-sensitive
  operations. Enforce on the server. **(happened:** fill-up logging was sold as
  Pro but gated only in the UI; the API accepted anything.**)**
- Resolve entitlement from the **database**, not the JWT — sessions here are
  stateless and carry a stale plan after an upgrade or expiry (`lib/serverPlan.ts`).
- Do not log PII unnecessarily.

## Database

- **PostgreSQL via Prisma is the system of record.**
- Do not introduce new persistent JSON stores without explicit approval. One
  exists (`data/amoe-entries.json`, on a Railway volume) and it is a known
  exception, not a pattern to copy.
- Never run destructive commands against production: `DROP`, `TRUNCATE`, mass
  `DELETE`, `prisma migrate reset`.
- **Never blind `prisma db push`** — use direct, additive SQL and state the
  migration impact.
- Any script touching production data must state in its header whether it
  **reads or writes**, and writes must print before/after state.
- Backfills must be idempotent where practical.
- Preserve user data. Prefer settling a debt over revoking something a user was
  already shown. **(happened:** short streak tiers minted "1 free Pro month"
  credits by mistake; the fix stopped new ones and honoured the existing five.**)**

## Rental Return Assistant

- Preserve the `RentalDataProvider` abstraction (`lib/rentalProvider.ts`).
  Level 1 manual entry and any future Level 2 integration normalize into the
  same model.
- **`lib/rentalCalculations.ts` is the domain calculation layer.** No fuel math
  inside React components.
- Do not implement Hertz/Avis/Enterprise integrations without approved
  credentials and a written spec.
- **An active rental must remain fully usable if Pro lapses mid-rental.** Gate
  *starting* a rental, never finishing one — a lapsed trial must not strand
  someone with a car to return and no numbers.
- Changes to fuel calculations require regression tests.
- **Never invent a reading.** `?? 0` on an unknown fuel level is how the
  dashboard once showed a green "✓ No fuel needed" for a car nobody had picked
  up. Unknown renders as unknown.

## Payments and entitlements

- Stripe and RevenueCat are security-sensitive. Webhook changes require tests.
- Never grant Pro from a client-side signal.
- Do not alter prices or product IDs without explicit instruction.
- Handle lifetime, monthly, trials, Ambassador Pro-for-Life, and Lifetime Perks
  deliberately — they interact.
- Prevent double charging.

## Sweepstakes and rewards

- **Compliance-sensitive. Posted rules and implementation must stay aligned.**
- Do not change eligibility, entry values, winner restrictions, AMOE treatment,
  reward values, or the official rules without explicit approval.
- **AMOE (free entry) must always be in the draw.** **(happened:** submissions
  were written to a file the drawing code never read, so the free path could
  not win while the posted rules said "No purchase is required to enter."**)**
- Code that reads entry data fails loudly, never silently empty — a swallowed
  error there excludes people who are legally entitled to a chance.
- Sweepstakes fixes require regression tests.

## Native iOS / Android

- Do not expose Stripe purchase paths inside iOS where Apple's rules prohibit
  it. **All in-app purchases go through RevenueCat.**
- Preserve RevenueCat/StoreKit entitlement synchronization.
- Production builds should not ship WebView debugging enabled
  (`capacitor.config.json`; see `docs/NATIVE_HARDENING_REVIEW.md`).
- Navigation allow-lists must stay explicit.
- The native shells load the **live deployed web app**, so web changes need no
  Codemagic rebuild — but a native-config change does.

## Testing

For any material change:

```bash
npm test
npx tsc --noEmit
npm run build
```

- Add a regression test **before** considering a bug fixed.
- A regression test must be shown to fail against the old behaviour. A test
  that passes both before and after proves nothing.
- Never claim tests pass without running them; report exact counts.
- `npm run lint` is currently unusable — `next lint` with no ESLint config
  drops into an interactive prompt. Do not add it to CI until configured.

## Documentation

- **Docs describe the current implementation, not the plan or the past.**
- Update docs in the same change as the architecture they describe.
- Label documents `CURRENT`, `PLANNED`, `IMPLEMENTED`, `DEPRECATED`, or
  `HISTORICAL`. **Never let an implementation plan masquerade as architecture.**
- After a user-facing feature change, update **both** `app/help/page.tsx` and
  the `APP FEATURES` block in `app/api/ai/chat/route.ts` — the assistant will
  otherwise state stale behaviour confidently to users.
- Check `lib/translations.ts` for **both** EN and ES on every content change.
- Do not delete useful historical context; relabel it.

## Project-specific gotchas

- **Times in ET.** Cron expressions are UTC; quote both. Do not deploy cron
  changes during the 9:45–10:15 AM ET fire window.
- **Never the 🔥 emoji.** Streaks 📅, urgency ⏰, milestones 🏆.
- Brand mark is the orange nozzle+gauge only.
- Only the Railway project **caring-integrity** serves www.gascap.app.
- EPA `fueleconomy.gov`: for BEVs `comb08` is MPGe and `range` is electric
  miles — dividing them yields a nonsense "tank size".
- When a bug is found by accident, add a check that would have caught it
  (`/api/cron/integrity-check`). But never add a check that fires daily on
  expected state — a permanent false alarm trains everyone to ignore the real one.

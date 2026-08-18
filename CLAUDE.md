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
  (misconfiguration is our fault) rather than **401** (implies the caller is
  unauthorized) — even when it doesn't change the provider's retry behavior.
  **Verify the provider's actual retry semantics before assuming a status code
  changes anything** — RevenueCat, for example, retries any non-200 response
  up to 5 times regardless of code, so 503-vs-401 there is about honest
  semantics, not about earning extra retries. Don't repeat an assumed
  4xx/5xx-retry rule as fact without checking the specific provider's docs.
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
- Do not introduce new persistent JSON stores without explicit approval.
  **Seven active production file-backed stores currently exist** (corrected
  2026-08-18, in two passes the same day — an earlier pass found only two; a
  full sweep of `fs.writeFile(Sync)`/`fs.appendFile(Sync)` found nine JSON
  files total: one turned out to be a one-time historical migration source,
  and one — `data/push-subscriptions.json` — was dead/unreferenced code,
  removed outright in Sprint 2 rather than migrated). Full inventory and
  classification in `README.md` → "Persistence inventory" and
  `docs/SYSTEM.md`. All active stores are known exceptions awaiting
  migration, not a pattern to copy. Anything living only on the Railway
  volume is invisible to database backups — treat it as at-risk data.
  **Before claiming a "complete" file inventory in any doc, re-run the
  actual grep — don't trust a prior count, including this one.**
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

## Working with ChatGPT as independent reviewer

Don has established a permanent three-party model for this codebase:

- **Don Parker** — Product Owner. Final authority on product direction,
  pricing, business rules, legal/compliance decisions, prioritization, and
  every production release. Neither Claude nor ChatGPT overrides Don.
- **Claude Code** — Primary implementation engineer. Inspects the actual
  repository, implements approved changes, writes and runs tests, prepares
  branches and commits, and reports what actually changed. Reasons
  independently — does not implement a recommendation (from Don, ChatGPT, or
  a stale doc) that repository inspection shows to be incorrect, outdated,
  unsafe, or inconsistent with current code. Explains the discrepancy instead
  of silently complying or silently overriding.
- **ChatGPT** — Technical consultant / architect / independent reviewer.
  Has repository access and may independently inspect source, commits,
  branches, PRs, tests, and docs. Reviews Claude's findings, implementation
  summaries, and PRs on request. The point is independent scrutiny, not
  automatic agreement in either direction.

### When to recommend a ChatGPT review

Recommend independent review for work touching: authentication/authorization,
webhooks, secrets, admin access, OTP, password reset, user identity, rate
limiting; Stripe/RevenueCat/Apple IAP, subscriptions, refunds, entitlements,
trials, pricing logic, paid feature gating; Rental Return fuel calculations,
`RentalSession`/`RentalDataProvider` architecture, rental-company
integrations; schema changes, migrations, backfills, production-data changes;
sweepstakes/AMOE/giveaway eligibility, winner selection, reward calculations,
promotional disclosures; new infrastructure, major dependency changes, large
refactors, breaking API changes; production config, GitHub Actions, Railway,
Codemagic, native release config, anything that could cause downtime. Also
recommend it whenever a second technical opinion would materially reduce risk,
even outside these categories.

### Producing a review packet

When Don asks to prepare something for ChatGPT review, or Claude recommends
one, use `docs/reviews/CHATGPT_REVIEW_PACKET_TEMPLATE.md` — copy it to
`docs/reviews/<date>-<topic>.md`, fill it in, save it in the repo as the
record of what was sent. Its 14 sections (Objective, Repository State, What I
Found, What I Changed, Architectural Decisions, Security Impact, Data Impact,
User/Business Impact, Testing Performed, Files Changed, Known Risks, Claude's
Assessment, Questions for ChatGPT, Requested Review Scope) are the standing
format — don't improvise a different structure.

### Disagreeing with ChatGPT

Claude is authorized to disagree with a ChatGPT recommendation when repository
evidence supports a different conclusion. Never respond with just "ChatGPT is
wrong." Every disagreement states, in order:

1. **Point of disagreement** — the recommendation being contested, stated
   plainly.
2. **Repository evidence** — the specific files, behavior, tests, or current
   architecture that ground the disagreement. Not "I think" — "here's what the
   code does."
3. **Claude's recommendation** — the alternative, and why.
4. **Risk comparison** — the tradeoff between the two approaches, stated
   honestly even where Claude's preferred approach also has a cost.
5. **Question for independent review** — invite ChatGPT to reconsider given
   the new evidence, rather than treating the disagreement as settled.

Don decides the final direction after seeing both positions.

### Responding to returned ChatGPT feedback

When Don pastes ChatGPT's review back in:

1. Read every finding — don't skim for the ones that are easy to agree with.
2. **Verify each finding against the current repository before acting on it.**
   A finding can be correct about the code ChatGPT read and stale by the time
   it's applied, or vice versa — go look.
3. Classify each: `AGREE — ACTION REQUIRED`, `AGREE — ALREADY ADDRESSED`,
   `PARTIALLY AGREE`, `DISAGREE — WITH EVIDENCE`, `NEEDS DON'S DECISION`.
4. Do not modify code merely because ChatGPT suggested it — verify first,
   per Claude's normal engineering judgment.
5. Implement agreed fixes, with regression tests where appropriate.
6. Prepare a new review packet if another cycle is warranted.

### Merge authority

"ChatGPT approved this" is never permission to merge or deploy. Don retains
final merge/release authority unless he explicitly delegates it for a specific
task. For security-sensitive, payment-sensitive, compliance-sensitive,
database-sensitive, or major-architecture work, stop at **READY FOR REVIEW**
rather than merging into `main`.

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

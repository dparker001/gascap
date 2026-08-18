# ChatGPT Review Packet — Hardening Sprint 1

Filled instance of `docs/reviews/CHATGPT_REVIEW_PACKET_TEMPLATE.md`. Paste
this into ChatGPT, or point ChatGPT at branch `hardening/sprint-1` @ the SHA
below plus this file.

---

## 1. Objective
Don directed a full hardening sprint (his spec, reproduced in full) covering: RevenueCat webhook fail-open, a secret/auth audit of every privileged endpoint, a `/CLAUDE.md` engineering contract, CI, OTP architecture consolidation, README/SYSTEM.md/IOS_IAP_PLAN.md reconciliation, obsolete-workflow removal, script hygiene, native hardening review, CSP staging, and admin-auth + rate-limiting migration *designs only*. Explicit instruction: no merge to `main`, no destructive DB ops, no price/rule changes.

## 2. Repository State
- **Branch:** `hardening/sprint-1`
- **Commit SHA:** `f2e2780b` (short) — verify full SHA with `git rev-parse hardening/sprint-1`
- **Base branch:** `main` @ `451bdea`
- **Merge base:** `451bdea` (branch is a clean fast-forward ahead of main, no drift)
- **PR:** none opened yet — Don has not requested one

## 3. What I Found
- **RevenueCat webhook:** `if (expected && supplied !== expected) return 401` — confirmed fail-open exactly as suspected. Only instance found across 35 secret-authenticated endpoints inspected.
- **OTP:** two stores existed — Postgres `OtpCode` (live, used by `credentials-otp` in `lib/auth.ts`) and an in-memory `Map` in `lib/otpStore.ts`, reachable only via `/api/otp/verify`, which **nothing in the app called**. Not a live conflict — dead code.
- **OTP verify had no attempt limit.** Sending was rate-limited; the code comparison in `authorize()` was not.
- **README/SYSTEM.md were materially stale**, not just imprecise: SYSTEM.md explicitly asserted `Fillup` was "NOT in Prisma" and lived in `data/fillups.json`. Verified against the actual schema and `lib/fillups.ts` — `Fillup` is a Prisma model, `lib/fillups.ts` calls `prisma.fillup.*` exclusively. The doc's claim was simply false.
- **Two file-backed stores still exist**, not one: `data/saved-trips.json` (`lib/savedTrips.ts`, no Prisma model) and `data/amoe-entries.json`. Both on the Railway volume, outside DB backups. I initially documented only the AMOE one in a first CLAUDE.md draft and corrected it after grepping further.
- **`docs/IOS_IAP_PLAN.md` contained an active instruction to run `npm i @revenuecat/purchases-capacitor@^8`.** Installed version is `13.3.0`, wired into `app/upgrade/page.tsx` and `components/NativeIapInit.tsx`, and the webhook route is live. Following the doc's own "next step" would have downgraded a working payment integration by five majors.
- **`npm run lint` is non-functional** — no ESLint config exists; `next lint` drops into an interactive setup prompt that would hang CI.
- **Test count was previously misreported by me, in this conversation, before this sprint.** Default vitest discovery was scanning `.claude/worktrees/` (gitignored, from unrelated agent sessions) and running duplicate copies of two suites. True pre-sprint count: 135, not 211. Caught only because adding `vitest.config.ts` for the `@/` alias incidentally scoped discovery to `__tests__/`.
- **Admin auth fails closed today** — all 17 `/api/admin/*` routes guard `if (!pw) return false`/equivalent. The real defect is the raw password sitting in `localStorage` and being replayed as a header, not an open door.
- Confirmed present in production (names only, checked via `railway variables`, never printed values): `REVENUECAT_WEBHOOK_AUTH`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `ADMIN_PASSWORD`.

## 4. What I Changed

**`app/api/native/revenuecat/route.ts`**
- Purpose: close the fail-open auth gap.
- Before: missing secret → check skipped → any request treated as authentic.
- After: missing secret → `503`, refuses to process, logs a config error (RevenueCat retries 5xx, not 401 — protects real purchase delivery during a misconfiguration). Wrong/missing header → `401`. Comparison is constant-time (`safeEqual`). Secret never logged or echoed.

**`lib/auth.ts`**
- Purpose: OTP verification brute-force ceiling.
- Before: unlimited code guesses per email.
- After: 5 attempts / email / 10-minute window via the existing `checkRateLimit` helper — no schema change, no new infra. Trade-off stated in-line: keyed per-email means an attacker can lock one address out of OTP sign-in for the window; password sign-in remains available.

**`app/api/otp/verify/route.ts`, `lib/otpStore.ts`** — deleted. Confirmed zero callers before removal.

**`vitest.config.ts`** — new. Adds `@/` alias (previously absent — the reason the webhook route was untestable at all) and scopes discovery to `__tests__/`, which also fixed the inflated count above.

**`.github/workflows/ci.yml`** — new. `npm ci` → cron-inventory guard → test → tsc → build, on PRs to `main` and dev branches, Node 20, placeholder env only. Lint excluded, reason documented in-file. Verified locally against a stripped env (`env -i` + explicit placeholders) before trusting it.

**`.github/workflows/trial-conversion.yml`** — deleted. Its own header said "delete after 2026-05-26"; it had been firing daily since to no-op. `scripts/check-cron-inventory.mjs` EXEMPTs the underlying route already, so removal doesn't break the guard, but I corrected the exemption's stated reason since it pointed at the now-deleted file.

**`CLAUDE.md`** — new engineering contract. Rules tied to something that already happened in this codebase are tagged `(happened)`.

**`docs/SECURITY_AUDIT.md`** — new. Full 35-endpoint table: mechanism, fail-closed status, remaining concern. No secret values.

**`README.md`, `docs/SYSTEM.md`** — rewritten data-architecture sections. Corrected the false "Fillup not in Prisma" claim; documented the two real remaining file stores; added the OTP flow (previously undocumented) and session-staleness as an explicit security note pointing at `lib/serverPlan.ts`.

**`docs/IOS_IAP_PLAN.md`** — status header added (`IMPLEMENTED/ACTIVE` vs `PLANNED` vs `HISTORICAL`), the downgrade instruction struck through and marked deprecated in place rather than deleted.

**`docs/ADMIN_AUTH_MIGRATION.md`, `docs/RATE_LIMITING_PLAN.md`, `docs/CSP_ROLLOUT_PLAN.md`, `docs/NATIVE_HARDENING_REVIEW.md`, `docs/SCRIPTS_INVENTORY.md`** — new design/analysis docs, all explicitly `PLANNED`, nothing implemented against the running app or `capacitor.config.json`.

**Six root `check_*.ts` scripts** → `scripts/diagnostics/`, after verifying each read-only and unreferenced.

## 5. Architectural Decisions

- **503, not 401, for the RevenueCat missing-secret case.** Alternative was a flat 401. Chose 503 because RevenueCat's retry behavior differs by code — 5xx retries, 401 doesn't — and the failure mode being guarded against is *our* misconfiguration, not a bad actor. A flat 401 risks silently dropping a real purchase during an outage window.
- **PostgreSQL over Redis for the rate-limit migration path** (design only). Both real weaknesses of the in-memory limiter — reset on deploy, no cross-instance sharing — are solved by infrastructure already owned and backed up. No new vendor for a single-instance deployment.
- **Admin-auth migration sequenced so the new guard accepts EITHER valid session-role OR the legacy header**, until logs show the legacy path unused. Rejected a hard cutover — it risks a lockout with no established fallback.
- **CSP: Report-Only first, no enforcement this sprint.** The Meta Pixel and GA are injected via `dangerouslySetInnerHTML`; enforcing blind risks silently breaking analytics (no user-visible error) while looking safe in a code review.
- **`webContentsDebuggingEnabled` fix proposed as a Codemagic build-step patch, not a config-format change**, specifically because the config is committed and consumed by the release pipeline — a broken native config isn't fixed by a web redeploy, it costs a release cycle.
- **Did not touch `useLegacyBridge` or `limitsNavigationsToAppBoundDomains`.** The latter has a specific documented reason: enabling app-bound domains disables WKWebView APIs the app needs for Stripe/Google/OneSignal cross-origin calls.

## 6. Security Impact
**Problems fixed:** RevenueCat webhook fail-open (critical); OTP brute-force ceiling added; OTP dual-store removed.
**New considerations introduced:** none — no new attack surface added.
**Remaining concerns:** admin auth mechanism (documented, not touched); `CRON_SECRET` travels in query string on 18+ routes (low risk, HTTPS + GitHub Actions only, deferred); no CSP yet.
**Auth/authz behavior changed:** yes, exactly one endpoint — RevenueCat webhook now refuses to process on missing secret (503) instead of accepting all requests. This is the one item I'd most want double-checked: **confirm no legitimate RevenueCat call path can ever arrive without the header set**, since a false positive here silently stops Pro grants for real iOS purchasers.

## 7. Data / Database Impact
**No schema changes. No migrations. No backfills. No destructive operation of any kind.** All work is code, tests, config, and documentation. The `role`/`AdminAuditLog` schema in `ADMIN_AUTH_MIGRATION.md` is a **proposal in a markdown file**, not applied anywhere.

## 8. User / Business Impact
- **iOS/Android Pro purchasers:** none, provided `REVENUECAT_WEBHOOK_AUTH` stays set in production (confirmed present as of this session).
- **OTP sign-in users:** a user who mistypes their code 5 times within 10 minutes will be blocked from further attempts in that window. No other sign-in path affected.
- **Trials/pricing/rewards/rental/giveaway entrants:** zero — none of that code was touched this sprint. (Separate, prior work in this same session did touch rental fuel calculations, AMOE draw inclusion, and streak tiers — those are already merged to `main` in earlier commits, not part of this branch.)
- **App-store users:** none directly; `capacitor.config.json` was not modified.
- **Campaigns:** the dead `trial-conversion.yml` workflow removal has zero live effect — it exited 0 on every date outside a window that closed 2026-05-26.

## 9. Testing Performed

```
npm test          → 157 passed (11 files), 0 failed
npx tsc --noEmit   → exit 0, no output
npm run build      → ✓ Compiled successfully
```

All three re-run and confirmed **after** the history correction described in §11, on the final pushed SHA. `npm run lint` was **not** run as part of CI — confirmed non-functional (interactive prompt, no config) and documented rather than silently skipped.

Additionally, the RevenueCat regression test was verified to actually detect the vulnerability: I temporarily reverted `route.ts` to the original fail-open line, re-ran the suite (1 of 19 tests failed — the correct one), then restored the fix and confirmed all 19 pass.

## 10. Files Changed (complete)

```
.github/workflows/ci.yml                    (new)
.github/workflows/trial-conversion.yml      (deleted)
CLAUDE.md                                   (new)
README.md                                   (modified)
__tests__/otpVerifyThrottle.test.ts         (new)
__tests__/revenuecatWebhook.test.ts         (new)
app/api/native/revenuecat/route.ts          (modified)
app/api/otp/verify/route.ts                 (deleted)
docs/ADMIN_AUTH_MIGRATION.md                (new)
docs/CSP_ROLLOUT_PLAN.md                    (new)
docs/IOS_IAP_PLAN.md                        (modified)
docs/NATIVE_HARDENING_REVIEW.md             (new)
docs/RATE_LIMITING_PLAN.md                  (new)
docs/SCRIPTS_INVENTORY.md                   (new)
docs/SECURITY_AUDIT.md                      (new)
docs/SYSTEM.md                              (modified)
lib/auth.ts                                 (modified)
lib/otpStore.ts                             (deleted)
scripts/check-cron-inventory.mjs            (modified)
scripts/diagnostics/README.md               (new)
scripts/diagnostics/check_*.ts × 6          (moved from repo root)
vitest.config.ts                            (new)
```
27 files, +1390/−292.

## 11. Known Risks / Remaining Questions — candid

1. **I made a real process error mid-sprint and want it on the record rather than buried.** My first attempt at committing the P0 fix silently failed to stage the actual code changes (a `2>/dev/null` on a `git add` masked an error), producing a commit whose message described the security fix while the diff contained only unrelated deletions. I caught it via `git show --stat` before pushing, and rebuilt the commit correctly. No bad commit ever reached the remote. But it happened, and it's the same class of mistake CLAUDE.md now explicitly warns against.
2. **Second, separate mistake, same session:** my later `git add docs/ scripts/` (broader than intended) swept four unrelated pre-existing business documents (a press release draft, a demo cheat sheet, two partner outreach templates) into the final commit. Caught before push by reviewing `git diff --stat`, and corrected via `git reset` + explicit re-staging — those four files are confirmed untracked/excluded from the final branch (§3, §10). Flagging this because it's exactly the failure mode the wildcard-`git add` rule in CLAUDE.md exists to prevent, and I violated it while writing that rule.
3. **I used `git push --force-with-lease` on this branch after telling Don it was ready**, to correct the above. It was safe (branch unshared, lease matched), but force-pushing a branch that may already be under review is the wrong reflex and I want that named rather than smoothed over.
4. **The RevenueCat 503-vs-401 design decision is untested against RevenueCat's actual retry documentation** — I reasoned from general webhook retry semantics (5xx retries, 4xx generally doesn't), not from a verified RevenueCat spec citation. Worth an independent check.
5. **CI has never run in GitHub Actions** — only simulated locally via `env -i` with placeholder vars. First real PR run may surface an environment difference I didn't reproduce.
6. **The `data/saved-trips.json` file-store finding is new information Don has not yet acted on** — it's documented, not fixed, and sits outside DB backups today.

## 12. Claude's Assessment

**READY FOR REVIEW.**

Not READY WITH KNOWN CONCERNS, because I don't believe any open item blocks a merge decision — but I do think item 1 in §11 earns scrutiny of my own commit hygiene on this branch specifically, not just the code.

## 13. Questions for ChatGPT

1. Do you agree the RevenueCat webhook now fails closed under every configuration state (missing secret, wrong secret, missing header, empty header, malformed body)? The test suite is `__tests__/revenuecatWebhook.test.ts` — please check for a bypass I didn't think to test.
2. Is 503 the right status for the missing-secret case, or does RevenueCat's actual webhook-retry behavior argue for something else?
3. Does the admin-auth migration design in `docs/ADMIN_AUTH_MIGRATION.md` have a privilege-escalation path in the dual-auth transitional state (steps 3–5, where both legacy header and new session-role are accepted simultaneously)?
4. Is keying OTP-verify rate limiting by email (rather than IP, or both) the right trade-off, given it creates a targeted lockout vector against a specific address?
5. Does anything in the CI workflow's placeholder-env approach risk masking a real integration failure that would only appear with genuine production secrets?

## 14. Requested Review Scope

Please give the most scrutiny to:
- `app/api/native/revenuecat/route.ts` + its test file — this is the one change with direct payment-entitlement consequence.
- The commit-hygiene issues I self-reported in §11 (items 1–3) — independently verify the current branch state matches what I've represented here, rather than trusting my account of the cleanup.
- `lib/auth.ts` OTP throttle — confirm the keying choice and window are sound.
- Whether `docs/SECURITY_AUDIT.md`'s claim of "35 endpoints inspected, RevenueCat the only fail-open case" is actually exhaustive, or whether there's a class of endpoint I didn't search for.

# ChatGPT Review Packet — Service-worker integrity & API caching privacy

Template: `docs/reviews/CHATGPT_REVIEW_PACKET_TEMPLATE.md`. **Security / privacy review requested.** Supersedes PR #67
(only reviewed concepts carried forward; no commit from that branch). Policy: `docs/SW_CACHING_POLICY.md`.

## 1. Objective
Independent review of #67 found a more important defect than the one it addressed: the built service worker calls an
undefined `origPattern`. Fix the serialization defect **without** reviving the caches it accidentally kept dead, classify
every API route, make private routes NetworkOnly by default, and make the guard enforce a full security contract on the
**built** artifact.

## 2. Repository State
Branch `fix/sw-integrity-api-caching` from `origin/main` @ `6987f18`. Diff: `git diff --name-status origin/main...HEAD`.

## 3. What I Found
- **Exact root cause.** `next.config.js` wrapped next-pwa's default `apis` entry in a predicate that closed over the outer
  `origPattern`. Workbox serializes predicates via `Function#toString`; closures are lost. Built `public/sw.js` (and the
  live production one — fetched and evaluated) contains `origPattern` once, never defined. Every same-origin URL that reaches
  that predicate throws `ReferenceError`; Workbox's `findMatchingRoute` has no try/catch, so the exception escapes the
  `fetch` listener and the browser uses the network. Reached by: all `/api/*` except 4 exclusions, **and all pages**.
- **It was accidentally safe.** Behind that predicate sit the default `apis` (NetworkFirst, 10 s timeout, 24 h stale
  fallback), `others` (same, for **pages / RSC**) and `cross-origin` caches. They never ran. Repairing the closure would
  have enabled them for `/api/fillups`, `/api/admin/*`, `/api/activity`… and authenticated pages.
- **Inventory:** 156 route handlers, 104 GET-capable: USER 38, ADMIN 19, AUTH 2, CRON 23, GAS 4, PUBLIC 18.
- **Unexplained 503 incident is separate and still open** (see §11).

## 4. What I Changed
| File | Change |
|---|---|
| `next.config.js` | `runtimeCaching` rewritten, default-deny, **no closures** (the only 2 function predicates are fully self-contained). (1) any same-origin `/api/*` fetch → `NetworkOnly`, plus the historical `/gas/`, `/api/vehicles`, `/api/user/profile`, `/api/favorites` for **all** modes. (2) `/api/*` navigations → not intercepted (Safari OAuth, next-pwa #131). (3) `/api/gas-price/history` → `NetworkFirst` `public-fuel-history`: the only cached API. (4) the `apis`, `others`, `cross-origin` defaults are **removed** (already dead). (5) static-asset defaults untouched. |
| `scripts/sw-route-inventory.mjs` | derives every route's URL, methods, class from `app/` |
| `scripts/sw-contract.mjs` | the contract as data, **generated from the inventory** (new routes are checked automatically); 266 expectations |
| `scripts/check-sw-integrity.mjs`, `package.json` `check:sw`, `.github/workflows/ci.yml` | executes the built worker in a sandbox; fails closed |
| `__tests__/swIntegrity.test.ts` | 48 tests (43 always; 5 built-artifact with `VERIFY_BUILT_SW=1`) |
| `__tests__/savedStationLivePrices.test.ts` | **one assertion updated, flagged for review** (below) |
| `docs/SW_CACHING_POLICY.md` | CURRENT policy + classification + post-mortem |

**Existing test changed.** `savedStationLivePrices` asserted that the `apis` wrapper contained an explicit
`/api/favorites` exclusion. That wrapper no longer exists because the `apis` cache entry itself is stripped — a stronger
guarantee. The first assertion (favorites in the leading NetworkOnly predicate) is unchanged and passes; the second now
asserts the `apis` entry is stripped. `/api/favorites` NetworkOnly in every mode is additionally proven behaviourally.

## 5. Architectural Decisions
- **Default-deny over an exclusion list.** A list of "private paths" fails open for the next route someone adds; a default
  fails closed. Classification (heuristic) documents rationale but the policy does not depend on it.
- **Remove, don't repair, the dead caches** — repairing them is the hazard.
- **Preserve effective behaviour:** vs the **deployed** worker's actual behaviour, 263 of 266 contract cases are
  identical (throw→network ≡ NetworkOnly/no-route→network). The only change is `/api/gas-price/history` now cached.
- **One public cached API**, justified in `SW_CACHING_POLICY.md`; `/api/gas-price`, `/national`, `/pulse`,
  `/api/electricity-price`, `/api/user-count`, `/api/stats/aggregate`, `/api/founding/status`, `session-amount`, `unsubscribe` are NetworkOnly.
- **Navigations not intercepted** (auth and all `/api/*`) to keep Safari OAuth behaviour next-pwa protects.
- **Executing the artifact** (not parsing it): free variables are caught by running the worker inside a `with(Proxy)` scope
  that records any identifier it cannot resolve itself, plus a literal `origPattern` check and thrown-matcher detection.

## 6. Security Impact
Reduces risk. No private/user-specific/admin/auth/cron/GAS response can enter a SW cache; pages/RSC and cross-origin are
never runtime-cached; the dangerous latent repair path is closed and CI-guarded. No change to NextAuth, cookies, JWT,
providers, CSRF, or any route's own logic.

## 7. Data / Database Impact
None.

## 8. User / Business Impact
No intended user-visible change. The weekly EIA chart is now offline-/slow-network-resilient (stale ≤ 24 h). A new
service worker is installed on next visit (every build already changes `sw.js`).

## 9. Testing Performed
```
npm run check:crons → 22 routes, 20 scheduled, 2 exempt
npm test            → see PR (all pass; 5 skipped = built-artifact group)
VERIFY_BUILT_SW=1   → swIntegrity: 48 passed
npx tsc --noEmit    → exit 0
npm run build       → exit 0
npm run check:sw    → exit 0 on the new built worker (14 routes, 0 thrown, 0 free vars, 266/266)
                      exit 1 on the DEPLOYED worker (512 matcher exceptions, free var `origPattern`, 249 violations)
```
23 of the new tests fail against the previous `next.config.js`. Built route table: 14 routes (start-url, 1 NetworkOnly, public-fuel-history, 11 static-asset caches).
Limits: no real-browser test of a SW `fetch` event or of Safari OAuth; the sandbox models Workbox's first-match rule.

## 10. Files Changed
Generated mechanically in the PR.

## 11. Known Risks / Remaining Questions
1. **Unresolved incident (NOT fixed here):** the browser-only 503 on `/api/auth/session`. Railway origin never emitted it
   (619 requests, 0 5xx in the window; the failing requests never reached the origin), no service worker was registered in the failing
   tab, Cloudflare showed `cf-cache-status: DYNAMIC` / no `Age` / no hit. Recommend Cloudflare Security → Events/Analytics
   (503 on that path, Oct 8 09:48–10:30Z, Oct 7 20:39Z on), then browser extensions / local network, if it recurs.
2. `/` is served by next-pwa's built-in `start-url` NetworkFirst route (unchanged). `app/page.tsx` is a client-only shell
   with no server-side session reads, so no per-user HTML — but a future server-rendered, per-user home would need revisiting.
3. Static-asset regexes (`.json/.xml/.csv`, images, js/css) are public by design; no route URL ends in such an extension
   (verified; and the contract tests navigations, so a future one would fail CI).
4. Public history endpoint can be up to 24 h stale after a 10 s network timeout — judged acceptable for a weekly series.
5. `public/sw.js` / `workbox-*.js` remain tracked yet regenerated each build (not committed here).
6. The sandbox is a model of Workbox routing, not Workbox itself.

## 12. Claude's Assessment
**READY FOR REVIEW** (security) — default-deny, artifact-verified, behaviour-preserving apart from one documented public cache.

## 13. Questions for ChatGPT
1. Is removing `apis`/`others`/`cross-origin` outright (vs retaining them with private paths excluded) the right call?
2. Should `/api/gas-price/history` remain cached at all, or is "NetworkOnly everywhere" the safer baseline?
3. Any request shape where `request.mode !== 'navigate'` misclassifies (e.g. prefetch, `mode:'same-origin'`, HTML form POST→GET redirect)?
4. Is the `with(Proxy)` free-variable detection sound, or can a serialized closure variable evade it?
5. Is changing the one `savedStationLivePrices` assertion acceptable, or should the old assertion have been preserved another way?

## 14. Requested Review Scope
1. `next.config.js` · 2. `scripts/check-sw-integrity.mjs` soundness · 3. `scripts/sw-contract.mjs` allowlist · 4. the changed `savedStationLivePrices` assertion · 5. §11 risks.

# ChatGPT Review Packet — Service worker: /api/auth/* never cached (hardening)

Template: `docs/reviews/CHATGPT_REVIEW_PACKET_TEMPLATE.md`. **Touches authentication behaviour in the
browser path → independent review recommended.** Risk: LOW-MEDIUM (next.config.js runtime caching).

## 1. Objective
Post-deploy browser testing saw `fetch('/api/auth/session')` fail in the browser (HTTP 503 / "Failed to fetch")
while curl got 200, making the app look signed out until a cache-bypassing request. Investigate whether the
service-worker API cache was responsible and, if confirmed, make `/api/auth/*` `NetworkOnly`.

## 2. Repository State
Branch `fix/auth-session-no-sw-cache` from `origin/main` @ `6987f18` (PR #66 merge). Diff:
`git diff --name-status origin/main...HEAD`.

## 3. What I Found — **the hypothesis is NOT confirmed**
- next-pwa **5.6.0** default `apis` entry already returns false for `/api/auth/*` (explicit exclusion, with a comment
  citing Safari OAuth, next-pwa issue #131); the `others` entry returns false for every `/api/` path; the extension
  regexes don't match. **`/api/auth/session` matched no runtime route at all** — it was never in the SW API cache.
- **No service worker was registered in the failing Chrome tab** (`getRegistrations()` = []), so a SW cache cannot explain
  that failure there. `fetch(..., {cache:'only-if-cached'})` found nothing in the HTTP cache either.
- **Railway HTTP logs for the incident window** (09:48–10:35 UTC Oct 8, deployment `9e16ce09`): 619 requests, **zero 5xx**;
  all 47 `/api/auth/session` requests that reached the origin returned 200. The failing in-page requests **never appear
  in the origin logs** → the 503 was not produced by the app or Railway. (The first window, Oct 7 20:39Z, is past log retention.)
- **Cloudflare:** every probe (plain, brotli, zstd/browser-like, repeated, query-string) returns `cf-cache-status: DYNAMIC`,
  no `Age`; even `/manifest.json` is DYNAMIC. **No independent evidence that Cloudflare cached `/api/auth/session`.**
  (My earlier report speculated an edge cache; this evidence does not support it and I retract it.)
- **A separate latent defect in the BUILT service worker:** the `apis` wrapper closes over `origPattern`; that closure
  is not serialized into `public/sw.js`. Production's live `sw.js` contains `origPattern` exactly once, never defined.
  Evaluating the built worker, every same-origin URL that reaches that predicate (all `/api/*` except 4 exclusions, and
  all pages) throws `ReferenceError: origPattern is not defined`. Workbox's `findMatchingRoute` has no try/catch, so the
  exception escapes the `fetch` listener and the browser falls through to the network. Net effect today: the `apis`,
  `others` and `cross-origin` runtime caches never run (accidentally safe). **Not fixed here (out of scope), see §11.**

## 4. What I Changed
| File | Change |
|---|---|
| `next.config.js` | Leading `NetworkOnly` predicate gains `(pathname.startsWith('/api/auth/') && request.mode !== 'navigate')`; `apis` wrapper gains an `/api/auth/` exclusion (both inline literals). Comment documents the contract and the separate defect. |
| `scripts/check-sw-auth.mjs`, `package.json` (`check:sw`), `.github/workflows/ci.yml` | Executes the **generated** `public/sw.js` in a sandbox with a stub Workbox and reports the first-match handler per URL. Fails closed (exit 1/2). CI runs it after `next build`. |
| `__tests__/swAuthNetworkOnly.test.ts` | 83 tests (80 always, 3 built-artifact with `VERIFY_BUILT_SW=1`). |

**Deliberate deviation from the brief:** auth *navigations* (OAuth callbacks, sign-in/out pages, emailed verify/reset
links) are **not** made NetworkOnly. next-pwa excludes `/api/auth/` on purpose so the SW doesn't intercept the OAuth
callback (Safari breakage, issue #131). Making them NetworkOnly would risk reintroducing that. Auth *fetches*
(session/csrf/providers/signin/…) are NetworkOnly; navigations remain un-intercepted exactly as before.

## 5. Architectural Decisions
Fix is **defence-in-depth, not a root-cause fix**: today it changes no observable network behaviour (a thrown matcher
→ network default; NetworkOnly → network). Its value: it removes a thrown exception for auth requests and makes
the "auth is never cached" guarantee explicit and CI-enforced, so a next-pwa upgrade, or someone repairing
`origPattern`, cannot silently start caching auth. A built-artifact check (not source assertions) because
config-level and built behaviour differ — `/api/fillups` is `NetworkFirst:apis` at config level but throws when built.

## 6. Security Impact
Reduces risk: auth responses can never be served from SW caches. No change to NextAuth, cookies, JWT, providers,
callbacks, CSRF. **Related exposure (not fixed):** if `origPattern` is repaired naively, the `apis` cache (NetworkFirst,
10 s timeout fallback, 24 h) would start caching **user-specific** `/api/*` (`/api/fillups`, `/api/admin/*`, `/api/activity`,
`/api/giveaway/*`, …) — stale data and cross-user leakage on shared browsers.

## 7. Data / Database Impact
None.

## 8. User / Business Impact
No intended user-visible change. Does **not** fix the sign-in/session symptom (root cause unexplained, §11).

## 9. Testing Performed
```
npm run check:crons → 22 routes, 20 scheduled, 2 exempt
npm test            → 163 files, 2783 passed | 3 skipped (the built-artifact group)
VERIFY_BUILT_SW=1   → swAuthNetworkOnly: 83 passed (incl. the 3 built-artifact tests)
npx tsc --noEmit    → exit 0
npm run build       → exit 0
npm run check:sw    → exit 0 on the fixed build; exit 1 (25 violations) on the unfixed build
```
Against the OLD `next.config.js`: 21 of the new tests fail. Built `sw.js` before/after: all 25 non-auth rows
identical, route count 16→16, auth fetches THROWS→NetworkOnly, auth navigations THROWS→not intercepted, and `"/api/auth/"`
appears twice in the built file. Limits: no browser-level test of Safari OAuth or of a real SW fetch event.

## 10. Files Changed
Generated mechanically in the PR.

## 11. Known Risks / Remaining Questions
1. **Root cause of the 503 is still unexplained.** Not the SW (none registered in that tab, and it couldn't have served
   it), not the origin (no 5xx, requests never arrived), no evidence of Cloudflare caching. Remaining suspects: Cloudflare
   edge (WAF/rate-limit/challenge) → someone with dashboard access should check **Security → Events / Analytics for 503s
   on `/api/auth/session`, Oct 8 09:48–10:30 UTC and Oct 7 20:39Z onward**; the browser/extension layer; or the local network.
2. `origPattern` ReferenceError in the built SW (production too) — separate PR recommended: make the `apis` predicate
   self-contained, and consider `NetworkOnly` for **all** `/api/*` (user-specific data).
3. `public/sw.js` and `public/workbox-*.js` are **tracked** in git yet regenerated by every build (dirty tree after any build).
4. `check:sw` prints the informational non-auth rows, including the `origPattern` THROWS rows, in CI logs; they don't fail the job.
5. First-window origin logs (Oct 7) unavailable (retention).

## 12. Claude's Assessment
**READY WITH KNOWN CONCERNS** — correct, tested hardening; but it is not the incident's fix and says so.

## 13. Questions for ChatGPT
1. Is excluding navigations from the new `NetworkOnly` predicate the right call versus the literal "all /api/auth/*"?
2. Any request shape (e.g. `mode: 'same-origin'` fetches, prefetch, `Request.destination`) where `request.mode !== 'navigate'` misclassifies an OAuth callback?
3. Is the sandboxed-evaluation approach in `check-sw-auth.mjs` faithful enough to Workbox's matching (regex same-origin rule, first-match)?
4. Should the `origPattern` defect be fixed in this PR instead of a separate one?

## 14. Requested Review Scope
1. `next.config.js` predicates · 2. `scripts/check-sw-auth.mjs` fidelity · 3. CI step · 4. the findings in §3 / §11.

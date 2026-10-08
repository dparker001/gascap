# Service-worker caching policy

**Status: CURRENT** — implemented 2026-10-08 (branch `fix/sw-integrity-api-caching`). Enforced in CI by
`npm run check:sw` against the **built** `public/sw.js`.

## Rule

> **Default-deny.** Nothing user-specific, private, location-dependent or freshness-sensitive is ever served from a
> service-worker cache. A response may be cached only if it is public, identical for every user, safe to serve stale,
> and intentionally cacheable. If uncertain: `NetworkOnly`. Correctness and privacy outrank hit rate.

## What the worker does (next.config.js `runtimeCaching`)

| Traffic | Strategy |
|---|---|
| any same-origin `/api/*` via `fetch()`/XHR | **NetworkOnly** (new routes are private by default) |
| `/gas/*`, `/api/vehicles*`, `/api/user/profile*`, `/api/favorites*` — every request mode | **NetworkOnly** (historical, unchanged) |
| `/api/*` **navigations** (OAuth callbacks, sign-in/out, emailed verify/unsubscribe links, downloads) | **not intercepted** — the browser handles them. next-pwa keeps the SW away from `/api/auth/` on purpose (Safari OAuth breakage, next-pwa issue #131) |
| `/api/gas-price/history` | **NetworkFirst**, cache `public-fuel-history`, 10 s timeout, 24 h / 8 entries — the **only** cached API |
| pages, RSC payloads, cross-origin requests | **not intercepted** (never runtime-cached) |
| fonts, images, js, css, audio/video, next-data, static json | next-pwa static-asset defaults, unchanged |

Why the single public exception: `/api/gas-price/history` is the EIA national Regular weekly series. It is identical for
every user, takes only `?weeks=`, changes once a week, and a stale chart is harmless. The other public fuel-price routes
are **not** cacheable: `/api/gas-price` is location/IP dependent; `/national` and `/pulse` are freshness-sensitive (stale
prices have already caused user-visible bugs here); `/api/electricity-price` is location dependent.

## Route inventory (`node scripts/sw-route-inventory.mjs`)

156 route handlers, **104 can answer a GET** (only GET is interceptable here):

| Class | Handlers | GET | Examples | Policy |
|---|---:|---:|---|---|
| USER (session / plan) | 62 | 38 | `/api/fillups`, `/api/fillups/savings`, `/api/activity`, `/api/user/*`, `/api/favorites`, `/api/vehicles`, `/api/giveaway/*`, `/api/rental-sessions` | NetworkOnly |
| ADMIN | 26 | 19 | `/api/admin/engagement-baseline`, `/api/admin/users`, `/api/admin/rental-pilot` | NetworkOnly |
| AUTH | 7 | 2 | NextAuth session/csrf/providers/signin/callback + register/verify/reset | NetworkOnly (fetch); navigations not intercepted |
| CRON / webhook | 27 | 23 | `/api/cron/*`, Stripe/RevenueCat webhooks | NetworkOnly (server-to-server; never browser-reachable in normal use) |
| GAS (`/gas/*`) | 5 | 4 | `/gas/nearby`, `/gas/report-price`, `/gas/community-prices` | NetworkOnly |
| PUBLIC | 29 | 18 | see below | NetworkOnly, except the one allowlisted endpoint |

PUBLIC GET routes (hand-reviewed): `apple-app-site-association`, `assetlinks`, `electricity-price`, `email/unsubscribe`
(state-changing GET by id), `founding/status`, `fueleconomy`, `gas-price`, **`gas-price/history` (cached)**, `gas-price/national`,
`gas-price/pulse`, `mpg-lookup`, `partner-stations`, `qr`, `stats/aggregate`, `stripe/session-amount` (capability URL), `user-count`,
`vin`, and the `/q/[code]` redirect. The classification is a heuristic (session / admin / secret signals in the handler) and
is **not what the policy depends on** — the policy is default-deny for every `/api/`, so a misclassified route is still protected.

## Why the previous config was dangerous (post-mortem)

The old `apis` wrapper closed over `origPattern`. Workbox serializes predicates with `Function#toString`, so the closure
was lost: the built worker called an undefined `origPattern`, threw `ReferenceError` on every URL that reached it, and
the router (no try/catch) fell through to the network. That kept next-pwa's default `apis` / `others` / `cross-origin`
caches dead — accidentally safe. **Repairing the closure would have enabled** `NetworkFirst` (10 s timeout, 24 h stale
fallback) for `/api/fillups`, `/api/admin/*`, `/api/activity`… **and for authenticated pages / RSC payloads**: stale data,
and one user's data shown to the next on a shared browser. Those three default caches are now removed outright.

## Adding a cacheable endpoint

All five must be true and written into the PR: public; identical for every user and request; no cookies / IP /
location / query-derived personalisation; safe to serve stale for the TTL; intentionally cacheable. Then update **all
of**: `next.config.js` (inline literals — predicates must be fully self-contained), `PUBLIC_CACHEABLE` in
`scripts/sw-contract.mjs`, and this document. `npm run check:sw` will fail until they agree.

## What `npm run check:sw` guarantees (against the built file)

It evaluates `public/sw.js` in a sandbox and fails (exit 1) if: any matcher throws; any unserialized free variable is
referenced (or `origPattern` appears); a private route can reach `NetworkFirst`/`CacheFirst`/`StaleWhileRevalidate`/
`CacheOnly` or any named cache; an auth fetch is not `NetworkOnly`; an auth navigation is intercepted; a historical
`NetworkOnly` route regresses; or any other contract expectation (public allowlist, pages, static assets) differs. Exit 2
if the worker cannot be executed or registers no routes. The contract is **generated from the live route inventory**, so a
new API route is checked automatically.

## Not covered by this policy

The unexplained browser-only `503` on `/api/auth/session` observed on 2026-10-08 is **not** caused by, and **not** fixed
by, the service worker (none was registered in the failing tab; Railway origin logs show zero 5xx and never saw the
failing requests; Cloudflare reported `cf-cache-status: DYNAMIC` with no cache hits). It remains an open incident.
If it recurs, check Cloudflare Security → Events / Analytics for 503s on that path, then browser extensions and the
local network.

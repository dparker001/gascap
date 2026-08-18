# Content-Security-Policy — staged rollout plan

**Status: PLANNED — not implemented.** Written during hardening sprint 1
(2026-08-18). Nothing in this document is live.

---

## Current state

`next.config.js` sets, for `/(.*)`:

`X-Frame-Options: DENY` · `X-Content-Type-Options: nosniff` ·
`X-DNS-Prefetch-Control: on` · `Referrer-Policy: strict-origin-when-cross-origin` ·
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` ·
`Permissions-Policy: microphone=()`

**No CSP.** That is the gap — and also why adding one carelessly is dangerous:
nothing today is constrained, so every violation surfaces at once.

## Why this was not implemented in sprint 1

The brief said to implement only if it could be validated safely. It cannot,
yet, for a specific reason: **the app relies on inline scripts.**
`app/layout.tsx` injects the Meta Pixel via `dangerouslySetInnerHTML`, as does
`components/GoogleAnalytics.tsx`. Any meaningful `script-src` breaks both, and
analytics failing is silent — no error a user reports, just a gap in data
nobody notices for weeks.

Blocking a Stripe or Google Places call, by contrast, breaks checkout or Find
Gas loudly. Both outcomes are unacceptable from an untested header change.

## Required-origin inventory

Collected by grepping the source. **Verify against real traffic before
enforcing** — a grep cannot see origins reached via redirect or SDK.

| Directive | Origins | Why |
|---|---|---|
| `default-src` | `'self'` | baseline |
| `script-src` | `'self'`, `'unsafe-inline'` (see below), `https://connect.facebook.net`, `https://*.googletagmanager.com`, `https://pagead2.googlesyndication.com`, `https://js.stripe.com`, `https://cdn.onesignal.com` | Meta Pixel, GA, AdSense, Stripe.js, OneSignal |
| `connect-src` | `'self'`, `https://api.eia.gov`, `https://places.googleapis.com`, `https://nominatim.openstreetmap.org`, `https://ipapi.co`, `https://api.stripe.com`, `https://*.onesignal.com`, `https://fueleconomy.gov`, `https://www.google-analytics.com` | fuel prices, geocoding, payments, push, EPA lookups |
| `img-src` | `'self'`, `data:`, `blob:`, `https://cdn.jsdelivr.net`, `https://api.qrserver.com`, `https://*.googleapis.com`, `https://*.gstatic.com`, `https://www.facebook.com` | base64 receipt/rental photos (`data:`), car-logos CDN, QR codes, Places photos, pixel |
| `style-src` | `'self'`, `'unsafe-inline'` | Tailwind + React inline styles |
| `frame-src` | `https://js.stripe.com`, `https://hooks.stripe.com` | Stripe 3-D Secure |
| `worker-src` | `'self'` | next-pwa service worker |
| `frame-ancestors` | `'none'` | matches existing `X-Frame-Options: DENY` |
| `base-uri` | `'self'` | |
| `form-action` | `'self'`, `https://checkout.stripe.com` | |

**`data:` in `img-src` is mandatory.** Receipt, gauge and rental photos are
stored and rendered as base64 data URLs. Omitting it blanks every stored photo
— including the fuel-fee dispute evidence.

## Staged rollout

**Stage 1 — Report-Only, no enforcement (1–2 weeks).**
Add `Content-Security-Policy-Report-Only` with the policy above plus
`report-uri` pointing at a new `/api/csp-report` endpoint that logs violations.
Nothing breaks; violations are recorded. This is the only way to discover the
origins the grep missed.

**Stage 2 — Triage.** Review reports. Expect noise from browser extensions —
distinguish those from real app origins. Add legitimate misses.

**Stage 3 — Remove `'unsafe-inline'` from `script-src`.** The real work.
Either move the Meta Pixel and GA to nonce-based `<Script>` tags (Next.js
supports a nonce via middleware) or accept `'unsafe-inline'` permanently and
document that decision. **A CSP with `'unsafe-inline'` in `script-src` gives
little XSS protection** — worth stating plainly rather than shipping a policy
that looks protective and isn't.

**Stage 4 — Enforce**, starting with the narrow directives that carry real
value and low risk (`frame-ancestors`, `base-uri`, `form-action`, `object-src
'none'`), then the rest once Report-Only is quiet.

## Capacitor consideration

The iOS/Android shells load `https://www.gascap.app` remotely, so the policy
applies inside the WebView too. `capacitor://` and `ionic://` schemes may
appear in violation reports depending on bridge configuration. **Test a native
build against Report-Only before enforcing** — a CSP that breaks the WebView
requires a full Codemagic rebuild to fix, not a web deploy.

## Recommendation

Sprint 2: Stages 1–2 (Report-Only + triage). Cheap, zero risk, and produces the
data needed to do stages 3–4 without guessing.

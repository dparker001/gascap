# GasCap™ Technical Due Diligence Checklist

> **INTERNAL DOCUMENT — NOT FOR PUBLIC DISTRIBUTION**
> Status as of May 2026 codebase audit.

**Status Legend:** ✅ Complete | ⚠️ Needs Review | ❌ Not Started | N/A Not Applicable

---

## Code Ownership and IP

| Item | Status | Notes |
|---|---|---|
| All code written by or commissioned by Gas Capacity LLC | ✅ | Sole founder codebase |
| No open-source code with copyleft (GPL) obligations that infect the product | ⚠️ | TODO: run license audit on all dependencies |
| No third-party code copied in violation of its license | ✅ | Standard npm packages only |
| No former-employer IP concerns | ✅ | Founder-built from scratch |
| No co-founder or contractor IP assignments needed | ✅ | Sole founder |
| IP assignment agreement in place for all contributors | N/A | No outside contributors currently |

---

## Source Control

| Item | Status | Notes |
|---|---|---|
| Code is in a private Git repository | ✅ | GitHub |
| Main branch is protected | ⚠️ | TODO: verify branch protection rules are enabled |
| Commit history is clean (no secrets committed) | ⚠️ | TODO: run `git log --all --full-history` to check for accidentally committed env files |
| `.env.local` is in `.gitignore` | ✅ | Standard Next.js setup |
| No large binary files committed | ✅ | |
| Meaningful commit messages | ✅ | Recent commits show clear intent |

---

## Architecture and Technology

| Item | Status | Notes |
|---|---|---|
| Framework: Next.js 14 App Router + TypeScript | ✅ | Modern, well-supported |
| Database: PostgreSQL via Prisma ORM | ✅ | Railway-hosted PostgreSQL |
| Authentication: NextAuth v4 (JWT + CredentialsProvider) | ✅ | Industry standard |
| Payment: Stripe (server-side only, webhook-verified) | ✅ | PCI-compliant |
| Email: Resend | ✅ | Transactional + marketing |
| Push: OneSignal | ✅ | Web push |
| AI: Anthropic Claude (AI chat), GPT-4o Vision (receipt scan) | ⚠️ | Two AI providers — confirm which is used for which feature |
| Styling: Tailwind CSS | ✅ | |
| PWA: next-pwa + Workbox | ✅ | Service worker, offline support |
| Deployment: Railway (caring-integrity project) | ✅ | Single service, PostgreSQL |

---

## Deployment and Operations

| Item | Status | Notes |
|---|---|---|
| Production environment is separate from development | ✅ | Railway production + local dev |
| Environment variables are stored in Railway (not committed) | ✅ | |
| Deployment is automated (git push → Railway) | ✅ | Railway auto-deploy from GitHub |
| Rollback capability exists | ⚠️ | Railway supports rollback via dashboard; no automated rollback trigger |
| Cron jobs are running and monitored | ✅ | GitHub Actions (8 daily crons) |
| Error logging is in place | ⚠️ | `app/error.tsx` and `app/global-error.tsx` exist; no external error tracking (Sentry) configured |
| Uptime monitoring | ⚠️ | TODO: confirm if uptime monitoring is configured (UptimeRobot, etc.) |
| Database backups | ⚠️ | Railway PostgreSQL includes automated backups; verify backup retention period and test restore |

---

## Environment Variables and Secrets

| Item | Status | Notes |
|---|---|---|
| All secrets in environment variables (never in code) | ✅ | Verified in code audit |
| API keys are server-side only where required | ✅ | Google Maps API key is never sent to client |
| Stripe webhook secret is used for signature verification | ✅ | `STRIPE_WEBHOOK_SECRET` in webhook handler |
| NEXTAUTH_SECRET is set | ✅ | Required for JWT signing |
| Cron endpoint is authenticated (`CRON_SECRET`) | ✅ | GitHub Actions passes secret to cron endpoints |
| No hard-coded credentials in source | ✅ | Code audit confirms |

---

## API Key Inventory

| Service | Key Name | Where Used | Rotation Status |
|---|---|---|---|
| Stripe | STRIPE_SECRET_KEY | Checkout, portal, webhook | ⚠️ Unknown rotation date |
| Stripe | STRIPE_WEBHOOK_SECRET | Webhook verification | ⚠️ Unknown rotation date |
| Anthropic | GASCAP_ANTHROPIC_KEY | AI Fuel Advisor | ⚠️ Unknown rotation date |
| EIA | EIA_API_KEY | Gas price lookups | ⚠️ Unknown rotation date |
| Google Maps | GOOGLE_MAPS_API_KEY | Server-side Maps/Places | ⚠️ Unknown rotation date |
| OneSignal | ONESIGNAL_REST_API_KEY | Push notifications | ⚠️ Unknown rotation date |
| Resend | RESEND_API_KEY | Email sending | ⚠️ Unknown rotation date |
| GHL | GHL_API_KEY (PIT) | CRM sync | ✅ Rotated Apr 27 2026 |
| NextAuth | NEXTAUTH_SECRET | JWT | ⚠️ Unknown rotation date |

**TODO before acquisition:** Document rotation policy for all API keys; rotate any keys that haven't been rotated in 12+ months.

---

## Dependency Security

| Item | Status | Notes |
|---|---|---|
| `npm audit` clean (no critical/high vulnerabilities) | ⚠️ | TODO: run `npm audit` and resolve critical issues |
| Dependencies are pinned or range-locked | ⚠️ | Uses `^` ranges in package.json (standard but not pinned) |
| No abandoned dependencies (last release >2 years ago, no security updates) | ⚠️ | TODO: audit dependency health |
| No known CVEs in production dependencies | ⚠️ | TODO: run dependency vulnerability scan |

---

## Security Practices

| Item | Status | Notes |
|---|---|---|
| Passwords are hashed (bcryptjs) | ✅ | |
| JWT tokens expire | ✅ | NextAuth session management |
| SQL injection protection | ✅ | Prisma ORM parameterizes all queries |
| XSS protection | ✅ | Next.js sanitizes JSX by default; dangerouslySetInnerHTML is used in Layout for inline scripts only (Meta Pixel, GA4) |
| CSRF protection | ✅ | NextAuth includes CSRF protection |
| Stripe webhook signature verification | ✅ | |
| Input validation on API routes | ⚠️ | Most routes validate; TODO: audit all API routes for missing validation |
| Rate limiting | ❌ | No rate limiting on API routes. Authentication routes should be rate-limited before production scaling. |
| Headers security (CSP, HSTS, etc.) | ⚠️ | TODO: audit response headers; consider adding Security headers via `next.config.js` |

---

## Logging and Monitoring

| Item | Status | Notes |
|---|---|---|
| Email sends are logged (PostgreSQL) | ✅ | EmailLog model |
| Account deletions are logged | ✅ | DeletedAccountLog model |
| Campaign events are logged | ✅ | JSON file + PostgreSQL for placements |
| Application errors are logged | ⚠️ | Error boundaries exist; no external error reporting service |
| External error reporting (Sentry, etc.) | ❌ | Not configured |
| Database query logging | ⚠️ | Prisma logs to console in dev; production logging configured at Railway level |

---

## Testing

| Item | Status | Notes |
|---|---|---|
| Unit tests | ❌ | No test files found in codebase |
| Integration tests | ❌ | |
| End-to-end tests | ❌ | |
| Calculation engine has tests | ❌ | `lib/calculations.ts` comments say "easy to test" but no tests exist |
| Manual QA process documented | ⚠️ | Informal; no formal test plan |

**Note:** The absence of automated tests is a known gap. The calculation engine (`lib/calculations.ts`) is pure functions with no side effects and is an ideal candidate for unit testing. Before acquisition conversations, at minimum the calculation engine should have test coverage.

---

## CI/CD Pipeline

| Item | Status | Notes |
|---|---|---|
| Automated build on push | ✅ | Railway builds on git push |
| Cron job automation | ✅ | GitHub Actions (8 daily crons) |
| Build failure notifications | ⚠️ | Railway sends build failure emails; GitHub Actions sends workflow failure emails |
| Type checking in CI | ⚠️ | TypeScript compilation happens during Railway build; no separate CI step |
| Linting in CI | ⚠️ | ESLint runs during build (Next.js default); no separate CI step |
| Deployment approval step | ❌ | Auto-deploys on push to main — no staging environment or approval gate |

---

## Performance

| Item | Status | Notes |
|---|---|---|
| Lighthouse score ≥90 (mobile) | ⚠️ | TODO: run Lighthouse audit |
| Core Web Vitals passing | ⚠️ | TODO: check GA4 Core Web Vitals report |
| Images are optimized | ✅ | Next.js Image component; sharp for icon generation |
| Bundle size is reasonable | ⚠️ | TODO: run `next build` with bundle analyzer |
| API routes have caching where appropriate | ⚠️ | Gas price API has per-session caching; other routes may not |
| Database queries are indexed | ✅ | EmailLog, CampaignPlacement have appropriate indexes in schema |
| No N+1 query patterns | ⚠️ | TODO: review Prisma query patterns in fleet and analytics routes |

---

## PWA Behavior

| Item | Status | Notes |
|---|---|---|
| Manifest.json is complete | ✅ | Icons, name, theme color, start URL |
| Service worker is registered | ✅ | next-pwa + Workbox |
| Offline mode works for calculator | ✅ | Core calculator functions client-side |
| Push notification permissions flow | ✅ | OneSignal provider in layout |
| iOS installability (apple-touch-icon, apple-web-app) | ✅ | Metadata in layout |
| Android installability | ✅ | Manifest configured |

---

## Navigation / Maps Integration

| Item | Status | Notes |
|---|---|---|
| Google Maps handoff URL construction | ✅ | `lib/googleMaps.ts` — privacy-safe |
| Waze handoff URL construction | ✅ | `lib/waze.ts` — privacy-safe |
| No API key in client-side Maps URLs | ✅ | Public URL scheme, no key required |
| Server-side Google Maps API key never exposed to client | ✅ | Only used in `/api/maps/*` routes |
| Route-based planning enabled in production | ⚠️ | Requires GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true on Railway |

---

## Plan Gating

| Item | Status | Notes |
|---|---|---|
| Feature access helper exists | ✅ | `lib/featureAccess.ts` |
| Trial override is handled | ✅ | `isProTrial` field on User |
| Ambassador Pro-for-life override is handled | ✅ | `ambassadorProForLife` field on User |
| Plan checks on all API routes | ⚠️ | Most routes check; some may inline plan string comparisons inconsistently |
| Plan gating is server-side (not just client-side) | ✅ | API routes re-fetch user plan from DB for critical gates |

---

## Scalability

| Item | Status | Notes |
|---|---|---|
| Stateless API routes | ✅ | Next.js App Router API routes are stateless |
| Database scales with PostgreSQL | ✅ | Railway PostgreSQL can be scaled up |
| Campaign events stored in JSON file (scale concern) | ⚠️ | The `data/campaign-events.json` file is a flat file — will degrade at high volume. Should be migrated to PostgreSQL before scaling. |
| Fill-up logs stored in JSON file (scale concern) | ⚠️ | `data/fillups.json` — same issue. Migrate to PostgreSQL for >10k users. |
| Trip data stored in JSON file (scale concern) | ⚠️ | `data/trips.json` — same issue. |
| Single Railway service (single point of failure) | ⚠️ | No redundancy; Railway's reliability is the sole uptime guarantee |

---

## Documentation

| Item | Status | Notes |
|---|---|---|
| README.md exists | ❌ | No root README.md found in codebase |
| Architecture documentation | ✅ | `docs/SYSTEM.md` |
| API documentation | ❌ | No API reference document |
| Codebase onboarding guide | ❌ | No CONTRIBUTING.md |
| Email template documentation | ✅ | Code is self-documented |
| Environment variable documentation | ⚠️ | Partially documented in MEMORY.md and env files |

---

*Internal strategic document. May 2026.*

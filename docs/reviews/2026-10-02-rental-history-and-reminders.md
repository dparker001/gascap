# Protected-Path Review: Rental History Safe Subset

**Status:** APPROVED (exact commit only)
**Date:** 2026-10-02
**Feature:** GasCap Rental History safe subset (branch `feat/rental-history-details`)
**Reviewed commit:** `df958b195dd9cbd04bb52cb943b685be255d6936`
**Protected path:** `app/api/rental-sessions/route.ts` (CR-1 protected-path guard)
**Approved by:** Don Parker, after independent review by ChatGPT

## Scope of this approval

This approval applies ONLY to the exact commit and path above. Any later commit
that touches `app/api/rental-sessions/route.ts` is unreviewed until its own SHA is
reviewed and recorded in `docs/reviews/protected-path-exceptions.json`.

## The change (GET handler only)

- `GET /api/rental-sessions` is unchanged for every status except `completed`
  (same `{ sessions }` response).
- For `status=completed` only: one additional batched query,
  `prisma.fillup.findMany({ where: { userId, rentalSessionId: { in: ids } }, select: { rentalSessionId, gallonsPumped, totalCost, pricePerGallon } })`,
  grouped into `fillupsBySession` and returned alongside `sessions`.
- Adds `import { prisma } from '@/lib/prisma'`.

## Rationale

- Since the Phase 3A cutover (2026-08-25), rental refuels are written only as
  canonical `Fillup` rows; `RentalSession.refuelLogs` is frozen legacy data. The
  Rental History recap read `refuelLogs` only, so every post-cutover rental showed
  no gallons, $0 spent and no savings. The list needs the canonical rows.
- Recap rule (unchanged by this review): canonical Fillups if any, else legacy
  `refuelLogs`, never mixed. Production read-only inventory (2026-10-02) found 0
  rentals containing both sources.

## Ownership / security

- Candidate rental ids come from `getRentalSessionsForUser(userId)`, so they
  already belong to the signed-in user.
- The Fillup query independently requires `userId`, because
  `Fillup.rentalSessionId` is a loose link with no database foreign key. Another
  user's mis-associated row can never contribute to this user's recap.
- Exactly one Fillup query per request (no N+1); only four numeric fields are
  selected.
- Related hardening in the same commit (not a protected path): `getRentalFillups()`
  in `lib/rentalFillups.ts` now filters on `userId` as well as `rentalSessionId`.

## Not changed

- POST (create), its Pro gate and validation.
- No entitlement, subscription, payment, pricing or commercial-copy behavior.
- No reminder, cron or timezone behavior (that work is on hold for a separate
  event-timezone redesign).

## Test evidence (at the reviewed commit)

- `__tests__/rentalRecapSource.test.ts`: 6/6. Asserts the batch `where` is exactly
  `{ userId, rentalSessionId: { in: [...] } }` and that other statuses issue no
  Fillup query and keep the original response shape.
- `__tests__/rentalFillups.test.ts`: 36/36, including a test that plants another
  user's Fillup carrying this session's id. It failed before the `getRentalFillups()`
  hardening and passes after.
- Full suite at the reviewed commit: 1897 passed, 1 failed. The single failure
  was the CR-1 guard flagging this commit as not yet reviewed (expected
  fail-closed behavior, resolved by recording this exception).
- `npx tsc --noEmit` clean; `npm run build` compiled successfully.

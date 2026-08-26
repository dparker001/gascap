/**
 * GasCap™ Rental Return Assistant — Phase 3A canonical fillup architecture
 * (2026-08-25).
 *
 * CORE INVARIANT — read before touching this file (2026-08-25 correction):
 *
 *   Fillup                           = historical fuel TRANSACTION record.
 *   RentalSession.currentFuelGallons = latest INDEPENDENTLY observed/
 *                                      estimated CURRENT tank state.
 *
 * These are NOT the same thing and a transaction record can never be used to
 * reconstruct current tank state, even the most recent one: fuel is consumed
 * by driving after a fill, and the renter may have independently updated the
 * current-fuel reading (a gauge check, a manual correction) after logging a
 * transaction. Editing or deleting a historical record therefore can only
 * ever be a guess about "what's in the tank right now," never a fact.
 *
 * Required behavior:
 *   CREATE — MAY update currentFuelGallons, because a create always
 *            represents fuel being added right now (see
 *            bumpCurrentFuelGallonsOnCreate()).
 *   EDIT   — MUST NOT modify currentFuelGallons, even for the single most
 *            recent transaction.
 *   DELETE — MUST NOT modify currentFuelGallons, even for the single most
 *            recent transaction.
 *
 * An earlier draft of this module special-cased "the most recent
 * transaction" to adjust currentFuelGallons on edit/delete — that was wrong
 * (it silently overwrote a separately-observed current reading with a guess
 * derived from history) and has been removed. Every branch above is covered
 * by __tests__/rentalFillups.test.ts.
 *
 * RentalSession.refuelLogs is now FROZEN for new writes — see logRefuel() in
 * lib/rentalSessions.ts, no longer called from any live route. It remains
 * readable for historical sessions created before this cutover (Phase 3B
 * will address a read-only production inventory + migration decision; no
 * backfill happens here).
 */
import { randomUUID } from 'crypto';
import { prisma } from './prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { fromPrisma, updateFillup as updateFillupGeneric, deleteFillup as deleteFillupGeneric, type Fillup } from './fillups';
import { recordAnalyticsEvent } from './analyticsEvents';

export type RentalFillupType = 'trip' | 'final_return';

/** Any row this module returns is a rental-linked Fillup — narrowed for
 *  callers so `rentalSessionId`/`fillupType` don't need re-checking. */
export type RentalFillup = Fillup & { rentalSessionId: string; fillupType: RentalFillupType };

function toRentalFillup(f: Fillup): RentalFillup {
  return f as RentalFillup;
}

/** True only when `err` is a Postgres unique-violation surfaced by Prisma. */
function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Roll a brand-new fill into currentFuelGallons — a *create* always
 * represents fuel added right now, so this is always safe regardless of
 * where the new row lands chronologically relative to other fills.
 *
 * Concurrency (2026-08-25 correction): this MUST be a single atomic SQL
 * statement, not a JS-side read-then-write. The earlier version computed the
 * new value from a `session` snapshot fetched before the Fillup insert —
 * under two concurrent creates for the same session, both reads see the same
 * stale currentFuelGallons and the second UPDATE silently overwrites the
 * first's contribution (a classic lost update). This raw UPDATE instead
 * computes the new value from the row's LIVE value at the moment Postgres
 * applies it (a single `UPDATE ... SET x = x + $1` is atomic per-row), so two
 * concurrent trip fills for the same session both land, in whichever order
 * Postgres serializes them. Returns the PrismaPromise so the caller can run
 * it inside the same $transaction as the Fillup insert.
 */
function bumpCurrentFuelGallonsOnCreateSql(sessionId: string, gallonsAdded: number, now: string) {
  return prisma.$executeRaw`
    UPDATE "RentalSession"
    SET "currentFuelGallons" = CASE
          WHEN "fuelTankCapacityGallons" IS NOT NULL
            THEN LEAST(COALESCE("currentFuelGallons", 0) + ${gallonsAdded}, "fuelTankCapacityGallons")
          ELSE COALESCE("currentFuelGallons", 0) + ${gallonsAdded}
        END,
        "currentFuelSource" = 'RECEIPT',
        "currentFuelUpdatedAt" = ${now},
        "updatedAt" = ${now}
    WHERE "id" = ${sessionId}
  `;
}

function vehicleNameFor(session: {
  vehicleYear: string | null; vehicleMake: string | null; vehicleModel: string | null; rentalCompany: string;
}): string {
  return [session.vehicleYear, session.vehicleMake, session.vehicleModel].filter(Boolean).join(' ').trim()
    || session.rentalCompany
    || 'Rental car';
}

// ── Create ───────────────────────────────────────────────────────────────

export interface CreateRentalFillupInput {
  gallonsPumped:   number;
  pricePerGallon?: number;
  totalCost?:      number;
  stationName?:    string;
  stationLat?:     number;
  stationLng?:     number;
  odometerReading?: number;
  receiptThumb?:   string;
  fillupType:      RentalFillupType;
  /** Required — a client-generated idempotency identifier. A retried
   *  submission (double-tap, dropped response, offline retry) with the same
   *  id returns the original row rather than creating a second one. */
  clientRefuelId:  string;
}

export type CreateRentalFillupResult =
  | { outcome: 'created';            fillup: RentalFillup }
  | { outcome: 'duplicate';          fillup: RentalFillup } // idempotent retry of the same clientRefuelId
  | { outcome: 'final_return_exists'; fillup: RentalFillup } // a final_return already exists for this session
  | { outcome: 'not_found' }
  | { outcome: 'invalid' };

export async function createRentalFillup(
  userId: string, rentalSessionId: string, input: CreateRentalFillupInput,
): Promise<CreateRentalFillupResult> {
  if (!(input.gallonsPumped > 0)) return { outcome: 'invalid' };
  if (input.fillupType !== 'trip' && input.fillupType !== 'final_return') return { outcome: 'invalid' };
  if (!input.clientRefuelId) return { outcome: 'invalid' };
  // Fillup.pricePerGallon/totalCost are non-nullable Float columns (shared
  // with every personal fillup — see the Phase 3A correction report for why
  // making them nullable was rejected as substantial unrelated scope). $0.00
  // means free fuel, never "unknown" — so a rental fill MUST supply at least
  // one real price signal; the other is derived from it below, never
  // defaulted to 0.
  if (input.pricePerGallon == null && input.totalCost == null) return { outcome: 'invalid' };

  const session = await prisma.rentalSession.findFirst({ where: { id: rentalSessionId, userId } });
  if (!session) return { outcome: 'not_found' };

  // App-level pre-check for a friendly error message. The actual
  // concurrency-safe guarantee is the partial unique index added in
  // scripts/add-rental-fillup-columns.mjs (Fillup_one_final_return_per_rental)
  // — this check alone cannot prevent a race between two concurrent requests.
  if (input.fillupType === 'final_return') {
    const existingFinal = await prisma.fillup.findFirst({ where: { rentalSessionId, fillupType: 'final_return' } });
    if (existingFinal) return { outcome: 'final_return_exists', fillup: toRentalFillup(fromPrisma(existingFinal)) };
  }

  const now = new Date().toISOString();
  // Both fields are always derivable now that at least one real price signal
  // is guaranteed present (checked above) — never a fabricated 0.
  const resolvedPricePerGallon = input.pricePerGallon
    ?? Math.round((input.totalCost! / input.gallonsPumped) * 100) / 100;
  const resolvedTotalCost = input.totalCost
    ?? Math.round(input.gallonsPumped * input.pricePerGallon! * 100) / 100;

  try {
    // Atomicity (2026-08-25 correction): the Fillup insert and the
    // currentFuelGallons update must both commit or neither does — a
    // successful rental fill must never leave a Fillup row with no
    // corresponding tank-state update, or vice versa. $transaction's array
    // form runs both statements in one DB transaction; if the create()
    // throws (e.g. a unique-constraint collision), the raw UPDATE never
    // applies and nothing is left orphaned.
    const [created] = await prisma.$transaction([
      prisma.fillup.create({
        data: {
          id:              randomUUID(),
          userId,
          vehicleId:       session.vehicleId ?? null,
          vehicleName:     vehicleNameFor(session),
          date:            now.slice(0, 10),
          filledAt:        now,
          gallonsPumped:   input.gallonsPumped,
          pricePerGallon:  resolvedPricePerGallon,
          totalCost:       resolvedTotalCost,
          odometerReading: input.odometerReading ?? null,
          stationName:     input.stationName ?? null,
          stationLat:      input.stationLat ?? null,
          stationLng:      input.stationLng ?? null,
          receiptThumb:    input.receiptThumb ?? null,
          rentalSessionId,
          fillupType:      input.fillupType,
          clientRefuelId:  input.clientRefuelId,
          createdAt:       now,
        },
      }),
      bumpCurrentFuelGallonsOnCreateSql(rentalSessionId, input.gallonsPumped, now),
    ]);

    const eventType = input.fillupType === 'final_return' ? 'rental_final_fill_logged' : 'rental_fill_logged';
    try {
      await recordAnalyticsEvent({
        eventType, originPlatform: 'unknown', emitter: 'server', userId,
        idempotencyKey: `${eventType}:${created.id}`,
      });
    } catch (e) { console.error(`[GasCap analytics] ${eventType} write failed:`, e); }

    return { outcome: 'created', fillup: toRentalFillup(fromPrisma(created)) };
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;

    // Could be either unique constraint racing: clientRefuelId (this exact
    // retry already succeeded) or the final_return partial index (a
    // concurrent request won the final-return slot first). Check both.
    const byClientId = await prisma.fillup.findFirst({ where: { clientRefuelId: input.clientRefuelId } });
    if (byClientId) return { outcome: 'duplicate', fillup: toRentalFillup(fromPrisma(byClientId)) };

    const existingFinal = await prisma.fillup.findFirst({ where: { rentalSessionId, fillupType: 'final_return' } });
    if (existingFinal) return { outcome: 'final_return_exists', fillup: toRentalFillup(fromPrisma(existingFinal)) };

    throw err;
  }
}

// ── Read ─────────────────────────────────────────────────────────────────

/** Canonical Fillup rows for a rental, newest first. Empty for a session
 *  that predates Phase 3A and only has legacy refuelLogs — callers must fall
 *  back to session.refuelLogs in that case (see RentalDashboard.tsx). */
export async function getRentalFillups(userId: string, rentalSessionId: string): Promise<RentalFillup[]> {
  const session = await prisma.rentalSession.findFirst({ where: { id: rentalSessionId, userId } });
  if (!session) return [];
  const rows = await prisma.fillup.findMany({
    where:   { rentalSessionId },
    orderBy: [{ filledAt: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map((r) => toRentalFillup(fromPrisma(r)));
}

// ── Update ───────────────────────────────────────────────────────────────

export interface UpdateRentalFillupInput {
  gallonsPumped?:   number;
  pricePerGallon?:  number;
  totalCost?:       number | null;
  stationName?:     string;
  stationLat?:      number | null;
  stationLng?:      number | null;
  odometerReading?: number;
  receiptThumb?:    string;
  fillupType?:      RentalFillupType;
}

export type UpdateRentalFillupResult =
  | { outcome: 'updated';             fillup: RentalFillup }
  | { outcome: 'final_return_exists'; fillup: RentalFillup }
  | { outcome: 'not_found' };

export async function updateRentalFillup(
  userId: string, rentalSessionId: string, fillupId: string, patch: UpdateRentalFillupInput,
): Promise<UpdateRentalFillupResult> {
  const session = await prisma.rentalSession.findFirst({ where: { id: rentalSessionId, userId } });
  if (!session) return { outcome: 'not_found' };

  const existing = await prisma.fillup.findFirst({ where: { id: fillupId, userId, rentalSessionId } });
  if (!existing) return { outcome: 'not_found' };

  // Reclassifying an existing trip fill to final_return must respect the
  // same one-per-rental invariant as creation.
  if (patch.fillupType === 'final_return' && existing.fillupType !== 'final_return') {
    const otherFinal = await prisma.fillup.findFirst({
      where: { rentalSessionId, fillupType: 'final_return', NOT: { id: fillupId } },
    });
    if (otherFinal) return { outcome: 'final_return_exists', fillup: toRentalFillup(fromPrisma(otherFinal)) };
  }

  const updated = await updateFillupGeneric(userId, fillupId, {
    gallonsPumped:   patch.gallonsPumped,
    pricePerGallon:  patch.pricePerGallon,
    totalCost:       patch.totalCost,
    stationName:     patch.stationName,
    odometerReading: patch.odometerReading,
    receiptThumb:    patch.receiptThumb,
    fillupType:      patch.fillupType,
    stationLat:      patch.stationLat,
    stationLng:      patch.stationLng,
  });
  if (!updated) return { outcome: 'not_found' };

  // currentFuelGallons is NEVER touched by an edit, including the most
  // recent transaction — see this file's header comment. Editing history
  // can only ever be a guess about "what's in the tank right now."

  return { outcome: 'updated', fillup: toRentalFillup(updated) };
}

// ── Delete ───────────────────────────────────────────────────────────────

export type DeleteRentalFillupResult = { outcome: 'deleted' } | { outcome: 'not_found' };

export async function deleteRentalFillup(
  userId: string, rentalSessionId: string, fillupId: string,
): Promise<DeleteRentalFillupResult> {
  const session = await prisma.rentalSession.findFirst({ where: { id: rentalSessionId, userId } });
  if (!session) return { outcome: 'not_found' };

  const existing = await prisma.fillup.findFirst({ where: { id: fillupId, userId, rentalSessionId } });
  if (!existing) return { outcome: 'not_found' };

  const deleted = await deleteFillupGeneric(userId, fillupId);
  if (!deleted) return { outcome: 'not_found' };

  // currentFuelGallons is NEVER touched by a delete, including the most
  // recent transaction — see this file's header comment.

  return { outcome: 'deleted' };
}

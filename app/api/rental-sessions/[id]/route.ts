/**
 * GET    /api/rental-sessions/:id — fetch one rental session (owner only)
 * PATCH  /api/rental-sessions/:id — update fuel level, return details, notes
 * DELETE /api/rental-sessions/:id — remove a session (e.g. an abandoned draft)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RENTAL_RETURN_ASSISTANT_ENABLED } from '@/lib/featureFlags';
import { getRentalSession, updateRentalSession, deleteRentalSession, confirmRentalCurrentFuel, type UpdateRentalSessionInput } from '@/lib/rentalSessions';
import { validateRentalPhotos, photoCapKb, PHOTO_MAX_DATA_URL_BYTES } from '@/lib/photoLimits';
import { getRentalFillups } from '@/lib/rentalFillups';
import { isGaugeStyle } from '@/lib/gaugeStyles';
import { FUEL_DATA_SOURCES } from '@/lib/rentalProvider';
import { prisma } from '@/lib/prisma';

/** Manual-entry PATCH route policy (2026-08-28, strengthened same day per
 *  independent review — Correction 6): Level 2 providers don't exist yet —
 *  this is a Level-1-only manual product — so a client PATCH may only claim
 *  a source the renter could plausibly have produced by hand, typing into
 *  FuelLevelInput right now. RENTAL_COMPANY_API / VEHICLE_TELEMATICS are
 *  rejected outright here rather than accepted-but-untrusted, so a manual
 *  entry can never spoof the authoritative-looking provenance labels (see
 *  isAuthoritativeSource() in lib/rentalProvider.ts) that this endpoint has
 *  no way to actually verify.
 *
 *  RECEIPT was removed from this allow-list in the same correction: it is
 *  SYSTEM-DERIVED provenance, set exclusively by the atomic Fillup-creation
 *  bump in bumpCurrentFuelGallonsOnCreateSql() (lib/rentalFillups.ts) — a
 *  raw UPDATE executed server-side inside the Fillup-create transaction,
 *  never reachable from this PATCH body. Allowing a manual PATCH to also
 *  claim RECEIPT would let a client impersonate "this came from a logged
 *  purchase" without ever having logged one. */
const MANUAL_ENTRY_ALLOWED_SOURCES = new Set(['MANUAL_GAUGE', 'MANUAL_PERCENT', 'MANUAL_GALLONS']);

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return (session.user as { id?: string })?.id ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await getRentalSession(userId, params.id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Phase 3A — canonical Fillup rows for this rental, alongside the legacy
  // session.refuelLogs already on `session`. Empty for a pre-cutover session
  // that only has legacy entries; the client falls back to refuelLogs then.
  const fillups = await getRentalFillups(userId, params.id);
  // Phase 4 — resolve the linked Vehicle's gauge style (if any) server-side
  // so the client can apply lib/gaugeStyles.ts's resolveRentalGaugeStyle()
  // precedence without a second round-trip. Null when no vehicle is linked.
  const linkedVehicleGaugeStyle = session.vehicleId
    ? (await prisma.vehicle.findUnique({ where: { id: session.vehicleId }, select: { fuelGaugeStyle: true } }))?.fuelGaugeStyle ?? null
    : null;
  // Phase 4B — the final fallback in resolveRentalGaugeStyle's precedence
  // chain (session override → linked Vehicle → user global → analog).
  const userGlobalGaugeStyle = (await prisma.user.findUnique({ where: { id: userId }, select: { fuelGaugeStyle: true } }))?.fuelGaugeStyle ?? null;
  return NextResponse.json({ session, fillups, linkedVehicleGaugeStyle, userGlobalGaugeStyle });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as
    (UpdateRentalSessionInput & {
      /** Correction 9 (2026-08-28 independent review) — TOCTOU/optimistic-
       *  concurrency guard for the current-fuel CONFIRMATION write path
       *  specifically (see confirmRentalCurrentFuel() in
       *  lib/rentalSessions.ts). Present only on the confirm-fuel PATCH
       *  the RentalDashboard confirm flow sends; absent (undefined) on
       *  every other PATCH this route already handles, which keep using
       *  the plain read-then-write updateRentalSession() path below. */
      expectedPriorCurrentFuelGallons?: number | null;
      /** 2026-08-28 Blocker 2 hardening — the rest of the last-known
       *  fuel-state snapshot the client validated its proposed reading
       *  against. All three travel together with
       *  expectedPriorCurrentFuelGallons; see confirmRentalCurrentFuel(). */
      expectedPriorCurrentFuelSource?: string | null;
      expectedPriorCurrentFuelUpdatedAt?: string | null;
      expectedPriorFuelTankCapacityGallons?: number | null;
    }) | null;
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  if (body.fuelGaugeStyle !== undefined && body.fuelGaugeStyle !== null && !isGaugeStyle(body.fuelGaugeStyle)) {
    return NextResponse.json({ error: 'Invalid gauge style.' }, { status: 400 });
  }

  const photoCheck = validateRentalPhotos(body as Record<string, unknown>);
  if (!photoCheck.ok) {
    return NextResponse.json(
      {
        error: `That photo is too large to store (limit ${photoCapKb()}KB per photo).`,
        field: photoCheck.field,
        bytes: photoCheck.bytes,
        limitBytes: PHOTO_MAX_DATA_URL_BYTES,
      },
      { status: 413 },
    );
  }

  // ── Fuel-field validation (2026-08-28 hardening) ──────────────────────────
  // Ownership is already established above (requireUserId + the findFirst
  // inside updateRentalSession/getRentalSession) — load the existing OWNED
  // session first so we can validate against the EFFECTIVE tank capacity
  // (the one this same PATCH is setting, if any, else the session's current
  // one) without trusting anything the caller merely claims.
  const existingForValidation = await getRentalSession(userId, params.id);
  if (!existingForValidation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const effectiveTankCapacity = body.fuelTankCapacityGallons !== undefined
    ? body.fuelTankCapacityGallons
    : existingForValidation.fuelTankCapacityGallons;

  const gallonFieldsToCheck: Array<[string, unknown]> = [
    ['currentFuelGallons', body.currentFuelGallons],
    ['pickupFuelGallons', body.pickupFuelGallons],
    ['requiredReturnFuelGallons', body.requiredReturnFuelGallons],
  ];
  for (const [field, value] of gallonFieldsToCheck) {
    if (value === undefined) continue;
    if (!isFiniteNonNegative(value)) {
      return NextResponse.json({ error: `${field} must be a finite number >= 0.` }, { status: 400 });
    }
    if (typeof effectiveTankCapacity === 'number' && effectiveTankCapacity > 0 && value > effectiveTankCapacity) {
      return NextResponse.json({ error: `${field} cannot exceed the tank capacity (${effectiveTankCapacity} gal).` }, { status: 400 });
    }
  }

  if (body.rentalFuelChargePerGallon !== undefined && !isFiniteNonNegative(body.rentalFuelChargePerGallon)) {
    return NextResponse.json({ error: 'rentalFuelChargePerGallon must be a finite number >= 0.' }, { status: 400 });
  }

  const sourceFieldsToCheck: Array<[string, unknown]> = [
    ['currentFuelSource', body.currentFuelSource],
    ['pickupFuelSource', body.pickupFuelSource],
  ];
  for (const [field, value] of sourceFieldsToCheck) {
    if (value === undefined) continue;
    if (typeof value !== 'string' || !(FUEL_DATA_SOURCES as readonly string[]).includes(value)) {
      return NextResponse.json({ error: `${field} must be one of ${FUEL_DATA_SOURCES.join(', ')}.` }, { status: 400 });
    }
    // Source-spoofing guard: this is a manual-entry-only route (Level 2
    // rental-company/telematics integrations don't exist yet), so a client
    // PATCH can never claim an authoritative provenance it has no way of
    // actually backing.
    if (!MANUAL_ENTRY_ALLOWED_SOURCES.has(value)) {
      return NextResponse.json({ error: `${field} cannot be set to ${value} from manual entry.` }, { status: 400 });
    }
  }

  // ── Gallons/source pairing (Correction 7, 2026-08-28 independent review) ──
  // A gallons value describes a NEW observation; its source is that
  // observation's provenance. Neither may change alone in the same request:
  // changing gallons without a source would silently carry over whatever
  // source was already stored (mislabeling a fresh number with stale
  // provenance), and changing source alone would relabel an
  // already-persisted measurement's provenance without any new observation
  // actually having occurred.
  if ((body.currentFuelGallons !== undefined) !== (body.currentFuelSource !== undefined)) {
    return NextResponse.json(
      { error: 'currentFuelGallons and currentFuelSource must be provided together.' },
      { status: 400 },
    );
  }
  if ((body.pickupFuelGallons !== undefined) !== (body.pickupFuelSource !== undefined)) {
    return NextResponse.json(
      { error: 'pickupFuelGallons and pickupFuelSource must be provided together.' },
      { status: 400 },
    );
  }

  // ── Current-fuel CONFIRMATION write (Correction 9) ─────────────────────
  // Only taken when the client explicitly sent expectedPriorCurrentFuelGallons
  // (the RentalDashboard confirm flow) — every other PATCH shape (pickup
  // fuel, gauge style, rental details, ...) falls through to the ordinary
  // read-then-write updateRentalSession() path unchanged below.
  if ('expectedPriorCurrentFuelGallons' in body) {
    if (body.currentFuelGallons === undefined || body.currentFuelSource === undefined) {
      return NextResponse.json(
        { error: 'expectedPriorCurrentFuelGallons requires currentFuelGallons and currentFuelSource in the same request.' },
        { status: 400 },
      );
    }
    const expectedGallons = body.expectedPriorCurrentFuelGallons ?? null;
    if (expectedGallons !== null && !isFiniteNonNegative(expectedGallons)) {
      return NextResponse.json({ error: 'expectedPriorCurrentFuelGallons must be null or a finite number >= 0.' }, { status: 400 });
    }
    const expectedSource = body.expectedPriorCurrentFuelSource ?? null;
    if (expectedSource !== null && (typeof expectedSource !== 'string' || !(FUEL_DATA_SOURCES as readonly string[]).includes(expectedSource))) {
      return NextResponse.json({ error: `expectedPriorCurrentFuelSource must be null or one of ${FUEL_DATA_SOURCES.join(', ')}.` }, { status: 400 });
    }
    const expectedUpdatedAt = body.expectedPriorCurrentFuelUpdatedAt ?? null;
    if (expectedUpdatedAt !== null && typeof expectedUpdatedAt !== 'string') {
      return NextResponse.json({ error: 'expectedPriorCurrentFuelUpdatedAt must be null or a string.' }, { status: 400 });
    }
    const expectedCapacity = body.expectedPriorFuelTankCapacityGallons ?? null;
    if (expectedCapacity !== null && !isFiniteNonNegative(expectedCapacity)) {
      return NextResponse.json({ error: 'expectedPriorFuelTankCapacityGallons must be null or a finite number >= 0.' }, { status: 400 });
    }

    const result = await confirmRentalCurrentFuel(userId, params.id, {
      currentFuelGallons: body.currentFuelGallons,
      currentFuelSource: body.currentFuelSource,
      expectedPriorCurrentFuelGallons: expectedGallons,
      expectedPriorCurrentFuelSource: expectedSource,
      expectedPriorCurrentFuelUpdatedAt: expectedUpdatedAt,
      expectedPriorFuelTankCapacityGallons: expectedCapacity,
    });
    if (result.status === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (result.status === 'conflict') {
      // Correction 10 — customer-facing copy only, never a raw
      // conflict/error code or DB/JSON terminology. The exact copy also
      // lives client-side (lib/translations.ts rentalReturn.fuelConfirmConflictMessage)
      // for when the client wants to render it without round-tripping this
      // string; this server copy exists for any other caller of this route.
      return NextResponse.json(
        { error: "Your rental information changed while you were updating the fuel level. We've refreshed the latest information. Please confirm the fuel level again." },
        { status: 409 },
      );
    }
    return NextResponse.json({ session: result.session });
  }

  const updated = await updateRentalSession(userId, params.id, body);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ session: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!RENTAL_RETURN_ASSISTANT_ENABLED) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ok = await deleteRentalSession(userId, params.id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

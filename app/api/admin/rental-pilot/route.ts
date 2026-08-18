/**
 * GET /api/admin/rental-pilot — aggregated Rental Return Assistant pilot
 * metrics for admin review (section 26/38). Deliberately minimal — no
 * per-user drill-down, no receipt images — just enough to judge whether the
 * pilot is working. Protected by the same ADMIN_PASSWORD pattern as the
 * rest of /api/admin/*.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { estimatedFuelCost, estimatedRentalCompanyCharge, estimatedSavings, gallonsNeeded } from '@/lib/rentalCalculations';
import { sessionHasAdminRole } from '@/lib/adminAuth';

async function auth(req: Request): Promise<'ok' | 'no-env' | 'wrong'> {
  const pw = process.env.ADMIN_PASSWORD;
  const header = req.headers.get('x-admin-password') ?? '';
  if (pw && header === pw) return 'ok';
  if (await sessionHasAdminRole()) return 'ok';
  return pw ? 'wrong' : 'no-env';
}

export async function GET(req: Request) {
  const _auth = await auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized' },   { status: 401 });

  const sessions = await prisma.rentalSession.findMany({
    select: {
      id: true, userId: true, status: true, rentalCompany: true, returnLocation: true,
      vehicleYear: true, vehicleMake: true, vehicleModel: true,
      requiredReturnFuelGallons: true, currentFuelGallons: true, rentalFuelChargePerGallon: true,
      fuelFeeCharged: true, fuelFeeAmount: true, feedbackRating: true, refuelLogs: true,
      createdAt: true, completedAt: true,
      pickupVehiclePhotoThumb: true, pickupGaugePhotoThumb: true, pickupAgreementPhotoThumb: true,
      returnGaugePhotoThumb: true, returnReceiptPhotoThumb: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const active    = sessions.filter((s) => s.status === 'active').length;
  const completed = sessions.filter((s) => s.status === 'completed').length;

  const companyCount: Record<string, number> = {};
  for (const s of sessions) companyCount[s.rentalCompany] = (companyCount[s.rentalCompany] ?? 0) + 1;

  const locationSet = new Set(sessions.map((s) => s.returnLocation).filter(Boolean));

  const usedGasSearch = sessions.filter((s) => Array.isArray(s.refuelLogs) && (s.refuelLogs as unknown[]).length > 0).length;

  // Average estimated savings — only for sessions with a known rental rate
  // AND fuel actually needed (matches how the UI itself decides to show this).
  const savingsValues: number[] = [];
  for (const s of sessions) {
    if (s.requiredReturnFuelGallons == null || s.currentFuelGallons == null) continue;
    const needed = gallonsNeeded(s.requiredReturnFuelGallons, s.currentFuelGallons);
    if (needed <= 0) continue;
    // No real station price stored server-side (that's a client-side
    // lookup) — approximate self-cost with a flat $3.30/gal national-ish
    // estimate purely for this aggregate; the per-user UI always uses a
    // real nearby station price.
    const approxSelfCost = estimatedFuelCost(needed, 3.30);
    const charge = estimatedRentalCompanyCharge(needed, s.rentalFuelChargePerGallon);
    const savings = estimatedSavings(charge, approxSelfCost);
    if (savings != null) savingsValues.push(savings);
  }
  const avgSavings = savingsValues.length > 0 ? savingsValues.reduce((a, b) => a + b, 0) / savingsValues.length : null;

  const feeReports = sessions.filter((s) => s.fuelFeeCharged != null);
  const feesCharged = feeReports.filter((s) => s.fuelFeeCharged === true);
  const avgFeeAmount = feesCharged.length > 0
    ? feesCharged.reduce((a, s) => a + (s.fuelFeeAmount ?? 0), 0) / feesCharged.length
    : null;

  const ratings = sessions.map((s) => s.feedbackRating).filter((r): r is number => r != null);
  const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  // User email/name for the drill-down list — one batched lookup, not N+1.
  const userIds = [...new Set(sessions.map((s) => s.userId))];
  const users = await prisma.user.findMany({
    where:  { id: { in: userIds } },
    select: { id: true, email: true, name: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  // Photos are returned only as a presence flag here (keeps the list light) —
  // fetch a single session's full detail (with actual images) via
  // GET /api/admin/rental-pilot/:id when a dispute needs review.
  const sessionList = sessions.slice(0, 100).map((s) => ({
    id: s.id,
    userEmail: userById.get(s.userId)?.email ?? null,
    userName:  userById.get(s.userId)?.name  ?? null,
    status: s.status,
    rentalCompany: s.rentalCompany,
    vehicle: [s.vehicleYear, s.vehicleMake, s.vehicleModel].filter(Boolean).join(' '),
    returnLocation: s.returnLocation,
    fuelFeeCharged: s.fuelFeeCharged,
    fuelFeeAmount: s.fuelFeeAmount,
    feedbackRating: s.feedbackRating,
    createdAt: s.createdAt,
    completedAt: s.completedAt,
    hasPhotos: !!(s.pickupVehiclePhotoThumb || s.pickupGaugePhotoThumb || s.pickupAgreementPhotoThumb || s.returnGaugePhotoThumb || s.returnReceiptPhotoThumb),
  }));

  return NextResponse.json({
    totalSessions: sessions.length,
    active, completed,
    rentalCompanies: companyCount,
    returnLocationsRepresented: locationSet.size,
    sessionsWithRefuelLogged: usedGasSearch,
    averageEstimatedSavings: avgSavings != null ? Math.round(avgSavings * 100) / 100 : null,
    fuelFeeReports: feeReports.length,
    fuelFeesCharged: feesCharged.length,
    averageFeeAmount: avgFeeAmount != null ? Math.round(avgFeeAmount * 100) / 100 : null,
    averageFeedbackRating: avgRating != null ? Math.round(avgRating * 10) / 10 : null,
    feedbackCount: ratings.length,
    sessions: sessionList,
  });
}

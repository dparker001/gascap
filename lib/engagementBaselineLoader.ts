/**
 * Loads the inputs for lib/engagementBaseline.ts. READ-ONLY (SELECT /
 * groupBy only) — no writes anywhere. Kept apart from the pure module so the
 * math stays DB-free and unit-testable.
 */
import { prisma } from './prisma';
import { EVENT_NAMES, type BaselineInput, type EventAgg, type EventName } from './engagementBaseline';
import type { FuelActionRecord } from './activationMetrics';

/** Hard cap; if hit, the report says its counts are lower bounds. */
export const USER_ROW_CAP = 20000;

export async function loadBaselineInput(now: Date = new Date()): Promise<BaselineInput> {
  const users = await prisma.user.findMany({
    where: { isTestAccount: false, role: { not: 'admin' } },
    select: {
      id: true, createdAt: true, activeDays: true, isProTrial: true, trialExpiresAt: true,
      ambassadorProForLife: true, stripeInterval: true, stripeSubscriptionId: true,
      revenueCatActive: true, revenueCatInterval: true,
    },
    take: USER_ROW_CAP,
  });

  const [fillupGroups, favoriteGroups, vehicleGroups, eventGroups, purchaseRows, rcGroups] = await Promise.all([
    prisma.fillup.groupBy({ by: ['userId'], _count: { _all: true }, _min: { createdAt: true } }),
    prisma.favoriteStation.groupBy({ by: ['userId'] }),
    prisma.vehicle.groupBy({ by: ['userId'] }),
    prisma.analyticsEvent.groupBy({
      by: ['eventType', 'userId'],
      where: { eventType: { in: [...EVENT_NAMES] } },
      _count: { _all: true },
      _min: { createdAt: true },
    }),
    prisma.analyticsEvent.findMany({
      where: { eventType: 'purchase_completed', userId: { not: null } },
      select: { userId: true, createdAt: true, provider: true, billing: true },
    }),
    prisma.revenueCatWebhookEvent.groupBy({
      by: ['eventType'],
      where: { eventType: { in: ['CANCELLATION', 'EXPIRATION', 'REFUND'] } },
      _count: { _all: true },
    }),
  ]);

  const fillups: BaselineInput['fillups'] = {};
  for (const g of fillupGroups) fillups[g.userId] = { count: g._count._all, firstAt: g._min.createdAt ?? null };

  const events: Partial<Record<EventName, EventAgg>> = {};
  for (const g of eventGroups) {
    const name = g.eventType as EventName;
    const agg = (events[name] ??= { users: [], total: 0, firstAt: null });
    agg.total += g._count._all;
    if (g.userId) agg.users.push(g.userId);
    const at = g._min.createdAt ? g._min.createdAt.toISOString() : null;
    if (at && (!agg.firstAt || at < agg.firstAt)) agg.firstAt = at;
  }

  const rc = { CANCELLATION: 0, EXPIRATION: 0, REFUND: 0 };
  for (const g of rcGroups) {
    if (g.eventType in rc) rc[g.eventType as keyof typeof rc] = g._count._all;
  }

  return {
    now,
    users: users.map((u) => ({ ...u, activeDays: u.activeDays ?? [] })),
    fillups,
    savedStationUserIds: favoriteGroups.map((g) => g.userId),
    vehicleUserIds: vehicleGroups.map((g) => g.userId),
    events,
    purchases: purchaseRows.map((p) => ({
      userId: p.userId as string,
      at: p.createdAt.toISOString(),
      provider: p.provider,
      billing: p.billing,
    })),
    revenueCat: rc,
    truncated: users.length >= USER_ROW_CAP,
  };
}

/** Hard cap on fuel-action rows read for the activation metrics. */
export const FUEL_ROW_CAP = 200000;

/**
 * P1-A — READ-ONLY (SELECT only). Every logged gallon-based fuel record
 * (personal + rental Fillups, and gig fill-ups whose energyUnit is 'gal').
 * The pure module drops non-population users, invalid values and EV/kWh rows;
 * kWh gig rows are also excluded here so they are never even loaded.
 */
export async function loadFuelActions(): Promise<{ records: FuelActionRecord[]; truncated: boolean }> {
  const [fillups, gig] = await Promise.all([
    prisma.fillup.findMany({
      select: { userId: true, createdAt: true, gallonsPumped: true, pricePerGallon: true, totalCost: true, rentalSessionId: true },
      take: FUEL_ROW_CAP,
    }),
    prisma.gigFillup.findMany({
      where: { energyUnit: 'gal' },
      select: { userId: true, createdAt: true, gallons: true, pricePerGallon: true, totalCost: true },
      take: FUEL_ROW_CAP,
    }),
  ]);
  const records: FuelActionRecord[] = [
    ...fillups.map((f): FuelActionRecord => ({
      userId: f.userId,
      source: f.rentalSessionId ? 'rental' : 'personal',
      createdAt: f.createdAt,
      gallons: f.gallonsPumped,
      pricePerGallon: f.pricePerGallon,
      totalCost: f.totalCost,
    })),
    ...gig.map((g): FuelActionRecord => ({
      userId: g.userId,
      source: 'gig',
      createdAt: g.createdAt,
      gallons: g.gallons,
      pricePerGallon: g.pricePerGallon,
      totalCost: g.totalCost,
      energyUnit: 'gal',
    })),
  ];
  return { records, truncated: fillups.length >= FUEL_ROW_CAP || gig.length >= FUEL_ROW_CAP };
}

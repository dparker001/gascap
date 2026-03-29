/**
 * /api/maintenance
 * GET  — list all reminders for the user (with computed status)
 * POST — add a new reminder
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import type { Session }     from 'next-auth';
import { authOptions }      from '@/lib/auth';
import {
  getReminders,
  addReminder,
  computeStatus,
  type MaintenanceReminder,
} from '@/lib/maintenance';
import { getFillups } from '@/lib/fillups';

function userId(session: Session | null) {
  return session?.user?.id ?? session?.user?.email ?? null;
}

/** Latest odometer across all fillups for a given vehicle */
function latestOdometer(fillups: ReturnType<typeof getFillups>, vehicleKey: string) {
  const vFills = fillups
    .filter((f) => (f.vehicleId ?? f.vehicleName) === vehicleKey && f.odometerReading != null)
    .sort((a, b) => b.date.localeCompare(a.date));
  return vFills[0]?.odometerReading ?? undefined;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const uid     = userId(session);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const reminders = getReminders(uid);
  const fillups   = getFillups(uid);

  const withStatus = reminders.map((r) => {
    const vKey         = r.vehicleId ?? r.vehicleName;
    const currentMiles = latestOdometer(fillups, vKey);
    return computeStatus(r, currentMiles);
  });

  // Sort: overdue first, then due_soon, then ok, then unknown
  const ORDER = { overdue: 0, due_soon: 1, ok: 2, unknown: 3 };
  withStatus.sort((a, b) => ORDER[a.status] - ORDER[b.status]);

  return NextResponse.json({ reminders: withStatus });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const uid     = userId(session);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as Partial<MaintenanceReminder>;

  if (!body.vehicleName?.trim()) {
    return NextResponse.json({ error: 'vehicleName is required' }, { status: 400 });
  }
  if (!body.serviceType) {
    return NextResponse.json({ error: 'serviceType is required' }, { status: 400 });
  }
  if (!body.intervalMiles && !body.intervalMonths) {
    return NextResponse.json({ error: 'At least one of intervalMiles or intervalMonths is required' }, { status: 400 });
  }

  const reminder = addReminder(uid, {
    vehicleId:         body.vehicleId,
    vehicleName:       body.vehicleName.trim(),
    serviceType:       body.serviceType,
    customLabel:       body.customLabel?.trim(),
    intervalMiles:     body.intervalMiles   ? Number(body.intervalMiles)   : undefined,
    intervalMonths:    body.intervalMonths  ? Number(body.intervalMonths)  : undefined,
    lastServiceMiles:  body.lastServiceMiles != null ? Number(body.lastServiceMiles) : undefined,
    lastServiceDate:   body.lastServiceDate ?? undefined,
    notes:             body.notes?.trim(),
  });

  return NextResponse.json({ reminder }, { status: 201 });
}

/**
 * Admin Campaigns API — protected by ADMIN_PASSWORD env var
 *
 * GET    /api/admin/campaigns                  — overview + all placements + stats
 * GET    /api/admin/campaigns?group=station    — grouped stats (station|placement|headlineVariant|city)
 * GET    /api/admin/campaigns?days=30          — time-series buckets for the last N days
 * POST   /api/admin/campaigns                  — create a placement (returns code + QR URL)
 * PATCH  /api/admin/campaigns?id=plc_xxx       — update a placement
 * DELETE /api/admin/campaigns?id=plc_xxx       — delete a placement
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  listPlacements,
  createPlacement,
  updatePlacement,
  deletePlacement,
  getStatsForAllPlacements,
  getOverview,
  groupStatsBy,
  getDailyBuckets,
} from '@/lib/campaigns';

/**
 * Campaign analytics uses a dedicated password (CAMPAIGN_ADMIN_PASSWORD),
 * separate from the main site admin (ADMIN_PASSWORD), so marketing/VE
 * collaborators can be given access to /admin/campaigns without seeing
 * the full user list or being able to modify accounts.
 */
function auth(req: NextRequest): boolean {
  const pw = process.env.CAMPAIGN_ADMIN_PASSWORD;
  if (!pw) return false;
  return (req.headers.get('x-admin-password') ?? '') === pw;
}

function baseUrl(req: NextRequest): string {
  return process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const group = searchParams.get('group') as 'station' | 'placement' | 'headlineVariant' | 'city' | null;
  const days  = searchParams.get('days');

  if (group) {
    return NextResponse.json({ grouped: groupStatsBy(group) });
  }

  if (days) {
    const n = Math.max(1, Math.min(365, parseInt(days, 10) || 30));
    const code = searchParams.get('code') ?? undefined;
    return NextResponse.json({ daily: getDailyBuckets(n, code) });
  }

  const placements = listPlacements();
  const stats      = getStatsForAllPlacements();
  const overview   = getOverview();
  const origin     = baseUrl(req);

  // Attach the QR URL to each placement so the dashboard can render print/copy buttons
  const enriched = placements.map((p) => {
    const stat = stats.find((s) => s.code.toUpperCase() === p.code.toUpperCase());
    return {
      ...p,
      qrUrl: `${origin}/q/${p.code}`,
      stats: stat,
    };
  });

  return NextResponse.json({
    overview,
    placements: enriched,
  });
}

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const station = (body.station as string)?.trim();
  if (!station) {
    return NextResponse.json({ error: 'station is required' }, { status: 400 });
  }

  try {
    const created = createPlacement({
      campaign:        (body.campaign as string)        || 'Know Before You Fill Up',
      station,
      address:         body.address         as string | undefined,
      city:            body.city            as string | undefined,
      contactName:     body.contactName     as string | undefined,
      contactEmail:    body.contactEmail    as string | undefined,
      contactPhone:    body.contactPhone    as string | undefined,
      placement:       (body.placement       as string) || 'counter',
      headlineVariant: (body.headlineVariant as string) || 'A-KnowBefore',
      landingPath:     (body.landingPath     as string) || '/',
      notes:           body.notes           as string | undefined,
      code:            body.code            as string | undefined,
    });
    return NextResponse.json({
      placement: created,
      qrUrl:    `${baseUrl(req)}/q/${created.code}`,
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to create placement';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  let patch: Record<string, unknown> = {};
  try { patch = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const updated = updatePlacement(id, patch);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ placement: updated });
}

export async function DELETE(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const ok = deletePlacement(id);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

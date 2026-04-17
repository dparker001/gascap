/**
 * Admin API — protected by ADMIN_PASSWORD env var
 * GET    /api/admin/users              — list all users
 * DELETE /api/admin/users?id=xxx       — delete a user
 * PATCH  /api/admin/users?id=xxx       — update plan, emailVerified, betaProExpiry, or isTestAccount
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { grantBetaTrial, revokeBetaTrial, findById } from '@/lib/users';
import { upsertGhlContact, removeGhlTags } from '@/lib/ghl';
import { getFillups } from '@/lib/fillups';

function auth(req: Request): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  console.log('[admin-auth] pw length:', pw?.length ?? 'undefined', '| header present:', !!req.headers.get('x-admin-password'));
  if (!pw) return false;
  const header = req.headers.get('x-admin-password') ?? '';
  return header === pw;
}

/** Fetch external_user_ids of all active OneSignal subscribers (up to 1 000) */
async function getOneSignalSubscriberIds(): Promise<Set<string>> {
  const appId  = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID  ?? '';
  const apiKey = process.env.ONESIGNAL_REST_API_KEY ?? '';
  if (!appId || !apiKey) return new Set();
  const ids = new Set<string>();
  const limit = 300;
  for (let offset = 0; offset < 1000; offset += limit) {
    try {
      const res = await fetch(
        `https://onesignal.com/api/v1/players?app_id=${appId}&limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Basic ${apiKey}` }, next: { revalidate: 300 } },
      );
      if (!res.ok) break;
      const data = await res.json() as {
        total_count: number;
        players: { external_user_id?: string; notification_types?: number }[];
      };
      for (const p of data.players ?? []) {
        // notification_types > 0 means the device is actively subscribed
        if (p.external_user_id && (p.notification_types ?? 0) > 0) {
          ids.add(p.external_user_id);
        }
      }
      if (offset + limit >= data.total_count) break;
    } catch { break; }
  }
  return ids;
}

export async function GET(req: Request) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [subscribedUserIds, allUsers] = await Promise.all([
    getOneSignalSubscriberIds(),
    prisma.user.findMany({ orderBy: { createdAt: 'desc' } }),
  ]);

  // Build a map of referralCode → user name for quick lookup
  const codeToName = new Map<string, string>();
  for (const u of allUsers) {
    if (u.referralCode) codeToName.set(u.referralCode.toUpperCase(), u.name);
  }

  const users = allUsers.map((u) => {
    // Find users this person referred
    const referredUsers = u.referralCode
      ? allUsers
          .filter((r) => r.referredBy?.toUpperCase() === u.referralCode?.toUpperCase())
          .map((r) => ({ name: r.name, email: r.email, joinedAt: r.createdAt }))
      : [];

    const fillups     = getFillups(u.id);
    const fillupCount = fillups.length;
    const lastFillup  = fillups.length > 0
      ? fillups.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date
      : null;

    return {
      id:               u.id,
      name:             u.name,
      email:            u.email,
      plan:             u.plan,
      emailVerified:    u.emailVerified,
      createdAt:        u.createdAt,
      referralCount:    u.referralCount,
      referralCode:     u.referralCode  ?? null,
      referredBy:       u.referredBy    ?? null,
      referredByName:   u.referredBy ? (codeToName.get(u.referredBy.toUpperCase()) ?? u.referredBy) : null,
      referredUsers,
      stripeCustomerId: u.stripeCustomerId ?? null,
      isBetaTester:     u.isBetaTester,
      betaProExpiry:    u.betaProExpiry   ?? null,
      pushSubscribed:   subscribedUserIds.has(u.id),
      isTestAccount:    u.isTestAccount,
      // Activity metrics
      loginCount:       u.loginCount,
      lastLoginAt:      u.lastLoginAt   ?? null,
      calcCount:        u.calcCount,
      activeDays:       (u.activeDays   ?? []).length,
      streak:           u.streak,
      fillupCount,
      lastFillup,
    };
  });
  return NextResponse.json({ users, total: users.length });
}

export async function DELETE(req: Request) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  await prisma.user.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const body = await req.json() as {
    plan?: string; emailVerified?: boolean;
    grantBetaTrial?: number;  // days (default 30)
    revokeBetaTrial?: boolean;
    isTestAccount?: boolean;
  };

  const user = await findById(id);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (body.grantBetaTrial !== undefined) {
    await grantBetaTrial(id, body.grantBetaTrial || 30);
    upsertGhlContact({ name: user.name, email: user.email, plan: 'pro', isBeta: true, source: 'GasCap Beta Grant' })
      .catch((e) => console.error('[GHL] beta grant sync failed:', e));
    return NextResponse.json({ ok: true });
  }
  if (body.revokeBetaTrial) {
    await revokeBetaTrial(id);
    upsertGhlContact({ name: user.name, email: user.email, plan: 'free', source: 'GasCap Beta Revoked' })
      .catch((e) => console.error('[GHL] beta revoke sync failed:', e));
    removeGhlTags(user.email, ['gascap-beta-tester'])
      .catch((e) => console.error('[GHL] beta tag remove failed:', e));
    return NextResponse.json({ ok: true });
  }

  const data: Record<string, unknown> = {};
  if (body.plan          !== undefined) data.plan          = body.plan;
  if (body.emailVerified !== undefined) data.emailVerified = body.emailVerified;
  if (body.isTestAccount !== undefined) data.isTestAccount = body.isTestAccount;

  await prisma.user.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

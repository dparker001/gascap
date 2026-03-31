/**
 * Admin API — protected by ADMIN_PASSWORD env var
 * GET    /api/admin/users              — list all users
 * DELETE /api/admin/users?id=xxx       — delete a user
 * PATCH  /api/admin/users?id=xxx       — update plan, emailVerified, or betaProExpiry
 */
import { NextResponse } from 'next/server';
import fs   from 'fs';
import path from 'path';
import type { StoredUser } from '@/lib/users';
import { grantBetaTrial, revokeBetaTrial } from '@/lib/users';
import { upsertGhlContact, removeGhlTags } from '@/lib/ghl';
import { getAllSubs } from '@/lib/pushSubscriptions';

const DATA_FILE = path.join(process.cwd(), 'data', 'users.json');

function read(): StoredUser[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as StoredUser[];
  } catch { return []; }
}

function write(rows: StoredUser[]) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2));
}

function auth(req: Request): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  const header = req.headers.get('x-admin-password') ?? '';
  return header === pw;
}

export async function GET(req: Request) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const subs              = getAllSubs();
  const subscribedUserIds = new Set(subs.map((s) => s.userId));
  const allUsers          = read();

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

    return {
      id:               u.id,
      name:             u.name,
      email:            u.email,
      plan:             u.plan,
      emailVerified:    u.emailVerified ?? false,
      createdAt:        u.createdAt,
      referralCount:    u.referralCount ?? 0,
      referralCode:     u.referralCode  ?? null,
      referredBy:       u.referredBy    ?? null,
      referredByName:   u.referredBy ? (codeToName.get(u.referredBy.toUpperCase()) ?? u.referredBy) : null,
      referredUsers,                         // list of users this person referred
      stripeCustomerId: u.stripeCustomerId ?? null,
      isBetaTester:     u.isBetaTester    ?? false,
      betaProExpiry:    u.betaProExpiry   ?? null,
      pushSubscribed:   subscribedUserIds.has(u.id),
    };
  });
  return NextResponse.json({ users, total: users.length });
}

export async function DELETE(req: Request) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const rows = read().filter((u) => u.id !== id);
  write(rows);
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
  };
  const rows = read();
  const idx  = rows.findIndex((u) => u.id === id);
  if (idx === -1) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (body.grantBetaTrial !== undefined) {
    grantBetaTrial(id, body.grantBetaTrial || 30);
    const user = rows[idx];
    upsertGhlContact({ name: user.name, email: user.email, plan: 'pro', isBeta: true, source: 'GasCap Beta Grant' })
      .catch((e) => console.error('[GHL] beta grant sync failed:', e));
    return NextResponse.json({ ok: true });
  }
  if (body.revokeBetaTrial) {
    revokeBetaTrial(id);
    const user = rows[idx];
    upsertGhlContact({ name: user.name, email: user.email, plan: 'free', source: 'GasCap Beta Revoked' })
      .catch((e) => console.error('[GHL] beta revoke sync failed:', e));
    removeGhlTags(user.email, ['gascap-beta-tester'])
      .catch((e) => console.error('[GHL] beta tag remove failed:', e));
    return NextResponse.json({ ok: true });
  }

  if (body.plan          !== undefined) rows[idx].plan          = body.plan as StoredUser['plan'];
  if (body.emailVerified !== undefined) rows[idx].emailVerified = body.emailVerified;
  write(rows);
  return NextResponse.json({ ok: true });
}

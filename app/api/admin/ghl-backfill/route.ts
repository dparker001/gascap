/**
 * POST /api/admin/ghl-backfill
 *
 * Reads users and upserts them into GHL as contacts, one PAGE at a time.
 * Users who are already in GHL are safely updated (upsert by email).
 *
 * Query params:
 *   ?smsOnly=true      — process only users with smsOptIn=true
 *   ?offset=N&limit=N  — page through the full user list (default limit 30)
 *
 * A single request processing every user used to run well past Railway's
 * 30-second proxy timeout for any non-trivial user count, dropping the
 * connection and surfacing as a generic "Network error" in the admin panel
 * even though the backend kept running. Paginating keeps each request's
 * batch small enough (default 30 users ≈ 60 GHL calls) to reliably finish
 * inside the timeout — the caller loops using the returned `nextOffset`
 * until `hasMore` is false.
 *
 * Processes users in concurrent batches of 3 to stay under GHL's ~10 req/s limit.
 *
 * Auth: x-admin-password header required.
 * Safe to run multiple times — upsert is idempotent.
 */

import { NextResponse } from 'next/server';
import { getAllUsers }  from '@/lib/users';
import { upsertGhlContact } from '@/lib/ghl';
import { sessionHasAdminRole } from '@/lib/adminAuth';

async function auth(req: Request): Promise<boolean> {
  const adminPw = process.env.ADMIN_PASSWORD ?? '';
  const header  = req.headers.get('x-admin-password') ?? '';
  const legacyOk = Boolean(adminPw && header === adminPw);
  return legacyOk || await sessionHasAdminRole();
}

// Each contact now makes TWO GHL calls (upsert + additive add-tags), so keep the
// batch small + pause longer to stay under GHL's ~10 req/s limit.
const BATCH_SIZE  = 3; // 3 contacts × 2 calls = ~6 reqs per batch
const PAGE_LIMIT  = 30; // default page size — keeps a page's total runtime well under 30s

export async function POST(req: Request) {
  if (!await auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const smsOnly = searchParams.get('smsOnly') === 'true';
  const offset  = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);
  const limit   = Math.max(1, parseInt(searchParams.get('limit') ?? String(PAGE_LIMIT), 10) || PAGE_LIMIT);

  const allUsers = await getAllUsers();
  const filtered = smsOnly
    ? allUsers.filter((u) => u.smsOptIn === true && u.email?.includes('@'))
    : allUsers.filter((u) => u.email?.includes('@'));

  const totalUsers = filtered.length;
  const users       = filtered.slice(offset, offset + limit);
  const hasMore     = offset + limit < totalUsers;
  const nextOffset  = hasMore ? offset + limit : null;

  if (users.length === 0) {
    return NextResponse.json({ total: totalUsers, synced: 0, skipped: 0, errors: [], hasMore: false, nextOffset: null });
  }

  let synced  = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Process in parallel batches
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (user) => {
      const plan = (user.plan === 'pro' || user.plan === 'fleet') ? user.plan : 'free';

      try {
        const ok = await upsertGhlContact({
          name:      user.name,
          email:     user.email,
          plan:      plan as 'free' | 'pro' | 'fleet',
          phone:     user.phone || undefined,
          locale:    (user.locale as 'en' | 'es' | undefined) ?? 'en',
          source:    'GasCap Admin Backfill',
          extraTags: [
            ...(user.isProTrial          ? ['gascap-trial-30day']      : []),
            ...(user.smsOptIn            ? ['gascap-sms-optin']        : []),
            ...(!user.emailVerified      ? ['gascap-email-unverified'] : []),
          ],
        });

        if (ok) {
          synced++;
          console.info(`[GHL backfill] ✓ ${user.email}`);
        } else {
          errors.push(`${user.email}: upsert returned false`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${user.email}: ${msg}`);
        console.error(`[GHL backfill] ✗ ${user.email}:`, e);
      }
    }));

    // Pause between batches to stay under GHL's rate limit (~6 reqs/batch / 1.1s ≈ 5 req/s)
    if (i + BATCH_SIZE < users.length) {
      await new Promise((r) => setTimeout(r, 1100));
    }
  }

  return NextResponse.json({
    total:   totalUsers,
    synced,
    skipped,
    errors,
    hasMore,
    nextOffset,
  });
}

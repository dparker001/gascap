/**
 * POST /api/admin/ghl-backfill
 *
 * One-time utility: reads every user and upserts them into GHL as contacts.
 * Users who are already in GHL are safely updated (upsert by email).
 *
 * Query params:
 *   ?smsOnly=true  — process only users with smsOptIn=true (fast, ~5s for 100 users)
 *   (no param)     — process all users (may be slow for large user counts)
 *
 * Processes users in concurrent batches of 5 to stay under GHL's 10 req/s limit
 * while completing quickly enough to avoid Railway's 30-second proxy timeout.
 *
 * Auth: x-admin-password header required.
 * Safe to run multiple times — upsert is idempotent.
 */

import { NextResponse } from 'next/server';
import { getAllUsers }  from '@/lib/users';
import { upsertGhlContact } from '@/lib/ghl';

function auth(req: Request): boolean {
  const adminPw = process.env.ADMIN_PASSWORD ?? '';
  const header  = req.headers.get('x-admin-password') ?? '';
  return Boolean(adminPw && header === adminPw);
}

const BATCH_SIZE = 10; // concurrent GHL requests per batch (GHL limit is 10 req/s)

export async function POST(req: Request) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const smsOnly = searchParams.get('smsOnly') === 'true';

  const allUsers = await getAllUsers();
  const users = smsOnly
    ? allUsers.filter((u) => u.smsOptIn === true && u.email?.includes('@'))
    : allUsers.filter((u) => u.email?.includes('@'));

  if (users.length === 0) return NextResponse.json({ synced: 0, skipped: 0, errors: [] });

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
            ...(user.isProTrial ? ['gascap-trial-30day'] : []),
            ...(user.smsOptIn   ? ['gascap-sms-optin']   : []),
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

    // Brief pause between batches to respect GHL's 10 req/s rate limit
    if (i + BATCH_SIZE < users.length) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  return NextResponse.json({
    total:   users.length,
    synced,
    skipped,
    errors,
  });
}

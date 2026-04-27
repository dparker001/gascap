/**
 * POST /api/admin/ghl-backfill
 *
 * One-time utility: reads every user in data/users.json and upserts them
 * into GHL as contacts. Users who are already in GHL are safely updated
 * (upsert by email). New-to-GHL users are created.
 *
 * All backfilled contacts receive the `gascap-original-beta` tag so they
 * are distinguishable from users who sign up after the fix.
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

export async function POST(req: Request) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const users = await getAllUsers();
  if (users.length === 0) return NextResponse.json({ synced: 0, skipped: 0, errors: [] });

  let synced  = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const user of users) {
    // Skip placeholder / test users with no real email
    if (!user.email || !user.email.includes('@')) { skipped++; continue; }

    const plan = (user.plan === 'pro' || user.plan === 'fleet') ? user.plan : 'free';

    try {
      const ok = await upsertGhlContact({
        name:      user.name,
        email:     user.email,
        plan:      plan as 'free' | 'pro' | 'fleet',
        isBeta:    !!user.isBetaTester,
        locale:    (user.locale as 'en' | 'es' | undefined) ?? 'en',
        source:    'GasCap Admin Backfill',
        extraTags: [
          'gascap-original-beta',
          ...(user.isProTrial ? ['gascap-trial-30day'] : []),
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

    // Small delay to avoid GHL rate limits (10 req/s)
    await new Promise((r) => setTimeout(r, 120));
  }

  return NextResponse.json({
    total:   users.length,
    synced,
    skipped,
    errors,
  });
}

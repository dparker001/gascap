/**
 * Admin API — protected by ADMIN_PASSWORD env var
 * GET    /api/admin/users              — list all users
 * DELETE /api/admin/users?id=xxx       — delete a user (logs to DeletedAccountLog + sends confirmation email)
 * PATCH  /api/admin/users?id=xxx       — update plan, emailVerified, isTestAccount,
 *                                        compProForLife, revokeCompProForLife
 */
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { findById, enrollCompCampaign, revokeAmbassadorEntitlement } from '@/lib/users';
import { upsertGhlContact } from '@/lib/ghl';
import { getFillups } from '@/lib/fillups';
import { sendCompProForLifeEmail } from '@/lib/emailCampaign';
import { sendMail, accountDeletedEmailHtml } from '@/lib/email';
import { getActiveDeviceCounts } from '@/lib/deviceSessions';
import { sessionHasAdminRole, requireAdmin, legacyAdminPasswordOk } from '@/lib/adminAuth';
import { logAdminActionFor } from '@/lib/adminAudit';

async function auth(req: Request): Promise<'ok' | 'no-env' | 'wrong'> {
  const pw = process.env.ADMIN_PASSWORD;
  if (legacyAdminPasswordOk(req, pw)) return 'ok';
  if (await sessionHasAdminRole()) return 'ok';
  return pw ? 'wrong' : 'no-env';
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
  const _auth = await auth(req);
  if (_auth === 'no-env') return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  if (_auth === 'wrong')  return NextResponse.json({ error: 'Unauthorized' },   { status: 401 });
  const [subscribedUserIds, allUsers] = await Promise.all([
    getOneSignalSubscriberIds(),
    prisma.user.findMany({ orderBy: { createdAt: 'desc' } }),
  ]);
  const deviceCounts = await getActiveDeviceCounts(allUsers.map((u) => u.id));

  // Build a map of referralCode → user name for quick lookup
  const codeToName = new Map<string, string>();
  for (const u of allUsers) {
    if (u.referralCode) codeToName.set(u.referralCode.toUpperCase(), u.name);
  }

  // Fetch fillup counts for all users in parallel
  const fillupsByUser = await Promise.all(allUsers.map((u) => getFillups(u.id)));

  const users = allUsers.map((u, idx) => {
    // Find users this person referred
    const referredRaw = u.referralCode
      ? allUsers.filter((r) => r.referredBy?.toUpperCase() === u.referralCode?.toUpperCase())
      : [];
    const referredUsers = referredRaw.map((r) => ({
      name: r.name, email: r.email, joinedAt: r.createdAt, emailVerified: r.emailVerified,
    }));
    // Verified sign-ups only — the metric the vNetCard cross-promo rewards (5/10).
    const verifiedReferralCount = referredRaw.filter((r) => r.emailVerified).length;

    const fillups     = fillupsByUser[idx];
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
      verifiedReferralCount,
      stripeCustomerId: u.stripeCustomerId ?? null,
      stripeInterval:   u.stripeInterval  ?? null,
      isProTrial:       u.isProTrial      ?? false,
      trialExpiresAt:   u.trialExpiresAt  ?? null,
      pushSubscribed:   subscribedUserIds.has(u.id),
      isTestAccount:        u.isTestAccount,
      ambassadorProForLife: u.ambassadorProForLife,
      emailOptOut:          u.emailOptOut ?? false,
      // Profile
      phone:            u.phone       ?? null,
      smsOptIn:         u.smsOptIn    ?? false,
      displayName:      u.displayName ?? null,
      // Activity metrics
      loginCount:       u.loginCount,
      lastLoginAt:      u.lastLoginAt   ?? null,
      calcCount:        u.calcCount,
      activeDays:       (u.activeDays   ?? []).length,
      streak:           u.streak,
      fillupCount,
      lastFillup,
      signupPlatform: u.signupPlatform ?? null,
      lastNativePlatform: u.lastNativePlatform ?? null,
      lastNativeAt: u.lastNativeAt ?? null,
      activeDeviceCount: deviceCounts.get(u.id) ?? 0,
    };
  });
  return NextResponse.json({ users, total: users.length });
}

export async function DELETE(req: Request) {
  // Sprint 2: resolves via requireAdmin() (same dual-auth as the local
  // auth() helper other handlers in this file use) specifically because
  // this handler needs an ACTOR identity for the audit log below, not just
  // a yes/no.
  const identity = await requireAdmin(req);
  if (!identity.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: identity.status });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Body may include reason + notes from the admin panel dialog
  let reason = 'user_request';
  let notes: string | undefined;
  try {
    const body = await req.json() as { reason?: string; notes?: string };
    if (body.reason) reason = body.reason;
    if (body.notes)  notes  = body.notes;
  } catch (_e) { /* no body — use defaults */ }

  // Capture user info BEFORE deletion so we can log + email them
  const user = await prisma.user.findUnique({ where: { id } });

  // Delete the user
  await prisma.user.delete({ where: { id } }).catch(() => null);

  if (user) {
    // Log to DeletedAccountLog
    let emailSent = false;
    try {
      await sendMail({
        to:      user.email,
        subject: 'Your GasCap™ account has been deleted',
        html:    accountDeletedEmailHtml(user.name),
        text:    `Hi ${user.name.split(' ')[0]}, your GasCap™ account has been permanently deleted as requested. If this was in error, reply to this email immediately. — The GasCap™ Team`,
      });
      emailSent = true;
    } catch (err) {
      console.error('[Admin] Account deletion email failed for', user.email, err);
    }

    await prisma.deletedAccountLog.create({
      data: {
        id:        randomUUID(),
        userId:    user.id,
        name:      user.name,
        email:     user.email,
        plan:      user.plan,
        deletedAt: new Date().toISOString(),
        reason,
        notes,
        emailSent,
      },
    }).catch((err: unknown) => console.error('[Admin] DeletedAccountLog write failed:', err));
  }

  await logAdminActionFor(identity, 'user.delete', {
    targetType: 'User', targetId: id, success: true,
    metadata: { reason, email: user?.email },
  });

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  // Sprint 2: same reasoning as DELETE above — needs an actor identity for
  // the plan-change audit log.
  const identity = await requireAdmin(req);
  if (!identity.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: identity.status });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const body = await req.json() as {
    plan?: string; emailVerified?: boolean;
    isTestAccount?: boolean;
    compProForLife?: boolean;
    revokeCompProForLife?: boolean;
    stripeInterval?: string | null;
    isProTrial?: boolean;
  };

  const user = await findById(id);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (body.compProForLife) {
    // Grant complimentary Pro for Life — Stripe-proof, stops trial drip, starts comp drip
    await prisma.user.update({
      where: { id },
      data: {
        plan:                'pro',
        ambassadorProForLife: true,
        emailCampaignStep:   5,   // stops trial drip (step 5 = done)
      },
    });
    // C1 (welcome email) fires immediately; C2–C5 picked up by comp-campaign cron
    sendCompProForLifeEmail(id, user.email, user.name)
      .catch((e) => console.error('[CompPro] email failed:', e));
    enrollCompCampaign(id)
      .catch((e) => console.error('[CompPro] enroll comp campaign failed:', e));
    upsertGhlContact({ name: user.name, email: user.email, plan: 'pro', source: 'GasCap Comp Pro For Life', extraTags: ['gascap-comp-ambassador'] })
      .catch((e) => console.error('[GHL] comp pro sync failed:', e));
    await logAdminActionFor(identity, 'user.grant_comp_pro_for_life', {
      targetType: 'User', targetId: id, success: true, metadata: { email: user.email },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.revokeCompProForLife) {
    // Post-Sprint-2 Revision 1 fix: this previously wrote
    // `ambassadorProForLife: false, plan: 'free'` directly, which could
    // wrongly downgrade a user who also held a valid Stripe or RevenueCat
    // entitlement. Goes through the resolver now — only actually downgrades
    // if no other source survives.
    const resolved = await revokeAmbassadorEntitlement(id);
    upsertGhlContact({
      name: user.name, email: user.email, plan: resolved.pro ? 'pro' : 'free',
      source: 'GasCap Comp Pro Revoked',
    }).catch((e) => console.error('[GHL] comp revoke sync failed:', e));
    await logAdminActionFor(identity, 'user.revoke_comp_pro_for_life', {
      targetType: 'User', targetId: id, success: true,
      metadata: { email: user.email, remainedPro: resolved.pro, survivingSources: resolved.sources },
    });
    return NextResponse.json({ ok: true, remainedPro: resolved.pro });
  }

  const data: Record<string, unknown> = {};
  if (body.plan           !== undefined) data.plan           = body.plan;
  if (body.stripeInterval !== undefined) data.stripeInterval = body.stripeInterval;
  if (body.isProTrial     !== undefined) data.isProTrial     = body.isProTrial;
  if (body.emailVerified  !== undefined) data.emailVerified  = body.emailVerified;
  if (body.isTestAccount  !== undefined) data.isTestAccount  = body.isTestAccount;

  await prisma.user.update({ where: { id }, data });
  // Only logged when something plan-relevant actually changed — this PATCH
  // also fires for emailVerified/isTestAccount toggles, which don't carry
  // the same "who touched this person's entitlement" weight.
  if (body.plan !== undefined || body.stripeInterval !== undefined || body.isProTrial !== undefined) {
    await logAdminActionFor(identity, 'user.plan_change', {
      targetType: 'User', targetId: id, success: true,
      metadata: { email: user.email, plan: body.plan, stripeInterval: body.stripeInterval, isProTrial: body.isProTrial },
    });
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse }          from 'next/server';
import { findByEmail }            from '@/lib/users';
import { sendPushNotification }   from '@/lib/oneSignal';
import { prisma }                 from '@/lib/prisma';
import { sendApns, apnsConfigured } from '@/lib/apns';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

/** POST /api/push/broadcast
 *  Body: { title, body, url?, email? }
 *  Header: x-admin-password
 */
export async function POST(req: Request) {
  const pw = req.headers.get('x-admin-password') ?? '';
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { title, body, url, email: targetEmail } = await req.json() as {
    title?: string; body?: string; url?: string; email?: string;
  };

  if (!title?.trim()) return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
  if (!body?.trim())  return NextResponse.json({ error: 'Message body is required.' }, { status: 400 });

  // Resolve targets. externalIds → OneSignal (web push). iosTokens → APNs (native app).
  let externalIds: string[] | undefined;
  let iosTokens:   string[]  = [];
  if (targetEmail?.trim()) {
    const user = await findByEmail(targetEmail.trim());
    if (!user) {
      return NextResponse.json({ error: `No user found with email: ${targetEmail}` }, { status: 404 });
    }
    externalIds = [user.id];
    const u = await prisma.user.findUnique({ where: { id: user.id }, select: { iosPushToken: true } });
    if (u?.iosPushToken) iosTokens = [u.iosPushToken];
  } else {
    // Broadcast: every user who has registered a native iOS push token.
    const rows = await prisma.user.findMany({
      where:  { iosPushToken: { not: null } },
      select: { iosPushToken: true },
    });
    iosTokens = rows.map((r) => r.iosPushToken).filter((t): t is string => !!t);
  }

  // ── Web push (OneSignal) ───────────────────────────────────────────────────
  const result = await sendPushNotification({
    title: title.trim(),
    body:  body.trim(),
    url:   url?.trim() || '/',
    externalIds,
  });

  // ── Native iOS push (APNs) ─────────────────────────────────────────────────
  let iosSent = 0;
  let iosFailed = 0;
  if (apnsConfigured() && iosTokens.length > 0) {
    const deepLink = url?.trim() || undefined;
    const results = await Promise.allSettled(
      iosTokens.map((t) => sendApns(t, title.trim(), body.trim(), deepLink ? { url: deepLink } : undefined)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.ok) iosSent++; else iosFailed++;
    }
  }

  console.log(`[Push] Broadcast — web recipients: ${result.recipients ?? 0}, iOS sent: ${iosSent}, iOS failed: ${iosFailed}`);
  return NextResponse.json({
    webRecipients: result.recipients ?? 0,
    iosSent,
    iosFailed,
    errors: result.errors,
  });
}

/** GET /api/push/broadcast — subscriber count via OneSignal API */
export async function GET(req: Request) {
  const pw = req.headers.get('x-admin-password') ?? '';
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const appId  = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    return NextResponse.json({ count: 0, error: 'OneSignal not configured' });
  }

  try {
    const res  = await fetch(`https://onesignal.com/api/v1/apps/${appId}`, {
      headers: { 'Authorization': `Basic ${apiKey}` },
    });
    const data = await res.json() as { players?: number };
    return NextResponse.json({ count: data.players ?? 0 });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}

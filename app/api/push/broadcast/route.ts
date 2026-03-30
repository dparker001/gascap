import { NextResponse } from 'next/server';
import { getAllSubs }   from '@/lib/pushSubscriptions';
import webpush          from 'web-push';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

function initVapid(): boolean {
  const pub  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:hello@gascap.app',
    pub,
    priv,
  );
  return true;
}

/** POST /api/push/broadcast
 *  Body: { title: string, body: string, url?: string }
 *  Header: x-admin-password
 */
export async function POST(req: Request) {
  // Auth
  const pw = req.headers.get('x-admin-password') ?? '';
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!initVapid()) {
    return NextResponse.json({ error: 'Push not configured — check VAPID env vars.' }, { status: 503 });
  }

  const { title, body, url } = await req.json() as {
    title?: string; body?: string; url?: string;
  };

  if (!title?.trim()) return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
  if (!body?.trim())  return NextResponse.json({ error: 'Message body is required.' }, { status: 400 });

  const subs = getAllSubs();
  if (subs.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, message: 'No subscribers found.' });
  }

  const payload = JSON.stringify({
    title: title.trim(),
    body:  body.trim(),
    icon:  '/icon-192.png',
    badge: '/icon-192.png',
    url:   url?.trim() || '/',
  });

  let sent    = 0;
  let skipped = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        payload,
      );
      sent++;
    } catch {
      // Subscription expired or invalid — skip silently
      skipped++;
    }
  }

  console.log(`[Push] Broadcast sent: ${sent} delivered, ${skipped} skipped`);
  return NextResponse.json({ sent, skipped });
}

/** GET /api/push/broadcast — returns subscriber count */
export async function GET(req: Request) {
  const pw = req.headers.get('x-admin-password') ?? '';
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ count: getAllSubs().length });
}

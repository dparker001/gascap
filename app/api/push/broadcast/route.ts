import { NextResponse }          from 'next/server';
import { findByEmail }            from '@/lib/users';
import { sendPushNotification }   from '@/lib/oneSignal';

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

  // If targeting a specific user, resolve their external ID
  let externalIds: string[] | undefined;
  if (targetEmail?.trim()) {
    const user = await findByEmail(targetEmail.trim());
    if (!user) {
      return NextResponse.json({ error: `No user found with email: ${targetEmail}` }, { status: 404 });
    }
    externalIds = [user.id];
  }

  const result = await sendPushNotification({
    title: title.trim(),
    body:  body.trim(),
    url:   url?.trim() || '/',
    externalIds,
  });

  console.log('[Push] Broadcast result:', result);
  return NextResponse.json({ recipients: result.recipients ?? 0, errors: result.errors });
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

/**
 * GET /api/cron/digest
 *
 * Weekly personalized fuel-spending digest push (Mondays 17:00 UTC via GitHub
 * Actions). Sends each ACTIVE Pro user their month-to-date recap on native iOS
 * (APNs) + web (OneSignal). Users with no fill-ups this month are skipped.
 *
 * Secured with CRON_SECRET (?secret=<value>).
 */
import { NextResponse } from 'next/server';
import { getAllUsers }   from '@/lib/users';
import { sendUserDigest } from '@/lib/digest';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!process.env.CRON_SECRET || searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const users = await getAllUsers();
  let sent = 0, inactive = 0, noChannel = 0, skipped = 0;

  for (const user of users) {
    if (user.plan !== 'pro') { skipped++; continue; }                       // Pro/trial only
    if ((user as { isTestAccount?: boolean }).isTestAccount) { skipped++; continue; }

    const r = await sendUserDigest(user as { id: string; iosPushToken?: string | null });
    if (!r.active)        { inactive++;  continue; }   // no fill-ups this month
    if (r.delivered)        sent++;
    else                    noChannel++;               // active but no push subscription
  }

  return NextResponse.json({ ok: true, sent, inactive, noChannel, skipped, ranAt: new Date().toISOString() });
}

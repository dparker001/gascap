/**
 * POST /api/admin/send-d1
 *
 * Manually sends the D1 welcome email to specific users who missed it at
 * registration, then enrolls them with their original createdAt as the
 * enrolledAt date so the daily cron will fire D2 on the correct schedule.
 *
 * Body: { userIds: string[] }
 *
 * Protected by ADMIN_PASSWORD header.
 */
import { NextResponse }          from 'next/server';
import { prisma }                from '@/lib/prisma';
import { sendCampaignEmail }     from '@/lib/emailCampaign';

function auth(req: Request): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  return req.headers.get('x-admin-password') === pw;
}

export async function POST(req: Request) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { userIds?: string[] };
  const { userIds } = body;
  if (!userIds?.length) return NextResponse.json({ error: 'userIds required' }, { status: 400 });

  const results: { userId: string; email: string; status: string; error?: string }[] = [];

  for (const userId of userIds) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      results.push({ userId, email: '?', status: 'not_found' });
      continue;
    }

    // Skip if already enrolled
    if (user.emailCampaignStep !== null) {
      results.push({ userId, email: user.email, status: 'already_enrolled', error: `step=${user.emailCampaignStep}` });
      continue;
    }

    try {
      // Send D1 welcome email (also writes a 'sent' row to EmailLog)
      await sendCampaignEmail(1, {
        id:    user.id,
        name:  user.name,
        email: user.email,
      });

      // Enroll with their original createdAt so the daily cron fires D2
      // on schedule (createdAt is 4-5 days ago → D2 eligible tomorrow)
      await prisma.user.update({
        where: { id: userId },
        data: {
          emailCampaignStep:       1,
          emailCampaignEnrolledAt: user.createdAt,
        },
      });

      results.push({ userId, email: user.email, status: 'sent' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ userId, email: user.email, status: 'error', error: msg });
    }
  }

  const sent   = results.filter(r => r.status === 'sent').length;
  const errors = results.filter(r => r.status === 'error').length;

  return NextResponse.json({ results, sent, errors });
}

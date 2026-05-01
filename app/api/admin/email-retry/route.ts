/**
 * POST /api/admin/email-retry
 *
 * Re-sends a specific campaign email step to a user and advances their
 * campaign step if successful. Marks the original error log entry as retried.
 *
 * Body: { logId: string }   — ID of the failed EmailLog row to retry
 *
 * Protected by ADMIN_PASSWORD header.
 */
import { NextResponse }            from 'next/server';
import { prisma }                  from '@/lib/prisma';
import { sendCampaignEmail }       from '@/lib/emailCampaign';
import { advanceEmailCampaignStep } from '@/lib/users';
import { CAMPAIGN_STEP_META }      from '@/lib/emailLog';

function auth(req: Request): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  return req.headers.get('x-admin-password') === pw;
}

// Derive campaign step number from email type string (e.g. 'trial-d2' → 2)
function stepFromType(type: string): number | null {
  const m = type.match(/trial-d(\d)/);
  return m ? parseInt(m[1], 10) : null;
}

export async function POST(req: Request) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { logId?: string };
  const { logId } = body;
  if (!logId) return NextResponse.json({ error: 'logId required' }, { status: 400 });

  // Fetch the failed log entry
  const logEntry = await prisma.emailLog.findUnique({ where: { id: logId } });
  if (!logEntry) return NextResponse.json({ error: 'Log entry not found' }, { status: 404 });
  if (logEntry.status !== 'failed') {
    return NextResponse.json({ error: 'Email is not in failed state' }, { status: 400 });
  }

  const step = stepFromType(logEntry.type);
  if (!step || !CAMPAIGN_STEP_META[step]) {
    return NextResponse.json({ error: `Cannot retry type: ${logEntry.type}` }, { status: 400 });
  }

  // Fetch user
  const user = await prisma.user.findUnique({ where: { id: logEntry.userId } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  try {
    // Re-send the email (this also writes a new 'sent' log row internally)
    await sendCampaignEmail(step, {
      id:    user.id,
      name:  user.name,
      email: user.email,
    });

    // Advance the campaign step so the cron won't re-send it again
    await advanceEmailCampaignStep(user.id, step);

    // Mark the original error row as retried so it disappears from the error list
    await prisma.emailLog.update({
      where: { id: logId },
      data:  { status: 'retried' },
    });

    return NextResponse.json({ ok: true, message: `Resent ${logEntry.type} to ${logEntry.userEmail}` });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Update error row with latest error message
    await prisma.emailLog.update({
      where: { id: logId },
      data:  { error: errMsg.slice(0, 1000) },
    });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

/**
 * POST /api/account/delete
 *
 * Self-service account deletion (App Store 5.1.1). Deletes the *signed-in*
 * user's account and all associated personal data, then emails a confirmation.
 * A user can only delete their own account (id comes from the session).
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { deleteUserAccount } from '@/lib/users';
import { sendMail, accountDeletedEmailHtml } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getServerSession(authOptions);
  const userId  = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  let snapshot;
  try {
    snapshot = await deleteUserAccount(userId);
  } catch (e) {
    console.error('[account/delete] failed:', e);
    return NextResponse.json({ error: 'Deletion failed. Please try again.' }, { status: 500 });
  }
  if (!snapshot) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  // Best-effort confirmation email to the user (don't block the response on it).
  sendMail({
    to:      snapshot.email,
    subject: 'Your GasCap™ account has been deleted',
    html:    accountDeletedEmailHtml(snapshot.name || 'there'),
    text:    `Your GasCap account (${snapshot.email}) and all associated data have been permanently deleted. If this wasn't you, contact admin@gascap.app.`,
  }).catch((e) => console.error('[account/delete] confirmation email failed:', e));

  // Admin notification — heads-up whenever a user self-deletes.
  sendMail({
    to:      'info@gascap.app',
    subject: `🗑️ Account deleted — ${snapshot.email}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
      <p style="font-size:18px;font-weight:800;margin:0 0 8px;">🗑️ A user deleted their account</p>
      <p style="font-size:14px;color:#334155;margin:0 0 4px;"><strong>${snapshot.name || '(no name)'}</strong></p>
      <p style="font-size:14px;color:#334155;margin:0 0 4px;">Email: <strong>${snapshot.email}</strong></p>
      <p style="font-size:14px;color:#334155;margin:0 0 12px;">Plan at deletion: <strong>${snapshot.plan}</strong></p>
      <p style="font-size:12px;color:#94a3b8;margin:0;">Self-service deletion via the app/website. Their account + data were permanently removed.</p>
    </div>`,
    text:    `Account deleted: ${snapshot.name || '(no name)'} <${snapshot.email}> — plan ${snapshot.plan}. Self-service deletion.`,
  }).catch((e) => console.error('[account/delete] admin notify failed:', e));

  return NextResponse.json({ ok: true });
}

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

  // Best-effort confirmation email (don't block the response on it).
  sendMail({
    to:      snapshot.email,
    subject: 'Your GasCap™ account has been deleted',
    html:    accountDeletedEmailHtml(snapshot.name || 'there'),
    text:    `Your GasCap account (${snapshot.email}) and all associated data have been permanently deleted. If this wasn't you, contact admin@gascap.app.`,
  }).catch((e) => console.error('[account/delete] confirmation email failed:', e));

  return NextResponse.json({ ok: true });
}

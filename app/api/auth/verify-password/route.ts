import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findByEmail }      from '@/lib/users';
import bcrypt               from 'bcryptjs';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { email, password } = await req.json() as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  // Must match the signed-in user's email — prevents verifying other accounts
  const sessionEmail = (session.user as { email?: string }).email ?? '';
  if (email.toLowerCase() !== sessionEmail.toLowerCase()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await findByEmail(email);
  if (!user?.passwordHash) {
    return NextResponse.json({ error: 'No password set' }, { status: 400 });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });

  return NextResponse.json({ ok: true });
}

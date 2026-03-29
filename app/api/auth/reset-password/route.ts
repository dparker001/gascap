import { NextResponse }            from 'next/server';
import { consumePasswordResetToken } from '@/lib/users';

export async function POST(req: Request) {
  const { token, password } = await req.json() as { token?: string; password?: string };

  if (!token?.trim())    return NextResponse.json({ error: 'Missing token.' },    { status: 400 });
  if (!password)         return NextResponse.json({ error: 'Missing password.' }, { status: 400 });
  if (password.length < 8)               return NextResponse.json({ error: 'Password must be at least 8 characters.' },        { status: 400 });
  if (!/[A-Z]/.test(password))           return NextResponse.json({ error: 'Password must contain an uppercase letter.' },     { status: 400 });
  if (!/[0-9]/.test(password))           return NextResponse.json({ error: 'Password must contain a number.' },                { status: 400 });
  if (!/[^A-Za-z0-9]/.test(password))   return NextResponse.json({ error: 'Password must contain a special character.' },    { status: 400 });

  const result = await consumePasswordResetToken(token.trim(), password);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}

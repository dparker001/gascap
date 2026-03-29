import { NextResponse } from 'next/server';
import { createUser, findByEmail, findByReferralCode, setReferredBy, createEmailVerifyToken } from '@/lib/users';
import { sendMail, verificationEmailHtml } from '@/lib/email';

export async function POST(req: Request) {
  try {
    const { name, email, password, referralCode } = await req.json() as {
      name?: string; email?: string; password?: string; referralCode?: string;
    };

    if (!name?.trim())   return NextResponse.json({ error: 'Name is required.' },            { status: 400 });
    if (!email?.trim())  return NextResponse.json({ error: 'Email is required.' },           { status: 400 });
    if (!password)       return NextResponse.json({ error: 'Password is required.' },        { status: 400 });
    if (password.length < 8)
                         return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email))
                         return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });

    if (findByEmail(email))
                         return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });

    const user = await createUser(name, email, password);

    // Store referral code on the new user — credit fires after email verification
    if (referralCode?.trim()) {
      const referrer = findByReferralCode(referralCode.trim());
      if (referrer && referrer.id !== user.id) {
        setReferredBy(user.id, referralCode.trim().toUpperCase());
      }
    }

    // Send verification email (non-blocking — don't fail registration if email fails)
    try {
      const token     = createEmailVerifyToken(user.id);
      const baseUrl   = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? new URL(req.url).origin;
      const verifyUrl = `${baseUrl}/verify-email?token=${token}`;
      await sendMail({
        to:      user.email,
        subject: 'Verify your GasCap™ email address',
        html:    verificationEmailHtml(user.name, verifyUrl),
        text:    `Hi ${user.name}, verify your GasCap account: ${verifyUrl}`,
      });
    } catch (emailErr) {
      console.error('[GasCap] Failed to send verification email:', emailErr);
      // Don't fail registration — user can still sign in and request another
    }

    return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

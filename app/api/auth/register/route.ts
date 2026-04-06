import { NextResponse } from 'next/server';
import { createUser, findByEmail, findByReferralCode, setReferredBy, createEmailVerifyToken, enrollEmailCampaign } from '@/lib/users';
import { sendMail, verificationEmailHtml } from '@/lib/email';
import { sendCampaignEmail } from '@/lib/emailCampaign';
import { upsertGhlContact } from '@/lib/ghl';

function getBaseUrl(req: Request): string {
  const nextAuthUrl    = process.env.NEXTAUTH_URL;
  const forwardedHost  = req.headers.get('x-forwarded-host');
  const host           = req.headers.get('host');
  const proto          = req.headers.get('x-forwarded-proto') ?? 'https';
  console.log('[GasCap] getBaseUrl — NEXTAUTH_URL:', nextAuthUrl, '| x-forwarded-host:', forwardedHost, '| host:', host);
  if (nextAuthUrl) return nextAuthUrl.replace(/\/$/, '');
  if (forwardedHost) return `${proto}://${forwardedHost}`;
  if (host) return `${proto}://${host}`;
  return 'https://www.gascap.app';
}

export async function POST(req: Request) {
  try {
    const { name, email, password, referralCode } = await req.json() as {
      name?: string; email?: string; password?: string; referralCode?: string;
    };

    if (!name?.trim())   return NextResponse.json({ error: 'Name is required.' },            { status: 400 });
    if (!email?.trim())  return NextResponse.json({ error: 'Email is required.' },           { status: 400 });
    if (!password) return NextResponse.json({ error: 'Password is required.' }, { status: 400 });
    if (password.length < 8)         return NextResponse.json({ error: 'Password must be at least 8 characters.' },        { status: 400 });
    if (!/[A-Z]/.test(password))     return NextResponse.json({ error: 'Password must contain an uppercase letter.' },     { status: 400 });
    if (!/[0-9]/.test(password))     return NextResponse.json({ error: 'Password must contain a number.' },                { status: 400 });
    if (!/[^A-Za-z0-9]/.test(password)) return NextResponse.json({ error: 'Password must contain a special character.' }, { status: 400 });

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
      const token   = createEmailVerifyToken(user.id);
      const baseUrl = getBaseUrl(req);
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

    // Enroll in drip campaign + send welcome email (non-blocking)
    try {
      enrollEmailCampaign(user.id);
      await sendCampaignEmail(1, { id: user.id, name: user.name, email: user.email });
    } catch (campaignErr) {
      console.error('[GasCap] Welcome campaign email failed:', campaignErr);
      // Non-fatal — user is registered, campaign can recover via cron
    }

    // Notify admin of new signup (non-blocking)
    sendMail({
      to:      'hello@gascap.app',
      subject: `🎉 New GasCap™ signup: ${user.name}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
        <p style="font-size:22px;margin:0 0 8px;">🎉 New signup</p>
        <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${user.name}</strong></p>
        <p style="font-size:14px;color:#64748b;margin:0 0 16px;">${user.email}</p>
        <p style="font-size:12px;color:#94a3b8;">Signed up ${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET · Plan: Free</p>
      </div>`,
      text: `New GasCap signup: ${user.name} <${user.email}> — Free plan`,
    }).catch((e) => console.error('[GasCap] Admin signup notify failed:', e));

    // Sync to GHL CRM (non-blocking — don't fail registration if GHL is down)
    upsertGhlContact({
      name:   user.name,
      email:  user.email,
      plan:   'free',
      isBeta: false,
      source: 'GasCap Signup',
    }).catch((err) => console.error('[GHL] signup sync failed:', err));

    return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

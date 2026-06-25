/**
 * POST /api/auth/otp/verify
 *
 * Checks the OTP code. On success, returns a short-lived session token the
 * client passes to signIn('credentials-otp') so NextAuth issues a real JWT.
 *
 * Body: { email: string; code: string; locale?: string; referralCode?: string }
 */

import { NextResponse }      from 'next/server';
import { verifyOtp }         from '@/lib/otpStore';
import {
  findByEmail,
  grantNewSignupProTrial,
  enrollEmailCampaign,
  recordLogin,
} from '@/lib/users';
import { prisma }            from '@/lib/prisma';
import { nameFromEmail }     from '@/lib/users';
import { upsertGhlContact }  from '@/lib/ghl';
import { sendMail }          from '@/lib/email';
import { sendCampaignEmail } from '@/lib/emailCampaign';
import { hasEmailBeenSent }  from '@/lib/emailLog';
import { findByReferralCode, setReferredBy } from '@/lib/users';
import { createOtpSessionToken } from '@/lib/otpSessions';

export async function POST(req: Request) {
  let email: string, code: string, locale: string, referralCode: string;

  try {
    const body = await req.json() as {
      email?: string; code?: string; locale?: string; referralCode?: string;
    };
    email        = (body.email        ?? '').toLowerCase().trim();
    code         = (body.code         ?? '').trim();
    locale       = (body.locale       ?? 'en');
    referralCode = (body.referralCode ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (!email || !code) {
    return NextResponse.json({ error: 'Email and code are required.' }, { status: 400 });
  }

  const name = verifyOtp(email, code);
  if (!name && name !== '') {
    return NextResponse.json({ error: 'Invalid or expired code. Please try again.' }, { status: 401 });
  }

  // Find or create the user
  let user = await findByEmail(email);
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    const displayName = name.trim() || nameFromEmail(email);
    const created = await prisma.user.create({
      data: {
        id:            crypto.randomUUID(),
        email:         email,
        name:          displayName,
        passwordHash:  null,       // passwordless account
        emailVerified: true,       // OTP proves email ownership
        plan:          'free',
        createdAt:     new Date().toISOString(),
        locale:        locale === 'es' ? 'es' : 'en',
      },
    });
    user = await findByEmail(created.email);

    // New-user onboarding (fire-and-forget)
    ;(async () => {
      try {
        await grantNewSignupProTrial(user!.id, 30);
        await enrollEmailCampaign(user!.id);

        // Referral tracking
        if (referralCode) {
          const referrer = await findByReferralCode(referralCode).catch(() => null);
          if (referrer) await setReferredBy(user!.id, referralCode.toUpperCase()).catch(() => {});
        }

        // Welcome drip email — OTP = email verified, so skip verify block
        if (!(await hasEmailBeenSent(user!.id, 'trial-d1'))) {
          await sendCampaignEmail(1, {
            id:    user!.id,
            name:  user!.name,
            email: user!.email,
          });
        }

        // Admin notify
        await sendMail({
          to:      'info@gascap.app',
          subject: `🎉 New GasCap™ signup (passwordless): ${user!.name}`,
          html:    `<p><strong>${user!.name}</strong> (${user!.email}) signed up via email OTP — Pro trial active.</p>`,
          text:    `New signup: ${user!.name} <${user!.email}> — Pro trial (30 days)`,
        });

        // GHL sync
        upsertGhlContact({
          name:      user!.name,
          email:     user!.email,
          plan:      'pro',
          locale:    locale === 'es' ? 'es' : 'en',
          source:    'GasCap Signup',
          extraTags: ['gascap-new-signup', 'gascap-trial-30day', 'gascap-email-verified', 'gascap-passwordless'],
        }).catch(() => {});
      } catch (e) {
        console.error('[otp/verify] onboarding error', e);
      }
    })();
  } else {
    await recordLogin(user.id);
  }

  if (!user) {
    return NextResponse.json({ error: 'Account setup failed. Please try again.' }, { status: 500 });
  }

  // Issue a short-lived one-time token for the NextAuth credentials-otp provider
  const sessionToken = await createOtpSessionToken(user.id);

  return NextResponse.json({ ok: true, sessionToken, isNewUser });
}

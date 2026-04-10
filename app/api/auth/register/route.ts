import { NextResponse } from 'next/server';
import {
  createUser,
  findByEmail,
  findByReferralCode,
  setReferredBy,
  createEmailVerifyToken,
  grantNewSignupProTrial,
  enrollEmailCampaign,
} from '@/lib/users';
import { sendMail, verificationEmailHtml } from '@/lib/email';
import { sendCampaignEmail } from '@/lib/emailCampaign';
import { upsertGhlContact, upsertGhlContactWithCampaign } from '@/lib/ghl';
import { getPlacementByCode, logEvent } from '@/lib/campaigns';

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
    const { name, email, password, referralCode, locale } = await req.json() as {
      name?: string; email?: string; password?: string; referralCode?: string; locale?: string;
    };

    // Normalize — only 'en' / 'es' are supported. Default to English so a
    // stale Spanish localStorage on the browser opening the verification link
    // can't override the user's actual signup language.
    const userLocale: 'en' | 'es' = locale === 'es' ? 'es' : 'en';

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

    // Auto-enroll every new signup in a 30-day GasCap™ Pro trial. Sets
    // plan='pro', isProTrial=true, betaProExpiry=+30d. The beta-expire cron
    // will revert them to free automatically if they don't upgrade.
    grantNewSignupProTrial(user.id, 30);

    // Enroll in the 5-email drip sequence (step 1 = welcome, sent below).
    enrollEmailCampaign(user.id);

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
      const verifyUrl = `${baseUrl}/verify-email?token=${token}&lang=${userLocale}`;
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

    // Fire step-1 welcome email from the drip sequence (non-blocking).
    // Celebrates the Pro trial activation and kicks off the 5-email journey.
    sendCampaignEmail(1, { id: user.id, name: user.name, email: user.email })
      .catch((err) => console.error('[GasCap] Welcome drip email failed:', err));

    // Notify admin of new signup (non-blocking)
    sendMail({
      to:      'hello@gascap.app',
      subject: `🎉 New GasCap™ signup: ${user.name} (Pro trial activated)`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;">
        <p style="font-size:22px;margin:0 0 8px;">🎉 New signup — Pro trial activated</p>
        <p style="font-size:15px;color:#334155;margin:0 0 4px;"><strong>${user.name}</strong></p>
        <p style="font-size:14px;color:#64748b;margin:0 0 16px;">${user.email}</p>
        <p style="font-size:12px;color:#94a3b8;">
          Signed up ${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET ·
          Plan: <strong style="color:#f59e0b;">Pro (30-day free trial)</strong>
        </p>
      </div>`,
      text: `New GasCap signup: ${user.name} <${user.email}> — Pro trial (30 days)`,
    }).catch((e) => console.error('[GasCap] Admin signup notify failed:', e));

    // Read QR pilot attribution cookie (set by /q/[code]) so we can credit
    // the signup back to the right placard.
    const cookieHeader = req.headers.get('cookie') ?? '';
    const placementCode = /(?:^|;\s*)gc_src=([^;]+)/.exec(cookieHeader)?.[1];
    const placement     = placementCode ? getPlacementByCode(decodeURIComponent(placementCode)) : undefined;

    // Log a campaign signup event so the dashboard funnel updates.
    // Include the signup locale so the admin dashboard can show EN vs ES
    // conversion rates per placement — critical for bilingual QR campaigns.
    if (placementCode) {
      try {
        const sessionId = /(?:^|;\s*)gc_ssn=([^;]+)/.exec(cookieHeader)?.[1] ?? `ssn_${Date.now().toString(36)}`;
        logEvent({
          placementCode: placement?.code ?? decodeURIComponent(placementCode),
          type:          'signup',
          sessionId,
          userId:        user.id,
          path:          '/api/auth/register',
          meta:          { email: user.email, locale: userLocale },
        });
      } catch (e) { console.error('[GasCap] campaign signup log failed:', e); }
    }

    // Sync to GHL CRM — triggers the new-signup automation in GHL (non-blocking).
    // Every new signup gets plan='pro' so the `gascap-pro` tag is applied
    // automatically by PLAN_TAGS. We also attach `gascap-trial-30day` so
    // marketing automations can distinguish trial users from paying Pro
    // subscribers.
    const newSignupTags = ['gascap-new-signup', 'gascap-trial-30day'];

    if (placement) {
      upsertGhlContactWithCampaign(
        {
          name:      user.name,
          email:     user.email,
          plan:      'pro',
          isBeta:    false,
          source:    `GasCap QR — ${placement.station}`,
          extraTags: newSignupTags,
        },
        {
          placementCode:   placement.code,
          station:         placement.station,
          city:            placement.city,
          placement:       placement.placement,
          headlineVariant: placement.headlineVariant,
          campaign:        placement.campaign,
        },
      ).catch((err) => console.error('[GHL] campaign signup sync failed:', err));
    } else {
      upsertGhlContact({
        name:      user.name,
        email:     user.email,
        plan:      'pro',
        isBeta:    false,
        source:    'GasCap Signup',
        extraTags: newSignupTags,
      }).catch((err) => console.error('[GHL] signup sync failed:', err));
    }

    return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
